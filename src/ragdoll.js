import {loadRagdollPhysics} from './rapier-loader.js';
import {createRagdollEnvironment} from './ragdoll-colliders.js';
import {ragdollActivationMotion,applyRagdollMomentum} from './ragdoll-motion.js?v=20261102-bounce-fix1';
import {createRagdollSettling} from './ragdoll-settling.js';
import {calibrateLimbJoint,RAGDOLL_LIMB_END_BONES} from './ragdoll-anatomy.js';
import {stepRagdollPhysics} from './ragdoll-step.js';
export {makeGroundMesh} from './ragdoll-colliders.js';
// Shared local-player ragdoll. Uses the same GLB SkinnedMesh/bones as the
// animated character. Rapier is preloaded during world startup.
const SEGMENTS=[
  ['Hips','Spine',.20],['Spine','Head',.21],['Head',null,.15],
  ['UpperArm.L','Forearm.L',.105],['Forearm.L',null,.09],
  ['UpperArm.R','Forearm.R',.105],['Forearm.R',null,.09],
  ['Thigh.L','Shin.L',.13],['Shin.L',null,.11],
  ['Thigh.R','Shin.R',.13],['Shin.R',null,.11],
];
const PARENTS={
 'Spine':'Hips','Head':'Spine',
 'UpperArm.L':'Spine','Forearm.L':'UpperArm.L',
 'UpperArm.R':'Spine','Forearm.R':'UpperArm.R',
 'Thigh.L':'Hips','Shin.L':'Thigh.L',
 'Thigh.R':'Hips','Shin.R':'Thigh.R',
};
// Character-local axes in the GLB's rest pose; constraints are transformed
// to the local frames of *both* simulated bodies.
const JOINTS={
 'Spine':{kind:'fixed'},
 'Head':{kind:'hinge',axis:[1,0,0],limits:[-.32,.32],spring:9},
 'UpperArm.L':{kind:'hinge',axis:[0,0,1],limits:[-1.3,1.3],spring:2},
 'UpperArm.R':{kind:'hinge',axis:[0,0,1],limits:[-1.3,1.3],spring:2},
 'Forearm.L':{kind:'hinge',axis:[0,0,1],limits:[-.15,1.9],spring:1.5},
 'Forearm.R':{kind:'hinge',axis:[0,0,1],limits:[-1.9,.15],spring:1.5},
 'Thigh.L':{kind:'hinge',axis:[1,0,0],limits:[-.85,.85],spring:4},
 'Thigh.R':{kind:'hinge',axis:[1,0,0],limits:[-.85,.85],spring:4},
 'Shin.L':{kind:'hinge',axis:[1,0,0],limits:[-.25,.7],spring:8},
 'Shin.R':{kind:'hinge',axis:[1,0,0],limits:[-.25,.7],spring:8},
};
// Retain the old joint definitions as baseline physical data for tests and
// debugging. All playable 53-bone bodies use the passive joint overrides.
export const RAGDOLL_JOINTS=JOINTS;
const HUMANOID_JOINT_OVERRIDES={
  Head:{limits:[-.45,.45],spring:1.5},
  'UpperArm.L':{limits:[-1.55,1.55],spring:0},
  'UpperArm.R':{limits:[-1.55,1.55],spring:0},
  'Forearm.L':{limits:[-.15,2.35],spring:0},
  'Forearm.R':{limits:[-2.35,.15],spring:0},
  'Thigh.L':{limits:[-1.3,1.3],spring:0},
  'Thigh.R':{limits:[-1.3,1.3],spring:0},
  'Shin.L':{limits:[-.25,2.15],spring:0},
  'Shin.R':{limits:[-.25,2.15],spring:0},
};
export const RAGDOLL_HUMANOID_JOINTS=Object.fromEntries(
  Object.entries(JOINTS).map(([name,config])=>[
    name,{...config,...HUMANOID_JOINT_OVERRIDES[name]},
  ]),
);
// All selectable models now use the same 53-bone anatomical rig.
export function ragdollJointProfile(model){
 return RAGDOLL_HUMANOID_JOINTS;
}
const normal=name=>name.replace(/[._\s-]/g,'').toLowerCase();
// Historical physics segment IDs map onto a shared 53-bone humanoid rig.
 // The first alias is retained only for older test fixtures and saves.
