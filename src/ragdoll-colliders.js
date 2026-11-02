// Rapier-only adapter: converts canonical Collision World primitives into
// rigid bodies. Geometry definitions belong exclusively in collision-world.js.
import {createCollisionWorld} from './collision-world.js';
export {makeGroundMesh} from './collision-world.js';
export const RAGDOLL_ENV_RADIUS=25;
export const RAGDOLL_ENV_REFRESH_DISTANCE=9;
const groups=(0x0001<<16)|0x0002;
const near=(x,z,cx,cz,radius)=>Math.hypot(x-cx,z-cz)<=radius;
export function ragdollObstacleSpecs(ctx,cx,cz,radius=RAGDOLL_ENV_RADIUS,{bed=null}={}){
 return (ctx.collisionWorld??createCollisionWorld(ctx)).collect(cx,cz,radius,{bed});
}
export function createRagdollEnvironment(world,physics,ctx,{x=ctx.px,z=ctx.pz,bed=null}={}){
 const collisionWorld=ctx.collisionWorld??createCollisionWorld(ctx);
 let center={x,z},bodies=[],revision=collisionWorld.revision;
 const fixed=(x,y,z,rotation=null)=>{
  let descriptor=physics.RigidBodyDesc.fixed().setTranslation(x,y,z);
  if(rotation)descriptor=descriptor.setRotation(rotation);
  const body=world.createRigidBody(descriptor);
  bodies.push(body);
  return body;
 };
 function rebuild(x,z){
  for(const body of bodies)world.removeRigidBody(body);
  bodies=[];center={x,z};revision=collisionWorld.revision;
  const ground=fixed(x,0,z);
  const terrain=collisionWorld.terrainMesh(x,z,RAGDOLL_ENV_RADIUS);
  world.createCollider(physics.ColliderDesc.trimesh(terrain.vertices,terrain.indices)
   .setFriction(.9).setCollisionGroups(groups),ground);
  for(const s of collisionWorld.collect(x,z,RAGDOLL_ENV_RADIUS,{bed})){
   const yaw=s.yaw??0;
   const q=s.shape==='capsule'
     ?s.axis==='x'?{x:0,y:0,z:-Math.SQRT1_2,w:Math.SQRT1_2}
       :s.axis==='z'?{x:Math.SQRT1_2,y:0,z:0,w:Math.SQRT1_2}:null
     :yaw?{x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)}:null;
   const body=fixed(s.x,s.y,s.z,q);
   let collider=s.shape==='cylinder'
    ?physics.ColliderDesc.cylinder(s.hy,s.radius)
    :s.shape==='capsule'?physics.ColliderDesc.capsule(s.halfLength,s.radius)
    :physics.ColliderDesc.cuboid(s.hx,s.hy,s.hz);
   if(s.local)collider=collider.setTranslation(s.local.x,s.local.y,s.local.z);
   world.createCollider(collider.setFriction(.95).setCollisionGroups(groups),body);
  }
 }
 rebuild(x,z);
 return {
  refresh(x,z){
   if(collisionWorld.revision!==revision ||
     !near(x,z,center.x,center.z,RAGDOLL_ENV_REFRESH_DISTANCE)){
    rebuild(x,z);return true;
   }
   return false;
  },
  get center(){return {...center};},
  get colliderBodies(){return bodies.length;},
 };
}
