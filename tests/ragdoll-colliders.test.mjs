import {createCollisionWorld} from '../src/collision-world.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ragdollObstacleSpecs,createRagdollEnvironment,RAGDOLL_ENV_RADIUS,
 RAGDOLL_ENV_REFRESH_DISTANCE} from '../src/ragdoll-colliders.js';

function fixture(){
 const camp=new Map([['bed',{id:'bed',kind:'bed',x:3,z:0,orientation:1,
   group:{position:{x:3,y:0,z:0},rotation:{y:Math.PI/2},userData:{
    collisionRadius:3,collisionBoxes:[{x:0,y:.47,z:0,w:1.1,h:.26,d:1.78}],
   }}}]]);
 const bench={id:'b',x:1,z:2,orientation:1,group:{
   position:{x:1,y:.3,z:2},rotation:{y:Math.PI/2},userData:{
    collisionRadius:3,collisionBoxes:[{x:.2,y:.5,z:0,w:2,h:.2,d:1}],
   }}};
 const rockColliders=new Map([['0,0',[{x:2,z:1,radius:.5,bottom:.3,top:1.3}]],
  ['1,0',[{x:24.5,z:1,radius:.7,bottom:.2,top:1.5}]]]);
 return {
  px:0,pz:0,terrain:{heightAt:()=>0},logRadius:.29,chunkSize:24,
  placed:[{x:0,y:.29,z:2,orientation:0}],
  trees:new Map([['tree',{position:{x:4,y:0,z:0},userData:{h:12,scale:1.2}}]]),
  rockColliders,crafting:{items:new Map([['b',bench]])},
  campStructures:{items:camp},
 };
}
test('environment uses logical logs, trunks, rocks and authored rotated structure boxes',()=>{
 const specs=ragdollObstacleSpecs(fixture(),0,0);
 assert.ok(specs.some(s=>s.kind==='log'&&s.shape==='capsule'&&s.halfLength===1.5&&s.radius===.29));
 assert.ok(specs.some(s=>s.kind==='tree'&&s.shape==='cylinder'&&s.hy===6));
 assert.equal(specs.filter(s=>s.kind==='rock').length,2,'adjacent-chunk rocks included');
 const bench=specs.find(s=>s.kind==='structure'&&s.x===1);
 assert.equal(bench.yaw,Math.PI/2);
 assert.deepEqual(bench.local,{x:.2,y:.5,z:0});
 assert.ok(specs.some(s=>s.kind==='structure'&&s.x===3));
 assert.equal(specs.filter(s=>s.kind==='mattress').length,0);
 const sleeping=ragdollObstacleSpecs(fixture(),0,0,RAGDOLL_ENV_RADIUS,
   {bed:{id:'bed',kind:'bed',x:3,z:0,orientation:1}});
 assert.equal(sleeping.filter(s=>s.kind==='mattress').length,1);
 assert.equal(sleeping.filter(s=>s.kind==='structure'&&s.x===3).length,0,
   'do not create duplicate bed colliders');
});
test('Rapier environment creates fixed physical colliders and refreshes after travel',()=>{
 const world={created:[],removed:[],colliders:[],
  createRigidBody(desc){const body={desc};this.created.push(body);return body;},
  removeRigidBody(body){this.removed.push(body);},
  createCollider(desc,body){this.colliders.push({desc,body});return desc;}};
 class Desc{
  constructor(kind,...args){this.kind=kind;this.args=args;}
  setTranslation(...v){this.translation=v;return this;}
  setRotation(v){this.rotation=v;return this;}
  setFriction(v){this.friction=v;return this;}
  setCollisionGroups(v){this.groups=v;return this;}
 }
 const physics={RigidBodyDesc:{fixed:()=>new Desc('fixed')},ColliderDesc:{
  trimesh:(...v)=>new Desc('terrain',...v),
  cuboid:(...v)=>new Desc('box',...v),
  cylinder:(...v)=>new Desc('cylinder',...v),
  capsule:(...v)=>new Desc('capsule',...v),
 }};
 const env=createRagdollEnvironment(world,physics,fixture());
 assert.ok(env.colliderBodies>4);
 assert.ok(world.colliders.some(x=>x.desc.kind==='terrain'));
 assert.ok(world.colliders.some(x=>x.desc.kind==='cylinder'));
 assert.ok(world.colliders.some(x=>x.desc.kind==='capsule'));
 assert.ok(world.created.some(x=>x.desc.rotation?.z<0),
   'horizontal log has physical rotation to match the shared capsule axis');
 assert.ok(world.created.some(x=>x.desc.rotation?.y>0),
   'a rotated bench must retain its orientation');
 assert.equal(env.refresh(RAGDOLL_ENV_REFRESH_DISTANCE/2,0),false);
 const old=env.colliderBodies;
 assert.equal(env.refresh(RAGDOLL_ENV_REFRESH_DISTANCE+1,0),true);
 assert.equal(world.removed.length,1,'only displaced terrain is replaced');
 assert.equal(env.colliderBodies,old,'in-range obstacles keep their original bodies');
 assert.equal(env.center.x,RAGDOLL_ENV_REFRESH_DISTANCE+1);
 assert.equal(env.refresh(RAGDOLL_ENV_REFRESH_DISTANCE+2,0),false);
});
test('Rapier adapter invalidates old obstacle bodies as soon as shared world changes',()=>{
 const ctx=fixture();
 ctx.collisionWorld=createCollisionWorld(ctx);
 const world={bodies:[],removed:[],
  createRigidBody(desc){const b={desc};this.bodies.push(b);return b;},
  createCollider(){},removeRigidBody(body){this.removed.push(body);}};
 const desc=kind=>(...args)=>({kind,args,
  setTranslation(){return this;},setRotation(){return this;},
  setFriction(){return this;},setCollisionGroups(){return this;}});
 const physics={RigidBodyDesc:{fixed:desc('fixed')},ColliderDesc:{
  trimesh:desc('mesh'),cuboid:desc('box'),cylinder:desc('cylinder'),capsule:desc('capsule'),
 }};
 const env=createRagdollEnvironment(world,physics,ctx);
 const start=env.colliderBodies;
 ctx.placed.length=0;
 ctx.collisionWorld.invalidate();
 assert.equal(env.refresh(0,0),true,'same position must refresh after construction change');
 assert.equal(world.removed.length,1,'only the removed log collider is disposed');
 assert.equal(env.colliderBodies,start-1);
 assert.equal(env.refresh(0,0),false,'no rebuild without a new revision');
});