export const RAGDOLL_BONE_ALIASES={
  Hips:['Hips','pelvis'],
  Spine:['Spine','spine_03'],
  Head:['Head','head'],
  'UpperArm.L':['UpperArm.L','upperarm_l'],
  'Forearm.L':['Forearm.L','lowerarm_l'],
  'UpperArm.R':['UpperArm.R','upperarm_r'],
  'Forearm.R':['Forearm.R','lowerarm_r'],
  'Thigh.L':['Thigh.L','thigh_l'],
  'Shin.L':['Shin.L','calf_l'],
  'Thigh.R':['Thigh.R','thigh_r'],
  'Shin.R':['Shin.R','calf_r'],
};
export const RAGDOLL_BONES=SEGMENTS.map(([name])=>name);
export function findRagdollBones(visual){
 const all=new Map();
 visual?.traverse?.(node=>{
   if(node.isBone)all.set(normal(node.name),node);
 });
 const bones=new Map();
 for(const name of RAGDOLL_BONES){
   const bone=RAGDOLL_BONE_ALIASES[name].map(alias=>all.get(normal(alias))).find(Boolean);
   if(!bone)throw new Error('Ragdoll: missing bone '+name);
   bones.set(name,bone);
 }
 return bones;
}
function vec(v){return {x:v.x,y:v.y,z:v.z};}
function quat(q){return {x:q.x,y:q.y,z:q.z,w:q.w};}
export function createRagdoll(ctx,{loadPhysics=loadRagdollPhysics}={}){
 const THREE=ctx.THREE;
 let physics=null,instance=null,loading=null,physicsFailure=null;
 const state=()=>({
   active:!!instance,loading:!!loading,
   bodies:instance?.parts.length??0,
   hipsHeight:instance?.parts[0]?.body.translation().y??null,
   ...(instance?.settling?.state()??{settled:false,straightening:false,straightenProgress:0}),
   physicsError:physicsFailure,
 });
 async function trigger({allowOnline=false,bed=null,restPose=null,impactSpeed=0}={}){
   if(physicsFailure)throw new Error('Ragdoll physics unavailable until reload: '+physicsFailure);
   if(instance)return state();
   if(loading)return loading;
   // Capture on the input frame, BEFORE loading Rapier asynchronously: a
   // first-time WASM fetch must not erase the velocity of a jump or sprint.
   const initialMotion=ragdollActivationMotion(ctx,{bed:!!bed});
   loading=(async()=>{
     const actor=ctx.ownAvatar;
     if(!actor)throw new Error('3D character has not loaded');
     if(ctx.isOnline?.()&&!allowOnline)throw new Error('Manual ragdoll is offline only');
     if(!physics)physics=await loadPhysics();
     if(!physics?.World||!physics?.RigidBodyDesc||!physics?.JointData)
       throw new Error('Rapier physics library unavailable');
     const bones=findRagdollBones(actor.visual);
     actor.visual.updateMatrixWorld(true);
     const originalActorPosition=actor.group.position.clone();
     const originalActorQuaternion=actor.group.quaternion.clone();
     if(restPose){
       actor.group.position.set(restPose.x,restPose.y,restPose.z);
       actor.group.rotation.order='YXZ';
       actor.group.rotation.set(Math.PI/2,restPose.rotation,0);
       actor.visual.updateMatrixWorld(true);
     }
     const snapshot=[...bones.values()].map(bone=>({
       bone,position:bone.position.clone(),quaternion:bone.quaternion.clone(),
     }));
     const originalRoot=originalActorPosition;
     const world=new physics.World({x:0,y:-(ctx.GRAVITY??19),z:0});
     // Chain constraints need more iterations than the default 4.
     world.integrationParameters.numSolverIterations=12;
     world.integrationParameters.numInternalPgsIterations=2;
     // One local set of static colliders for the terrain, logs, live tree
     // trunks, rock collision volumes and authored building collision boxes.
     // The region is re-created as the physics body travels, not frozen at
     // the position where ragdoll was first enabled.
     const environment=createRagdollEnvironment(world,physics,ctx,{bed});
     const points=new Map(),boneQ=new Map();
     for(const [name,bone] of bones){
       points.set(name,bone.getWorldPosition(new THREE.Vector3()));
       boneQ.set(name,bone.getWorldQuaternion(new THREE.Quaternion()));
     }
     const jointSettings=ragdollJointProfile();
     const anatomicalEnds=new Map(),alignments=new Map();
     for(const [name,boneName] of Object.entries(RAGDOLL_LIMB_END_BONES)){
       // All playable bodies now expose wrists and ankles. Terminal segments
       // should use their real endpoints rather than extrapolated directions.
       const endpoint=actor.human.bones.get(boneName)?.getWorldPosition(new THREE.Vector3());
       if(!endpoint)continue;
       anatomicalEnds.set(name,endpoint);
       const alignment=calibrateLimbJoint(
         points.get(PARENTS[name]),points.get(name),endpoint,{
           // A dead knee must not fold back through ~140° just because the
           // solver finds that pose stable on terrain. Elbows can bend more.
           maxBend:name.startsWith('Shin.')?1.55:2.25,
         });
       if(alignment)alignments.set(name,alignment);
     }
     const parts=[],byName=new Map(),up=new THREE.Vector3(0,1,0);
     for(const [name,endName,radius] of SEGMENTS){
       const bone=bones.get(name),start=points.get(name);
       let finish;
       if(endName)finish=points.get(endName).clone();
       else if(anatomicalEnds.has(name))finish=anatomicalEnds.get(name).clone();
       else if(name==='Head')finish=start.clone().add(new THREE.Vector3(0,.27,0));
       else {
         const parentName=PARENTS[name],direction=start.clone().sub(points.get(parentName)).normalize();
         finish=start.clone().addScaledVector(direction,name.startsWith('Shin')?.40:.27);
       }
       const displacement=finish.clone().sub(start);
       const length=Math.max(.14,displacement.length());
       const direction=displacement.normalize();
       const bodyRotation=new THREE.Quaternion().setFromUnitVectors(up,direction);
       const center=start.clone().add(finish).multiplyScalar(.5);
       const desc=physics.RigidBodyDesc.dynamic()
         .setTranslation(center.x,center.y,center.z)
         .setRotation({x:bodyRotation.x,y:bodyRotation.y,z:bodyRotation.z,w:bodyRotation.w})
         .setLinearDamping(1.25).setAngularDamping(1.4);
       const body=world.createRigidBody(desc);
       const capsule=physics.ColliderDesc.capsule(Math.max(.035,length/2-radius*.65),radius)
         .setDensity(name==='Hips'||name==='Spine'?750:450)
         .setFriction(.85).setRestitution(.0)
         // Floor (1) and the other limbs (2). Directly connected parts are
         // excluded with joint.setContactsEnabled(false) below.
         .setCollisionGroups((0x0002<<16)|0x0003);
       world.createCollider(capsule,body);
       const inv=bodyRotation.clone().invert();
       const attachment=start.clone().sub(center).applyQuaternion(inv);
       const boneOffset=inv.clone().multiply(boneQ.get(name));
       const part={name,bone,body,attachment,boneOffset,center,bodyRotation};
       parts.push(part);byName.set(name,part);
     }
     const jointLinks=new Map();
     for(const part of parts){
       const parentName=PARENTS[part.name];
       const parent=byName.get(parentName);
       if(!parent)continue;
       const joint=points.get(part.name);
       const a=joint.clone().sub(parent.center)
         .applyQuaternion(parent.bodyRotation.clone().invert());
       const b=joint.clone().sub(part.center)
         .applyQuaternion(part.bodyRotation.clone().invert());
       const config=jointSettings[part.name];
       const alignment=alignments.get(part.name);
       let data;
       if(config.kind==='fixed'){
         // Preserve the bind-pose rotation of the torso instead of letting
         // its two tiny capsule bodies hinge through one another.
         const worldFrame=parent.bodyRotation;
         const localA=parent.bodyRotation.clone().invert().multiply(worldFrame);
         const localB=part.bodyRotation.clone().invert().multiply(worldFrame);
         data=physics.JointData.fixed(vec(a),quat(localA),vec(b),quat(localB));
       }else{
         const axis=alignment
           ?new THREE.Vector3(alignment.axis.x,alignment.axis.y,alignment.axis.z)
           :new THREE.Vector3(...config.axis)
             .applyQuaternion(actor.group.quaternion)
             .applyQuaternion(actor.visual.quaternion).normalize();
         const axisA=axis.clone().applyQuaternion(parent.bodyRotation.clone().invert());
         const axisB=axis.clone().applyQuaternion(part.bodyRotation.clone().invert());
         data=physics.JointData.revoluteWithAxes(vec(a),vec(b),vec(axisA),vec(axisB));
       }
       const link=world.createImpulseJoint(data,parent.body,part.body,true);
       jointLinks.set(part.name,link);
       link.setContactsEnabled(false);
       if(config.kind==='hinge'){
         // Align *both* joint frames to the same world-space reference in the
         // current pose. Otherwise Rapier can interpret the bind pose as a
         // 180-degree rotation and actively fold the knee backward on spawn.
         const axis=alignment
           ?new THREE.Vector3(alignment.axis.x,alignment.axis.y,alignment.axis.z)
           :new THREE.Vector3(...config.axis)
             .applyQuaternion(actor.group.quaternion)
             .applyQuaternion(actor.visual.quaternion).normalize();
         const restFrame=new THREE.Quaternion().setFromUnitVectors(
           new THREE.Vector3(1,0,0),axis);
         const localParent=parent.bodyRotation.clone().invert().multiply(restFrame);
         const localChild=part.bodyRotation.clone().invert().multiply(restFrame);
         link.setLocalFrame1(vec(a),quat(localParent));
         link.setLocalFrame2(vec(b),quat(localChild));
         link.setLimits(...(alignment?.limits??config.limits));
         // The classic rig keeps its original pose-restoring springs. On the
         // 53-bone models the limbs are passive: zero motor force lets gravity
         // and contacts bend them rather than elastically straighten them.
         if(config.spring>0)
           link.configureMotorPosition(0,config.spring,0.7);
       }
     }
     // Transfer the same world-space linear and yaw velocity to all capsule
     // bodies. Damping, friction and collisions then dissipate the inherited
     // momentum naturally, without continuing to apply walking controls.
     applyRagdollMomentum(parts,initialMotion);
     // A small forward impulse makes the body topple instead of concertina
     // collapsing in place under perfectly symmetrical gravity.
     const facing=new THREE.Vector3(0,0,-1).applyQuaternion(actor.group.quaternion);
     const onLanding=impactSpeed>0&&ctx.onGround;
     if(!bed)byName.get('Spine').body.applyImpulse({
       x:facing.x*(onLanding?1.5:11),y:0,z:facing.z*(onLanding?1.5:11)
     },true);
     // A very gentle push on the head nudges it in the character's forward
     // direction. The neck hinge transfers the motion to the body.
     if(!bed){
       byName.get('Head').body.applyImpulse({
         x:facing.x*(onLanding?.3:1.1),y:0,z:facing.z*(onLanding?.3:1.1)
       },true);
       byName.get('Spine').body.applyTorqueImpulse({x:onLanding?-.7:-4,y:0,z:0},true);
     }
     // Store the animated pose before handing the very same GLB to physics.
     actor.mixer.stopAllAction();
     // During physics the actor's Group stays at its old location while the
     // bones move in world space. Preserve the standing pelvis-to-feet offset
     // so movement/camera can follow the actual simulated body instead.
     const standingHipOffset=parts[0].body.translation().y-ctx.feetY;
     // Ragdoll bones deform outside the GLB's standing bounding spheres.
     // Don't cull an entire skinned mesh when turning the camera around.
     const culling=[];
     actor.visual.traverse(node=>{
       if(node.isSkinnedMesh){culling.push([node,node.frustumCulled]);node.frustumCulled=false;}
     });
     // All playable models now share the 53-bone humanoid rig. Only a
     // deliberate bed/sleep pose should disable passive settling.
     const targets=new Map([...alignments].map(([name,config])=>[name,config.target]));
     const settling=createRagdollSettling(parts,jointLinks,{
       enabled:!bed,targets,
     });
     instance={world,parts,actor,snapshot,originalRoot,originalActorQuaternion,
       standingHipOffset,culling,environment,initialMotion,settling,accumulator:0,elapsed:0};
     ctx.ragdollCamera?.enter?.();
     return state();
   })();
   try{await loading;}finally{loading=null;}
   return state();
 }
 // Never call Rapier again after a WASM failure. wasm-bindgen can leave
 // a borrowed Rust object poisoned, so even world.free() may throw.
 // Releasing JS state still lets the death screen reach Respawn or the
 // manual ragdoll controller return to regular player movement.
 function onPhysicsFailure(error){
   const failed=instance;
   if(!failed)return;
   physicsFailure=String(error?.message??error);
   console.error('[Forest Chopper] Ragdoll physics failed; gameplay can continue without it.',error);
   instance=null;
   const {actor,snapshot,originalActorQuaternion,culling}=failed;
   for(const [mesh,enabled] of culling??[])mesh.frustumCulled=enabled;
   actor.mixer.stopAllAction();
   for(const {bone,position,quaternion} of snapshot){
     bone.position.copy(position);bone.quaternion.copy(quaternion);
   }
   // Use the last valid logical player location, not the simulated pelvis
   // whose Rapier handles may have become invalid.
   actor.group.position.set(ctx.px,ctx.feetY,ctx.pz);
   actor.group.quaternion.copy(originalActorQuaternion);
   actor.group.rotation.set(0,ctx.yaw,0);
   actor.visual.updateMatrixWorld(true);
   actor.lowerState='';actor.upperState='';
   actor.rmTimes={};actor.chopEnd=0;
   ctx.ragdollCamera?.exit?.();
   ctx.ragdollControls?.abort?.();
   ctx.notify?.('Ошибка физики ragdoll. Можно продолжить игру или возродиться.','warning','ragdoll-physics-failed');
 }
 function tick(dt){
   if(!instance)return;
   const {parts,actor}=instance;
   try{
     stepRagdollPhysics(instance,dt);
     const hip=parts[0].body.translation();
     instance.environment.refresh(hip.x,hip.z);
   const q=new THREE.Quaternion(),parentQ=new THREE.Quaternion();
   const target=new THREE.Vector3(),newQ=new THREE.Quaternion();
   // Parent-to-child order: physics drives every bone's joint location and
   // orientation, so the original skinned meshes deform with the ragdoll.
   for(const part of parts){
     const p=part.body.translation(),rot=part.body.rotation();
     q.set(rot.x,rot.y,rot.z,rot.w);
     target.copy(part.attachment).applyQuaternion(q)
       .add(new THREE.Vector3(p.x,p.y,p.z));
     newQ.copy(q).multiply(part.boneOffset);
     const parent=part.bone.parent;
     parent.updateWorldMatrix(true,false);
     part.bone.position.copy(parent.worldToLocal(target.clone()));
     parent.getWorldQuaternion(parentQ);
     part.bone.quaternion.copy(parentQ.invert().multiply(newQ));
     part.bone.updateMatrixWorld(true);
   }
   actor.visual.updateMatrixWorld(true);
   }catch(error){onPhysicsFailure(error);}
 }
 function pose(){
   if(!instance)return null;
   const hip=instance.parts[0].body;
   const p=hip.translation(),v=hip.linvel();
   return {x:p.x,z:p.z,hipsY:p.y,
     feetY:p.y-instance.standingHipOffset,standingHipOffset:instance.standingHipOffset,
     vy:v.y};
 }
 function reset(){
   if(!instance)return false;
   const {actor,snapshot,originalRoot,originalActorQuaternion,world,culling}=instance;
   instance=null;
   try{
     world.free();
   }catch(error){
     // A WASM failure must not stop a death respawn or manual stand-up.
     // Mark the physics module unusable for the remainder of this session.
     physicsFailure=String(error?.message??error);
     console.warn('[Forest Chopper] Failed to free ragdoll physics world:',error);
     physics=null;
   }
   for(const [mesh,enabled] of culling??[])mesh.frustumCulled=enabled;
   // All exit paths pass through this reset: manual get-up, bed wake-up,
   // death respawn, restored saves, and late asynchronous death physics.
   ctx.ragdollCamera?.exit?.();
   // A click on the canvas during physics used to launch Chop2. An action
   // started after ragdoll activation must not outlive the reset: when only
   // the state names were cleared, its animation tracks kept overriding Idle.
   actor.mixer.stopAllAction();
   for(const {bone,position,quaternion} of snapshot){
     bone.position.copy(position);bone.quaternion.copy(quaternion);
   }
   actor.group.position.copy(originalRoot);
   actor.group.quaternion.copy(originalActorQuaternion);
   actor.visual.updateMatrixWorld(true);
   actor.lowerState='';actor.upperState='';
   actor.rmTimes={};actor.chopEnd=0;
   // Normal actor tick will start Idle next frame.
   return true;
 }
 return {trigger,tick,reset,pose,state,get active(){return !!instance;}};
}
