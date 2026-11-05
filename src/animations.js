import {rootMotionSpeed,mirroredWalkPhaseTime,rootMotionSampleDelta,weightedHorizontalRootTravel} from './root-motion-speed.js?v=20261104-ori03';
import {createProceduralLook} from './procedural-look.js';
import {SHARED_AXE_ASSET} from './character-model-selection.js?v=20261105-lumberjack-chop-1812';

// Each actor owns exactly one visible skeleton, mixer and animation bank.
// Each of the three 53-bone game GLBs contains its OWN authored animations.
// No legacy driver rig, model-specific mixer or alternate gameplay timing.
const LOWER_BONES=new Set(['root','pelvis','hips','thighl','thighr','calfl','calfr','shinl','shinr','footl','footr','balll','ballr']);
const ROOT_MOTIONS=['Walk','WalkBackward','Run','RunBackward','StrafeLeft','StrafeRight'];
const HUMANOID_CLIP_NAMES={
 idle:'Idle',idle_breathe:'IdleBreathe',idle_fidget:'IdleFidget',idle_look:'IdleLook',
 walk:'Walk',walk_back:'WalkBackward',walk_backward:'WalkBackward',
 run:'Run',run_backward:'RunBackward',
 strafe_left:'StrafeLeft',strafe_right:'StrafeRight',
 jump:'Jump',fall:'Fall',land:'Land',Chop:'Chop2'
};
// Blender keeps each artist's lowercase action names; the game uses one
// canonical set of identifiers for all three GLBs. The model ID is ignored
// intentionally: identity changes artwork, not animation semantics.
export function runtimeClipName(model,name){
 return HUMANOID_CLIP_NAMES[name]??name;
}
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

export function transitionLayer(THREE,actor,layer,name,rate=1){
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
 // Forward/backward Walk and Run are reverse-phase variants. Invert
 // both body layers' time to keep planted feet and arm cadence aligned.
 const reversedDirection=previous&&(
   (actor[field]==='Walk'&&name==='WalkBackward')||
   (actor[field]==='WalkBackward'&&name==='Walk')||
   (actor[field]==='Run'&&name==='RunBackward')||
   (actor[field]==='RunBackward'&&name==='Run')
 );
 const mirroredTime=reversedDirection
  ?mirroredWalkPhaseTime(previous.time,previous.getClip().duration,next.getClip().duration)
  :null;
 next.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1);
 if(mirroredTime!==null)next.time=mirroredTime;
 else if(layer==='lower'&&speed<0)next.time=Math.max(0,next.getClip().duration-1e-5);
 if(layer==='lower')actor.rmTimes[name]=next.time;
 next.fadeIn(fade).play();
 if(previous&&previous!==next)previous.fadeOut(fade);
 actor[field]=name;
}

// Identical chop lifecycle on every skeleton. Mixer time is authoritative
// for the actual contact frame; elapsed time blocks upper-body transitions.
export function canTransitionUpperBody(actor,now){
 if(actor.upperState!=='Chop2')return true;
 return now>=actor.chopEnd;
}

function rootStep(THREE,info,from,to,backward){
 return new THREE.Vector3().fromArray(rootMotionSampleDelta(info,from,to,backward));
}

