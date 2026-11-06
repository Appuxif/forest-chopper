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
// Rapier 0.20 can panic inside world.step() when many touching rigid bodies
// are destroyed/recreated repeatedly. Keep unchanged static colliders alive
// across Collision World revisions; update only actually modified obstacles.
// Every obstacle spec is geometry/pose data, so identical signatures can be
// safely reused even when collect() returns new JS objects on each call.
export function ragdollObstacleKey(s){
 return JSON.stringify([
  s.kind,s.shape,s.x,s.y,s.z,s.yaw??0,
  s.axis??null,s.halfLength??null,s.radius??null,
  s.hx??null,s.hy??null,s.hz??null,
  s.local?.x??0,s.local?.y??0,s.local?.z??0,
 ]);
}
function sameTerrainMesh(a,b){
 if(!a||!b)return false;
 const equal=(left,right)=>{
  if(left.length!==right.length)return false;
  for(let i=0;i<left.length;i++)if(left[i]!==right[i])return false;
  return true;
 };
 return equal(a.vertices,b.vertices)&&equal(a.indices,b.indices);
}

export function createRagdollEnvironment(world,physics,ctx,{x=ctx.px,z=ctx.pz,bed=null}={}){
 const collisionWorld=ctx.collisionWorld??createCollisionWorld(ctx);
 let center={x,z},obstacles=new Map(),revision=collisionWorld.revision;
 let groundBody=null,groundMesh=null;
 const fixed=(x,y,z,rotation=null)=>{
  let descriptor=physics.RigidBodyDesc.fixed().setTranslation(x,y,z);
  if(rotation)descriptor=descriptor.setRotation(rotation);
  return world.createRigidBody(descriptor);
 };
 function createObstacle(s){
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
  return body;
 }
 function refreshGround(x,z){
  const mesh=collisionWorld.terrainMesh(x,z,RAGDOLL_ENV_RADIUS);
  // Revision may change due to a nearby tree or structure; it does not
  // imply the terrain itself changed. Never churn its trimesh needlessly.
  if(groundBody&&x===center.x&&z===center.z&&sameTerrainMesh(mesh,groundMesh))
   return;
  const previous=groundBody;
  groundBody=fixed(x,0,z);
  world.createCollider(physics.ColliderDesc.trimesh(mesh.vertices,mesh.indices)
   .setFriction(.9).setCollisionGroups(groups),groundBody);
  groundMesh=mesh;
  if(previous)world.removeRigidBody(previous);
 }
 function reconcile(x,z){
  refreshGround(x,z);
  const next=new Map(),counts=new Map();
  for(const s of collisionWorld.collect(x,z,RAGDOLL_ENV_RADIUS,{bed})){
   const signature=ragdollObstacleKey(s);
   // Preserve duplicate colliders if two authored objects happen to share
   // the same geometry and position.
   const index=counts.get(signature)??0;
   counts.set(signature,index+1);
   const key=signature+'#'+index;
   next.set(key,obstacles.get(key)??createObstacle(s));
  }
  for(const [key,body] of obstacles)if(!next.has(key))
   world.removeRigidBody(body);
  obstacles=next;
  center={x,z};
  revision=collisionWorld.revision;
 }
 reconcile(x,z);
 return {
  refresh(x,z){
   if(collisionWorld.revision!==revision ||
     !near(x,z,center.x,center.z,RAGDOLL_ENV_REFRESH_DISTANCE)){
    reconcile(x,z);return true;
   }
   return false;
  },
  get center(){return {...center};},
  get colliderBodies(){return obstacles.size+(groundBody?1:0);},
 };
}
