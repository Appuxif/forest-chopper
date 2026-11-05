import {createMobJoint} from './mob-ragdoll-joints.js';
import {createRagdollEnvironment} from './ragdoll-colliders.js';
import {loadRagdollPhysics} from './rapier-loader.js';

const normalize=name=>String(name).replace(/[._\s-]/g,'').toLowerCase();
function findBones(visual,segments){
 const found=new Map();visual?.traverse?.(node=>{if(node.isBone)found.set(normalize(node.name),node);});
 const bones=new Map();
 for(const {name} of segments){const bone=found.get(normalize(name));if(!bone)throw new Error(`Mob ragdoll: missing bone ${name}`);bones.set(name,bone);}
 return bones;
}

/** Build a detached Rapier simulation from an engine-neutral skeleton profile. */
export async function createMobRagdoll(ctx,visual,{profile,velocityX=0,velocityZ=0,loadPhysics=loadRagdollPhysics}={}){
 const THREE=ctx?.THREE;
 if(!THREE)throw new Error('Mob ragdoll: ctx.THREE is required');
 if(!profile||!Array.isArray(profile.segments)||!profile.segments.length)throw new Error('Mob ragdoll: profile.segments is required');
 const segments=profile.segments;
 const parents=profile.parents??{};
 const bones=findBones(visual,segments);
 visual.updateMatrixWorld(true);
 const points=new Map(),boneWorldQ=new Map();
 for(const [name,bone] of bones){points.set(name,bone.getWorldPosition(new THREE.Vector3()));boneWorldQ.set(name,bone.getWorldQuaternion(new THREE.Quaternion()));}
 const physics=await loadPhysics();
 if(!physics?.World||!physics?.RigidBodyDesc||!physics?.JointData)throw new Error('Mob ragdoll: Rapier physics library unavailable');
 const world=new physics.World({x:0,y:-(ctx.GRAVITY??19),z:0});
 world.integrationParameters.numSolverIterations=profile.solverIterations??12;
 world.integrationParameters.numInternalPgsIterations=profile.internalPgsIterations??2;
 const root=points.get(profile.root??segments[0].name);
 const environment=createRagdollEnvironment(world,physics,ctx,{x:root.x,z:root.z});
 const scale=visual.getWorldScale(new THREE.Vector3()).x,up=new THREE.Vector3(0,1,0),parts=[],byName=new Map();
 const visualRotation=visual.getWorldQuaternion(new THREE.Quaternion());
 try{
  for(const segment of segments){
   const {name,end,radius:baseRadius}=segment,radius=baseRadius*scale,start=points.get(name);
   let finish=end?points.get(end).clone():null;
   if(!finish){const parent=points.get(parents[name]);const direction=parent?start.clone().sub(parent).normalize():up.clone();finish=start.clone().addScaledVector(direction,(segment.tipLength??.12)*scale);}
   const delta=finish.clone().sub(start),length=Math.max((segment.minLength??.09)*scale,delta.length());
   const rotation=new THREE.Quaternion().setFromUnitVectors(up,delta.normalize()),center=start.clone().add(finish).multiplyScalar(.5);
   const body=world.createRigidBody(physics.RigidBodyDesc.dynamic().setTranslation(center.x,center.y,center.z)
    .setRotation({x:rotation.x,y:rotation.y,z:rotation.z,w:rotation.w})
    .setLinearDamping(segment.linearDamping??1.5).setAngularDamping(segment.angularDamping??2.5));
   const density=typeof profile.density==='function'?profile.density(name):segment.density??350;
   const groups=typeof profile.collisionGroups==='function'?profile.collisionGroups(name):segment.collisionGroups??((1<<16)|1);
   world.createCollider(physics.ColliderDesc.capsule(Math.max((segment.minHalfHeight??.015)*scale,length/2-radius*.7),radius)
    .setDensity(density).setFriction(segment.friction??.8).setRestitution(segment.restitution??0).setCollisionGroups(groups),body);
   const inverse=rotation.clone().invert();
   const part={name,bone:bones.get(name),body,attachment:start.clone().sub(center).applyQuaternion(inverse),
    boneOffset:inverse.clone().multiply(boneWorldQ.get(name)),center,rotation};
   parts.push(part);byName.set(name,part);
  }
  for(const part of parts){
   const parent=byName.get(parents[part.name]);if(!parent)continue;
   const config=typeof profile.jointConfig==='function'?profile.jointConfig(part.name):profile.joints?.[part.name];
   createMobJoint(THREE,physics,world,parent,part,points.get(part.name),visualRotation,config??{kind:'spherical'});
  }
  for(const {body} of parts)body.setLinvel({x:velocityX,y:profile.initialVerticalVelocity??.8,z:velocityZ},true);
 }catch(error){world.free();throw error;}
 let disposed=false,elapsed=0,accumulator=0;
 const position=()=>{const p=byName.get(profile.root??segments[0].name).body.translation();return {x:p.x,y:p.y,z:p.z};};
 function tick(dt){
  if(disposed||elapsed>=(profile.lifetime??10))return;
  const lifetime=profile.lifetime??10,step=Math.min(.15,Math.max(0,Number(dt)||0));accumulator+=step;let steps=0;
  while(accumulator>=1/60&&steps++<9&&elapsed<lifetime){world.step();accumulator-=1/60;elapsed=Math.min(lifetime,elapsed+1/60);}
  const p=position();environment.refresh(p.x,p.z);
  const q=new THREE.Quaternion(),parentQ=new THREE.Quaternion(),target=new THREE.Vector3(),newQ=new THREE.Quaternion();
  for(const part of parts){
   const pos=part.body.translation(),rot=part.body.rotation();q.set(rot.x,rot.y,rot.z,rot.w);
   target.copy(part.attachment).applyQuaternion(q).add(new THREE.Vector3(pos.x,pos.y,pos.z));newQ.copy(q).multiply(part.boneOffset);
   const parent=part.bone.parent;parent.updateWorldMatrix(true,false);part.bone.position.copy(parent.worldToLocal(target.clone()));
   parent.getWorldQuaternion(parentQ);part.bone.quaternion.copy(parentQ.invert().multiply(newQ));part.bone.updateMatrixWorld(true);
  }
  visual.updateMatrixWorld(true);
 }
 function dispose(){if(disposed)return;disposed=true;world.free();}
 return {tick,dispose,position,get elapsed(){return elapsed;},get disposed(){return disposed;}};
}