export async function createAnimations(THREE){
 const modelActors=new Set();
 const {createLiteHumanoid,CHARACTER_BODY_ASSETS}=await import('../characters/humanoid/humanoid-lite.js?v=20261105-lumberjack-chop-1812');
 let axeAssetPromise=null;
 const {GLTFLoader}=await import('https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js');
 const loader=new GLTFLoader();

 async function createAvatar(model='male',layer=3){
  if(!Object.hasOwn(CHARACTER_BODY_ASSETS,model))
   throw Error('Unknown character model: '+model);
  const group=new THREE.Group();
  const human=await createLiteHumanoid({
   body:model,face:'default',hair:'short02',top:'shirt',bottom:'jeans',
   shoes:'shoes',outerwear:null,
  });
  human.mixer.stopAllAction();
  human.action=null;
  const visual=human.root,mixer=human.mixer,rawClips=human.clips;
  // One GLB and one in-flight load for every body. Clones share GPU
  // geometry/material resources while keeping independent object transforms.
  if(!axeAssetPromise){
   axeAssetPromise=loader.loadAsync('./'+SHARED_AXE_ASSET).catch(error=>{
    axeAssetPromise=null;
    throw error;
   });
  }
  const axeGLTF=await axeAssetPromise;
  let grip=null;
  axeGLTF.scene.traverse(node=>{if(node.name.startsWith('AXE_GRIP'))grip=node;});
  if(!grip)throw Error('Missing axe grip for '+model);
  // The same AXE_GRIP geometry attaches through one socket API on every
  // rig. Each body can author a grip correction as data without branching
  // on model or modifying weapon geometry or bone animations.
  const axeGrip=human.attach('handRight',grip.clone(true),
    CHARACTER_BODY_ASSETS[model].handRight);
  visual.rotation.y=Math.PI;
  visual.traverse(node=>{if(node.isMesh){node.castShadow=true;node.layers.set(layer);}});
  group.add(visual);
  // REF_* Actions live in the same model but the game needn't allocate
  // animation masks/actions until they are selected for actual gameplay.
  const clips=rawClips.filter(clip=>!clip.name.startsWith('REF_')).map(clip=>{
   const cloned=clip.clone();
   cloned.name=runtimeClipName(model,cloned.name);
   return cloned;
  });
  const names=clips.map(clip=>clip.name);
  if(new Set(names).size!==names.length)
   throw Error('Duplicate '+model+' animation clips: '+names.join(', '));
  const rootMotion=extractRootMotion(THREE,clips);
  const lower={},upper={};
  for(const clip of clips){
   const lo=maskedClip(THREE,clip,false),hi=maskedClip(THREE,clip,true);
   if(lo.tracks.length)lower[clip.name]=mixer.clipAction(lo);
   if(hi.tracks.length)upper[clip.name]=mixer.clipAction(hi);
  }
  for(const name of ['Walk','WalkBackward','RunBackward','StrafeLeft','StrafeRight']){
   lower[name]?.setLoop(THREE.LoopRepeat,Infinity);
   upper[name]?.setLoop(THREE.LoopRepeat,Infinity);
  }
  if(upper.Chop2){upper.Chop2.setLoop(THREE.LoopOnce,1);upper.Chop2.clampWhenFinished=true;}
  const shadowMeshes=[];
  visual.traverse(node=>{if(node.isMesh)shadowMeshes.push(node);});
  const actor={group,visual,mixer,lower,upper,rootMotion,shadowMeshes,human,axeGrip,
   setAxeEquipped(equipped){axeGrip.visible=!!equipped;},
   proceduralLook:createProceduralLook(THREE,human.bones),
   lowerState:'',upperState:'',chopEnd:0,rmTimes:{},model};
  actor.actions={...lower,Chop2:upper.Chop2};
  modelActors.add(actor);
  transitionLayer(THREE,actor,'lower','Idle');
  transitionLayer(THREE,actor,'upper','Idle');
  console.info('[Forest Chopper] Unified character',model, 'rigs=1',
   'Walk', {duration:rootMotion.Walk?.duration,meters:rootMotion.Walk?.travel.length(),nativeSpeed:rootMotionSpeed(rootMotion.Walk)},
   'WalkBackward', {duration:rootMotion.WalkBackward?.duration,meters:rootMotion.WalkBackward?.travel.length(),nativeSpeed:rootMotionSpeed(rootMotion.WalkBackward)},
   'StrafeLeft', {duration:rootMotion.StrafeLeft?.duration,meters:rootMotion.StrafeLeft?.travel.length(),nativeSpeed:rootMotionSpeed(rootMotion.StrafeLeft)},
   'StrafeRight', {duration:rootMotion.StrafeRight?.duration,meters:rootMotion.StrafeRight?.travel.length(),nativeSpeed:rootMotionSpeed(rootMotion.StrafeRight)},
   'Run', {duration:rootMotion.Run?.duration,meters:rootMotion.Run?.travel.length(),nativeSpeed:rootMotionSpeed(rootMotion.Run)},
   'RunBackward', {duration:rootMotion.RunBackward?.duration,meters:rootMotion.RunBackward?.travel.length(),nativeSpeed:rootMotionSpeed(rootMotion.RunBackward)});
  return actor;
 }

 function actorChop(actor,axeSpeed=1){
  const action=actor?.upper?.Chop2;
  if(!action)return;
  if(actor.upperState==='Chop2'){action.stop();actor.upperState='';}
  const playbackSpeed=CHOP_SPEED*Math.max(.1,axeSpeed);
  actor.chopEnd=performance.now()+action.getClip().duration/playbackSpeed*1000+30;
  // Contact is frame 25/30 for each independently authored 53-bone Chop.
  // The visible swing uses the equipped axe's playback rate.
  transitionLayer(THREE,actor,'upper','Chop2',axeSpeed);
 }

 function tickActor(actor,dt,motion='Idle',jumping=false,rate=1){
  const displacement=new THREE.Vector3();
  if(!actor)return displacement;
  actor.rootTravelDistance=0;
  motion=jumping&&actor.lower.Jump?'Jump':actor.lower[motion]?motion:'Idle';
  transitionLayer(THREE,actor,'lower',motion,rate);
  if(canTransitionUpperBody(actor,performance.now()))
   transitionLayer(THREE,actor,'upper',motion,rate);
  // Undo last frame's additive look before the mixer samples the authored
  // animation. Never allow an unkeyed pose to accumulate procedural offsets.
  actor.proceduralLook?.restore();
  // The same mixer that moves the rendered bones supplies Root Motion.
  actor.human.motionName=motion.toLowerCase();
  actor.human.update(dt);
  for(const name of ROOT_MOTIONS){
   const info=actor.rootMotion[name],action=actor.lower[name];
   if(!info||!action)continue;
   const from=actor.rmTimes[name]??action.time,to=action.time;
   actor.rmTimes[name]=to;
   if(!action.isRunning()||action.getEffectiveWeight()<.001||Math.abs(to-from)<1e-9)continue;
   const step=rootStep(THREE,info,from,to,action.getEffectiveTimeScale()<0);
   const weight=action.getEffectiveWeight();
   displacement.addScaledVector(step,weight);
   // Root Motion drives distance even when two cross-fading clips travel in
   // opposing directions. Direction comes from camera-relative input.
   actor.rootTravelDistance+=weightedHorizontalRootTravel(step,weight);
  }
  return displacement.applyQuaternion(actor.visual.quaternion).applyQuaternion(actor.group.quaternion);
 }
 return {modelActors,CHOP_SPEED,createAvatar,actorChop,tickActor};
}
