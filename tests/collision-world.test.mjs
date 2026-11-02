import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createCollisionWorld,collisionLog,collisionRock,collisionTree,collisionStructure,
 shapeFootprint,shapeHeight,
} from '../src/collision-world.js';
import {createKinematicCollisionAdapter} from '../src/collision-kinematic.js';
import {ragdollObstacleSpecs} from '../src/ragdoll-colliders.js';

function fixture(){
 const ctx={terrain:{heightAt:()=>0},logRadius:.29,chunkSize:24,
  PLAYER_RADIUS:.31,PLAYER_HEIGHT:1.7,
  placed:[{x:0,y:.29,z:0,orientation:0}],
  trees:new Map([['a',{position:{x:5,y:0,z:2},userData:{h:8}}]]),
  rockColliders:new Map([['0,0',[{x:2,z:0,bottom:0,top:.9,radius:.5}]]]),
  crafting:{items:new Map()},campStructures:{items:new Map()},
 };
 ctx.collisionWorld=createCollisionWorld(ctx);
 return ctx;
}
test('both adapters consume exactly the same live obstacle geometry',()=>{
 const ctx=fixture(),world=ctx.collisionWorld;
 const specs=world.collect(0,0,10);
 assert.deepEqual(specs,ragdollObstacleSpecs(ctx,0,0,10));
 const adapter=createKinematicCollisionAdapter(world,ctx);
 const log=specs.find(s=>s.kind==='log');
 assert.deepEqual(log,collisionLog(ctx.placed[0]));
 assert.ok(adapter.blocked(0,0,0));
 assert.ok(adapter.blocked(2,0,0));
 assert.equal(adapter.support(0,0,1,-1),.58);
 assert.equal(adapter.support(2,0,1,-1),.9);
 assert.equal(shapeHeight(log).top,adapter.logTop(ctx.placed[0]));
 const tree=specs.find(s=>s.kind==='tree');
 assert.deepEqual(tree,collisionTree(ctx.trees.get('a')));
 assert.equal(tree.radius,.75);
 assert.equal(adapter.blocked(5,2,0,{includeTrees:true}),true);
 assert.deepEqual(specs.find(s=>s.kind==='rock'),collisionRock(ctx.rockColliders.get('0,0')[0]));
});
test('live add, remove and log rotation update both adapters without rebuilding or duplicating world',()=>{
 const ctx=fixture(),world=ctx.collisionWorld;
 const adapter=createKinematicCollisionAdapter(world,ctx);
 assert.equal(adapter.blocked(0,0,0),true);
 const before=world.revision;
 ctx.placed.pop();world.invalidate();
 assert.equal(world.revision,before+1);
 assert.equal(adapter.blocked(0,0,0),false);
 assert.equal(ragdollObstacleSpecs(ctx,0,0,6).some(s=>s.kind==='log'),false);
 const log={x:0,y:.29,z:0,orientation:1};
 ctx.placed.push(log);world.invalidate();
 assert.equal(adapter.logFootprint(log,0,1),true);
 assert.equal(adapter.logFootprint(log,1,0),false);
 assert.equal(world.collect(0,0,6).find(s=>s.kind==='log').axis,'z');
});
test('rotated authored boxes match kinematic queries and Rapier quaternion placement',()=>{
 const ctx=fixture();
 ctx.crafting.items.set(1,{kind:'bench',x:8,z:0,orientation:1,group:{
  rotation:{y:Math.PI/2},position:{x:8,y:0,z:0},userData:{collisionRadius:2,
   collisionBoxes:[{x:.75,y:1,z:0,w:.2,h:2,d:.8}]},
 }});
 const shapes=[...collisionStructure(ctx.crafting.items.get(1))];
 assert.equal(shapes.length,1);
 assert.equal(shapeFootprint(shapes[0],8,-.75,.1),true);
 assert.equal(shapeFootprint(shapes[0],8.75,0,.1),false);
 const adapter=createKinematicCollisionAdapter(ctx.collisionWorld,ctx);
 assert.equal(adapter.blocked(8,-.75,0),true);
 assert.equal(adapter.blocked(8.75,0,0),false);
 assert.deepEqual(ctx.collisionWorld.collect(8,0,3).find(s=>s.kind==='structure'),shapes[0]);
});
test('storage collision geometry is shared by walking and ragdoll, including live mutations',()=>{
 const ctx=fixture(),world=ctx.collisionWorld;
 const storage={id:20,kind:'chest',x:11,z:2,group:{
   position:{x:11,y:0,z:2},rotation:{y:0},userData:{
     collisionRadius:1.5,collisionBoxes:[{x:0,y:.48,z:0,w:1.45,h:.75,d:.95}],
   }}};
 ctx.storages={structures:new Map([[storage.id,storage]])};
 world.invalidate();
 const avatar=createKinematicCollisionAdapter(world,ctx);
 assert.equal(avatar.blocked(11,2,0),true);
 const shared=world.collect(11,2,2).find(s=>s.kind==='structure');
 assert.ok(shared);
 assert.deepEqual(shared,ragdollObstacleSpecs(ctx,11,2,2).find(s=>s.kind==='structure'));
 ctx.storages.structures.delete(20);world.invalidate();
 assert.equal(avatar.blocked(11,2,0),false);
 assert.equal(world.collect(11,2,2).some(s=>s.kind==='structure'),false);
});
test('upright log collision maintains vertical top and circular footprint',()=>{
 const shape=collisionLog({x:3,z:4,y:2,orientation:2});
 assert.equal(shape.shape,'capsule');
 assert.equal(shape.axis,'y');
 assert.equal(shapeHeight(shape).top,3.5);
 assert.equal(shapeHeight(shape).bottom,.5);
 assert.equal(shapeFootprint(shape,3.28,4,0),true);
 assert.equal(shapeFootprint(shape,3.4,4,0),false);
});