test('unchanged collision revisions do not recreate physics bodies',()=>{
 const ctx=fixture();
 ctx.collisionWorld=createCollisionWorld(ctx);
 const world={created:[],removed:[],
  createRigidBody(desc){const body={desc};this.created.push(body);return body;},
  removeRigidBody(body){this.removed.push(body);},
  createCollider(){}};
 const descriptor=kind=>(...args)=>({kind,args,
  setTranslation(){return this;},setRotation(){return this;},
  setFriction(){return this;},setCollisionGroups(){return this;}});
 const physics={RigidBodyDesc:{fixed:descriptor('fixed')},ColliderDesc:{
  trimesh:descriptor('trimesh'),cuboid:descriptor('cuboid'),
  cylinder:descriptor('cylinder'),capsule:descriptor('capsule'),
 }};
 const env=createRagdollEnvironment(world,physics,ctx);
 const initial=world.created.length;
 for(let i=0;i<50;i++){
  ctx.collisionWorld.invalidate();
  assert.equal(env.refresh(0,0),true);
 }
 assert.equal(world.created.length,initial,'the existing ground and obstacles are reused');
 assert.equal(world.removed.length,0,'revision alone does not remove colliders');
 assert.equal(env.colliderBodies,initial);
 // Replacing only the bench shape must leave the ground, rocks and logs intact.
 const bench=ctx.crafting.items.get('b');
 bench.group.userData.collisionBoxes[0].w+=.2;
 ctx.collisionWorld.invalidate();
 assert.equal(env.refresh(0,0),true);
 assert.equal(world.created.length,initial+1);
 assert.equal(world.removed.length,1);
 ctx.collisionWorld.invalidate();
 env.refresh(0,0);
 assert.equal(world.created.length,initial+1,'the changed shape is reused after further revisions');
 assert.equal(world.removed.length,1);
});
