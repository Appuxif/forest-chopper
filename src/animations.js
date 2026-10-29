export async function createAnimations(THREE) {
// Lumberjack GLB is served as a separate file by GitHub Pages.
const GLB_DATA = "./lumberjack/lumberjack.glb";

let modelScene=null,animationClips=[],cloneModel=null;
const modelActors=new Set();
try {
 const [{GLTFLoader},{clone}]=await Promise.all([
  import('https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js'),
  import('https://esm.sh/three@0.170.0/examples/jsm/utils/SkeletonUtils.js')
 ]);
 const loader=new GLTFLoader();
 const gltf=await loader.loadAsync(GLB_DATA);
 modelScene=gltf.scene; animationClips=gltf.animations; cloneModel=clone;
} catch(error) { console.error('Lumberjack model load failed',error); }
// Two independent bone-mask layers: locomotion on the legs + root and
// chopping on the torso/arms. Every track belongs to exactly one layer.
// GLTFLoader sanitizes bone names: Thigh.L becomes Thigh_L.
// Normalize both variants so Chop2 NEVER owns a leg/root channel.
const LOWER_BONES=new Set(['root','hips','thighl','thighr','shinl','shinr']);
const normalizeBone=name=>name.replace(/[._\s-]/g,'').toLowerCase();
const CHOP_SPEED=1.6;
function maskedClip(clip,upper){
 const tracks=clip.tracks.filter(track=>{
  // glTF names may include periods: remove only the final property suffix.
  const dot=track.name.lastIndexOf('.');
  const bone=dot===-1?track.name:track.name.slice(0,dot);
  return LOWER_BONES.has(normalizeBone(bone))!==upper;
 });
 return new THREE.AnimationClip(clip.name+(upper?'_upper':'_lower'),clip.duration,tracks);
}
// Root Motion is sampled from the original horizontal Root tracks. The animated
// skeleton keeps only its vertical Root motion, avoiding double translation.
const ROOT_MOTIONS=['Walk','Run','StrafeLeft','StrafeRight'];
const rootMotion={};
for(const clip of animationClips){
 if(!ROOT_MOTIONS.includes(clip.name))continue;
 const root=clip.tracks.find(track=>{
  const dot=track.name.lastIndexOf('.');
  return dot>=0&&track.name.slice(dot+1)==='position'&&normalizeBone(track.name.slice(0,dot))==='root';
 });
 if(!root)continue;
 const rootTrack=root.clone(); // Keep an independent copy before zeroing skeleton translation.
 const sampler=rootTrack.createInterpolant(new Float32Array(3));
 const origin=new THREE.Vector3().fromArray(sampler.evaluate(0));
 const end=new THREE.Vector3().fromArray(sampler.evaluate(clip.duration));
 rootMotion[clip.name]={sampler,duration:clip.duration,travel:end.clone().sub(origin)};
 for(let i=0;i<root.values.length;i+=3){root.values[i]=0;root.values[i+2]=0;}
}
console.info('Lumberjack Root Motion',Object.fromEntries(Object.entries(rootMotion).map(([name,info])=>[name,info.travel.toArray()])));
const layerClips={};
for(const clip of animationClips){
 layerClips[clip.name]={lower:maskedClip(clip,false),upper:maskedClip(clip,true)};
}
console.info('Lumberjack animation layers (expected lower=18, upper=21)',Object.fromEntries(Object.entries(layerClips).map(([name,clips])=>[name,[clips.lower.tracks.length,clips.upper.tracks.length]])));
function createLumberjack(){
 if(!modelScene)return null;
 const group=new THREE.Group(),visual=cloneModel(modelScene);
 visual.rotation.y=Math.PI;group.add(visual);
 const mixer=new THREE.AnimationMixer(visual);
 const lower={},upper={};
 for(const [name,clips] of Object.entries(layerClips)){
  if(clips.lower.tracks.length)lower[name]=mixer.clipAction(clips.lower);
  if(clips.upper.tracks.length)upper[name]=mixer.clipAction(clips.upper);
 }
 if(upper.Chop2){upper.Chop2.setLoop(THREE.LoopOnce,1);upper.Chop2.clampWhenFinished=true;}
 const actor={group,visual,mixer,lower,upper,lowerState:'',upperState:'',chopEnd:0,rmTimes:{}};
 actor.actions={...lower,Chop2:upper.Chop2};
 modelActors.add(actor);
 transitionLayer(actor,'lower','Idle');transitionLayer(actor,'upper','Idle');
 return actor;
}
function transitionLayer(actor,layer,name,rate=1){
 const bank=actor[layer],field=layer+'State';
 if(!bank[name])return;
 const next=bank[name],speed=name==='Chop2'?CHOP_SPEED:rate;
 if(actor[field]===name){
  // S plays the same walk/run cycle backwards, giving real backwards steps.
  if(layer==='lower'&&Math.sign(next.getEffectiveTimeScale())!==Math.sign(speed)){
   next.time=speed<0?Math.max(0,next.getClip().duration-1e-5):0;
   actor.rmTimes[name]=next.time;
  }
  if(layer==='lower')next.setEffectiveTimeScale(speed);
  return;
 }
 const previous=bank[actor[field]];
 const fade=name==='Chop2' ? .045 : (layer==='upper'&&previous===bank.Chop2 ? .18 : .12);
 next.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1);
 if(layer==='lower'&&speed<0)next.time=Math.max(0,next.getClip().duration-1e-5);
 if(layer==='lower')actor.rmTimes[name]=next.time;
 next.fadeIn(fade).play();
 if(previous&&previous!==next)previous.fadeOut(fade);
 actor[field]=name;
}
function actorChop(actor){
 const action=actor?.upper?.Chop2;
 if(!action)return;
 if(actor.upperState==='Chop2'){
  action.stop();actor.upperState='';
 }
 actor.chopEnd=performance.now()+action.getClip().duration/CHOP_SPEED*1000+30;
 transitionLayer(actor,'upper','Chop2');
}
function rootStep(info,from,to,backward){
 const start=new THREE.Vector3().fromArray(info.sampler.evaluate(from));
 const end=new THREE.Vector3().fromArray(info.sampler.evaluate(to));
 // Repeat loops reset their phase. Correct the wrap with the full-cycle travel.
 if(!backward&&to<from)end.add(info.travel);
 if(backward&&to>from)end.sub(info.travel);
 return end.sub(start);
}
function tickActor(actor,dt,motion='Idle',jumping=false,rate=1){
 const displacement=new THREE.Vector3();
 if(!actor)return displacement;
 motion=jumping&&actor.lower.Jump?'Jump':actor.lower[motion]?motion:'Idle';
 transitionLayer(actor,'lower',motion,rate);
 // Never interrupt the full chopping swing; locomotion animates the legs.
 if(actor.upperState!=='Chop2'||performance.now()>=actor.chopEnd){
  transitionLayer(actor,'upper',motion);
 }
 actor.mixer.update(dt);
 for(const name of ROOT_MOTIONS){
  const info=rootMotion[name],action=actor.lower[name];
  if(!info||!action)continue;
  const from=actor.rmTimes[name]??action.time,to=action.time;
  actor.rmTimes[name]=to;
  if(!action.isRunning()||action.getEffectiveWeight()<.001||Math.abs(to-from)<1e-9)continue;
  displacement.addScaledVector(rootStep(info,from,to,action.getEffectiveTimeScale()<0),action.getEffectiveWeight());
 }
 // GLB local space -> the visual (PI around Y) -> actor facing direction.
 return displacement.applyQuaternion(actor.visual.quaternion).applyQuaternion(actor.group.quaternion);
}

return {modelActors,CHOP_SPEED,createLumberjack,actorChop,tickActor,rootMotion};
}
