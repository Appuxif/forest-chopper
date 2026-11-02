import {rootMotionSpeed} from './root-motion-speed.js';

// Each actor owns exactly one visible skeleton, mixer and animation bank.
// The modular male/female game GLBs contain the authored Run/Chop actions.
// No invisible driver character and no second animation timeline.
const LOWER_BONES=new Set(['root','pelvis','hips','thighl','thighr','calfl','calfr','shinl','shinr','footl','footr','balll','ballr']);
const ROOT_MOTIONS=['Walk','Run','StrafeLeft','StrafeRight'];
const normalizeBone=name=>name.replace(/[._\s-]/g,'').toLowerCase();
export const CHOP_SPEED=1.6;

function maskedClip(THREE,clip,upper){
 const tracks=clip.tracks.filter(track=>{
  const dot=track.name.lastIndexOf('.');
  const bone=dot<0?track.name:track.name.slice(0,dot);
  return LOWER_BONES.has(normalizeBone(bone))!==upper;
 });
 return new THREE.AnimationClip(clip.name+(upper?'_upper':'_lower'),clip.duration,tracks);
}

function extractRootMotion(THREE,clips){
 const rootMotion={};
 for(const clip of clips){
  if(!ROOT_MOTIONS.includes(clip.name))continue;
  const track=clip.tracks.find(track=>{
   const dot=track.name.lastIndexOf('.');
   return dot>=0&&track.name.slice(dot+1)==='position'&&normalizeBone(track.name.slice(0,dot))==='root';
  });
  if(!track)continue;
  const sampler=track.clone().createInterpolant(new Float32Array(3));
  const start=new THREE.Vector3().fromArray(sampler.evaluate(0));
  const end=new THREE.Vector3().fromArray(sampler.evaluate(clip.duration));
  rootMotion[clip.name]={sampler,duration:clip.duration,travel:end.sub(start)};
  // Root travel belongs to the game actor position, never both the skeleton
  // and the scene transform. Vertical bobbing stays on the armature.
  for(let i=0;i<track.values.length;i+=3){track.values[i]=0;track.values[i+2]=0;}
 }
 return rootMotion;
}

function transitionLayer(THREE,actor,layer,name,rate=1){
 const bank=actor[layer],field=layer+'State';
 const next=bank[name];if(!next)return;
 const speed=name==='Chop2'?CHOP_SPEED*Math.max(.1,rate):rate;
 if(actor[field]===name){
  if(layer==='lower'&&Math.sign(next.getEffectiveTimeScale())!==Math.sign(speed)){
   next.time=speed<0?Math.max(0,next.getClip().duration-1e-5):0;
   actor.rmTimes[name]=next.time;
  }
  if(name!=='Chop2')next.setEffectiveTimeScale(speed);
  return;
 }
 const previous=bank[actor[field]];
 const fade=name==='Chop2'?.045:(layer==='upper'&&previous===bank.Chop2?.18:.12);
 next.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1);
 if(layer==='lower'&&speed<0)next.time=Math.max(0,next.getClip().duration-1e-5);
 if(layer==='lower')actor.rmTimes[name]=next.time;
 next.fadeIn(fade).play();
 if(previous&&previous!==next)previous.fadeOut(fade);
 actor[field]=name;
}

function rootStep(THREE,info,from,to,backward){
 const start=new THREE.Vector3().fromArray(info.sampler.evaluate(from));
 const end=new THREE.Vector3().fromArray(info.sampler.evaluate(to));
 if(!backward&&to<from)end.add(info.travel);
 if(backward&&to>from)end.sub(info.travel);
 return end.sub(start);
}

