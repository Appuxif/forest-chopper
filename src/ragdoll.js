import {logHalfExtents} from './log-grid.js';
// Shared local-player ragdoll. Uses the same GLB SkinnedMesh/bones as the
// animated character. Rapier is loaded only when a death or DEBUG trigger occurs.
const RAPIER_URL='https://esm.sh/@dimforge/rapier3d-compat@0.20.0?bundle';
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
export const RAGDOLL_JOINTS=JOINTS;
const normal=name=>name.replace(/[._\s-]/g,'').toLowerCase();
export const RAGDOLL_BONES=SEGMENTS.map(([name])=>name);
export function findRagdollBones(visual){
 const all=new Map();
 visual?.traverse?.(node=>{
   if(node.isBone)all.set(normal(node.name),node);
 });
 const bones=new Map();
 for(const name of RAGDOLL_BONES){
   const bone=all.get(normal(name));
   if(!bone)throw new Error('Ragdoll: missing bone '+name);
   bones.set(name,bone);
 }
 return bones;
}
export function makeGroundMesh(terrain,x,z,size=14,step=1.5){
 const vertices=[],indices=[],sections=Math.ceil(size*2/step);
 const side=sections+1;
 const start=-sections*step/2;
 for(let ix=0;ix<=sections;ix++)
   for(let iz=0;iz<=sections;iz++){
     const dx=start+ix*step,dz=start+iz*step;
     vertices.push(dx,terrain.heightAt(x+dx,z+dz),dz);
   }
 for(let ix=0;ix<sections;ix++)for(let iz=0;iz<sections;iz++){
   const a=ix*side+iz,b=(ix+1)*side+iz,c=a+1,d=b+1;
   indices.push(a,c,b,b,c,d);
 }
 return {vertices:new Float32Array(vertices),indices:new Uint32Array(indices)};
}
function vec(v){return {x:v.x,y:v.y,z:v.z};}
function quat(q){return {x:q.x,y:q.y,z:q.z,w:q.w};}
export function createRagdoll(ctx,{loadPhysics=async()=>{
 const module=await import(RAPIER_URL),rapier=module.default??module;
 if(typeof rapier.init==='function')await rapier.init();
 return rapier;
}}={}){
 const THREE=ctx.THREE;
 let physics=null,instance=null,loading=null;
 const state=()=>({
   active:!!instance,loading:!!loading,
   bodies:instance?.parts.length??0,
   hipsHeight:instance?.parts[0]?.body.translation().y??null,
 });
 async function trigger({allowOnline=false,bed=null,restPose=null}={}){
   if(instance)return state();
   if(loading)return loading;
   loading=(async()=>{
     const actor=ctx.ownAvatar;
     if(!actor)throw new Error('3D character has not loaded');
     if(ctx.isOnline?.()&&!allowOnline)throw new Error('Manual ragdoll is offline only');
     if(!physics)physics=await loadPhysics();
     if(!physics?.World||!physics?.RigidBodyDesc||!physics?.JointData)
       throw new Error('Rapier physics library unavailable');
     if(!ctx.thirdPerson)ctx.toggleView?.();
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
     const world=new physics.World({x:0,y:-9.81,z:0});
     // Chain constraints need more iterations than the default 4.
     world.integrationParameters.numSolverIterations=12;
     world.integrationParameters.numInternalPgsIterations=2;
     const groundBody=world.createRigidBody(physics.RigidBodyDesc.fixed()
       .setTranslation(ctx.px,0,ctx.pz));
     const groundMesh=makeGroundMesh(ctx.terrain,ctx.px,ctx.pz);
     const floorDesc=physics.ColliderDesc.trimesh(groundMesh.vertices,groundMesh.indices)
       .setFriction(.9).setCollisionGroups((0x0001<<16)|0x0002);
     world.createCollider(floorDesc,groundBody);
     // User-built ramps must remain physical while the normal character
     // controller is suspended. Box proxies match the walking collision tops.
     for(const log of ctx.placed??[]){
       if(Math.hypot(log.x-ctx.px,log.z-ctx.pz)>14)continue;
       const half=logHalfExtents(log,ctx.logRadius??.29);
       const solid=world.createRigidBody(physics.RigidBodyDesc.fixed()
         .setTranslation(log.x,log.y,log.z));
       world.createCollider(physics.ColliderDesc.cuboid(half.x,half.y,half.z)
         .setFriction(.9).setCollisionGroups((0x0001<<16)|0x0002),solid);
     }
     if(bed){
       // Mattress top is y=.60 in the authored bed mesh.
       const base=ctx.terrain.heightAt(bed.x,bed.z);
       const bedBody=world.createRigidBody(physics.RigidBodyDesc.fixed()
         .setTranslation(bed.x,base+.51,bed.z)
         .setRotation({x:0,y:Math.sin(bed.orientation*Math.PI/4),
           z:0,w:Math.cos(bed.orientation*Math.PI/4)}));
       world.createCollider(physics.ColliderDesc.cuboid(.52,.09,.83)
         .setFriction(.9).setCollisionGroups((0x0001<<16)|0x0002),bedBody);
     }
     const points=new Map(),boneQ=new Map();
     for(const [name,bone] of bones){
       points.set(name,bone.getWorldPosition(new THREE.Vector3()));
       boneQ.set(name,bone.getWorldQuaternion(new THREE.Quaternion()));
     }
     const parts=[],byName=new Map(),up=new THREE.Vector3(0,1,0);
     for(const [name,endName,radius] of SEGMENTS){
       const bone=bones.get(name),start=points.get(name);
       let finish;
       if(endName)finish=points.get(endName).clone();
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
         .setLinearDamping(.55).setAngularDamping(2.7);
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
     for(const part of parts){
       const parentName=PARENTS[part.name];
       const parent=byName.get(parentName);
       if(!parent)continue;
       const joint=points.get(part.name);
       const a=joint.clone().sub(parent.center)
         .applyQuaternion(parent.bodyRotation.clone().invert());
       const b=joint.clone().sub(part.center)
         .applyQuaternion(part.bodyRotation.clone().invert());
       const config=JOINTS[part.name];
       let data;
       if(config.kind==='fixed'){
         // Preserve the bind-pose rotation of the torso instead of letting
         // its two tiny capsule bodies hinge through one another.
         const worldFrame=parent.bodyRotation;
         const localA=parent.bodyRotation.clone().invert().multiply(worldFrame);
         const localB=part.bodyRotation.clone().invert().multiply(worldFrame);
         data=physics.JointData.fixed(vec(a),quat(localA),vec(b),quat(localB));
       }else{
         const axis=new THREE.Vector3(...config.axis)
           .applyQuaternion(actor.group.quaternion)
           .applyQuaternion(actor.visual.quaternion).normalize();
         const axisA=axis.clone().applyQuaternion(parent.bodyRotation.clone().invert());
         const axisB=axis.clone().applyQuaternion(part.bodyRotation.clone().invert());
         data=physics.JointData.revoluteWithAxes(vec(a),vec(b),vec(axisA),vec(axisB));
       }
       const link=world.createImpulseJoint(data,parent.body,part.body,true);
       link.setContactsEnabled(false);
       if(config.kind==='hinge'){
         // Align *both* joint frames to the same world-space reference in the
         // current pose. Otherwise Rapier can interpret the bind pose as a
         // 180-degree rotation and actively fold the knee backward on spawn.
         const axis=new THREE.Vector3(...config.axis)
           .applyQuaternion(actor.group.quaternion)
           .applyQuaternion(actor.visual.quaternion).normalize();
         const restFrame=new THREE.Quaternion().setFromUnitVectors(
           new THREE.Vector3(1,0,0),axis);
         const localParent=parent.bodyRotation.clone().invert().multiply(restFrame);
         const localChild=part.bodyRotation.clone().invert().multiply(restFrame);
         link.setLocalFrame1(vec(a),quat(localParent));
         link.setLocalFrame2(vec(b),quat(localChild));
         link.setLimits(...config.limits);
         // Weak pose-restoring angular motor, not a permanent animation:
         // keeps knees and elbows from instantly folding flat, while gravity
         // and collisions still move the limbs naturally.
         link.configureMotorPosition(0,config.spring,1.6);
       }
     }
     // A small forward impulse makes the body topple instead of concertina
     // collapsing in place under perfectly symmetrical gravity.
     const facing=new THREE.Vector3(0,0,-1).applyQuaternion(actor.group.quaternion);
     if(!bed)byName.get('Spine').body.applyImpulse({
       x:facing.x*11,y:0,z:facing.z*11
     },true);
     // A very gentle push on the head nudges it in the character's forward
     // direction. The neck hinge transfers the motion to the body.
     if(!bed){
       byName.get('Head').body.applyImpulse({
         x:facing.x*1.1,y:0,z:facing.z*1.1
       },true);
       byName.get('Spine').body.applyTorqueImpulse({x:-4,y:0,z:0},true);
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
     instance={world,parts,actor,snapshot,originalRoot,originalActorQuaternion,
       standingHipOffset,culling,accumulator:0,elapsed:0};
     return state();
   })();
   try{await loading;}finally{loading=null;}
   return state();
 }
 function tick(dt){
   if(!instance)return;
   const {world,parts,actor}=instance;
   instance.accumulator=Math.min(.15,instance.accumulator+Math.max(0,dt));
   let steps=0;
   while(instance.accumulator>=1/60&&steps++<7){
     world.step();
     instance.accumulator-=1/60;
     instance.elapsed+=1/60;
   }
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
   world.free();
   for(const [mesh,enabled] of culling??[])mesh.frustumCulled=enabled;
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