export async function createAnimations(THREE){
 const modelActors=new Set();
 const {createLiteHumanoid}=await import('../characters/humanoid/humanoid-lite.js?v=20261102-production-13-1');
 let legacyTemplatePromise=null,axeAssetPromise=null;
 const clipNames={idle:'Idle',walk:'Walk',run:'Run',strafe_left:'StrafeLeft',strafe_right:'StrafeRight',jump:'Jump',fall:'Fall',Chop:'Chop2'};
 const {GLTFLoader}=await import('https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js');
 const loader=new GLTFLoader();

 async function createAvatar(model='male',layer=3){
  const group=new THREE.Group();
  let visual,mixer,rawClips,human=null;
  if(model==='legacy'){
   // The optional classic character uses its own GLB for both appearance and
   // locomotion. It is a model choice, never an invisible animation driver.
   const [{clone},gltf]=await Promise.all([
    import('https://esm.sh/three@0.170.0/examples/jsm/utils/SkeletonUtils.js'),
    legacyTemplatePromise??=(loader.loadAsync('./lumberjack/lumberjack.glb')),
   ]);
   visual=clone(gltf.scene);
   mixer=new THREE.AnimationMixer(visual);
   rawClips=gltf.animations;
  }else{
   if(model!=='male'&&model!=='female')throw Error('Unknown character model: '+model);
   human=await createLiteHumanoid({body:model,face:'default',hair:'short02',top:'shirt',bottom:'jeans',shoes:'shoes',outerwear:null});
   human.mixer.stopAllAction();
   human.action=null;
   visual=human.root;
   mixer=human.mixer;
   rawClips=human.clips;
   const axeGLTF=await (axeAssetPromise??=(loader.loadAsync('./characters/humanoid/lite/axe_preview.glb')));
   const hand=human.bones.get('hand_r');
   let grip=null;
   axeGLTF.scene.traverse(node=>{if(node.name.startsWith('AXE_GRIP'))grip=node;});
   if(!hand||!grip)throw Error('Missing right hand or axe grip');
   hand.add(grip.clone(true));
  }
  visual.rotation.y=Math.PI;
  visual.traverse(node=>{if(node.isMesh){node.castShadow=true;node.layers.set(layer);}});
  group.add(visual);
  // REF_* Actions live in the same model but the game needn't allocate
  // animation masks/actions until they are selected for actual gameplay.
  const clips=rawClips.filter(clip=>!clip.name.startsWith('REF_')).map(clip=>{
   const cloned=clip.clone();
   cloned.name=clipNames[cloned.name]??cloned.name;
   return cloned;
  });
  const rootMotion=extractRootMotion(THREE,clips);
  const lower={},upper={};
  for(const clip of clips){
   const lo=maskedClip(THREE,clip,false),hi=maskedClip(THREE,clip,true);
   if(lo.tracks.length)lower[clip.name]=mixer.clipAction(lo);
   if(hi.tracks.length)upper[clip.name]=mixer.clipAction(hi);
  }
  if(upper.Chop2){upper.Chop2.setLoop(THREE.LoopOnce,1);upper.Chop2.clampWhenFinished=true;}
  const shadowMeshes=[];
  visual.traverse(node=>{if(node.isMesh)shadowMeshes.push(node);});
  const actor={group,visual,mixer,lower,upper,rootMotion,shadowMeshes,human,
   lowerState:'',upperState:'',chopEnd:0,rmTimes:{},model};
  actor.actions={...lower,Chop2:upper.Chop2};
  modelActors.add(actor);
  transitionLayer(THREE,actor,'lower','Idle');
  transitionLayer(THREE,actor,'upper','Idle');
  console.info('[Forest Chopper] Unified character',model, 'rigs=1',
   'Run', {duration:rootMotion.Run?.duration,meters:rootMotion.Run?.travel.length(),nativeSpeed:rootMotionSpeed(rootMotion.Run)});
  return actor;
 }

 function actorChop(actor){
  const action=actor?.upper?.Chop2;
  if(!action)return;
  if(actor.upperState==='Chop2'){action.stop();actor.upperState='';}
  actor.chopEnd=performance.now()+action.getClip().duration/CHOP_SPEED*1000+30;
  transitionLayer(THREE,actor,'upper','Chop2');
 }

 function tickActor(actor,dt,motion='Idle',jumping=false,rate=1){
  const displacement=new THREE.Vector3();
  if(!actor)return displacement;
  motion=jumping&&actor.lower.Jump?'Jump':actor.lower[motion]?motion:'Idle';
  transitionLayer(THREE,actor,'lower',motion,rate);
  if(actor.upperState!=='Chop2'||performance.now()>=actor.chopEnd)
   transitionLayer(THREE,actor,'upper',motion,rate);
  // The same mixer that moves the rendered bones supplies Root Motion.
  if(actor.human){actor.human.motionName=motion.toLowerCase();actor.human.update(dt);}
  else actor.mixer.update(dt);
  for(const name of ROOT_MOTIONS){
   const info=actor.rootMotion[name],action=actor.lower[name];
   if(!info||!action)continue;
   const from=actor.rmTimes[name]??action.time,to=action.time;
   actor.rmTimes[name]=to;
   if(!action.isRunning()||action.getEffectiveWeight()<.001||Math.abs(to-from)<1e-9)continue;
   displacement.addScaledVector(rootStep(THREE,info,from,to,action.getEffectiveTimeScale()<0),action.getEffectiveWeight());
  }
  return displacement.applyQuaternion(actor.visual.quaternion).applyQuaternion(actor.group.quaternion);
 }
 return {modelActors,CHOP_SPEED,createAvatar,actorChop,tickActor};
}
