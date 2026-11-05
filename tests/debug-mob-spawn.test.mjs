import test from 'node:test';
import assert from 'node:assert/strict';
import {createMobWorld} from '../src/mob-world.js';
import {createMobTypeRegistry} from '../src/mob-types.js';
import {createDebugMobSpawner} from '../src/debug-mob-spawn.js';

test('debug spawns reuse normal AI/death/loot, preserve chosen color and never enter save/respawn state',()=>{
 const world=createMobWorld({seed:123});world.tick(0,[{x:0,z:0}]);
 const before=world.snapshot();const mob=world.spawnTransient('chicken',2,-2,{subcategory:'white'});
 assert.ok(mob);assert.equal(mob.subcategory,'white');assert.equal(mob.transient,true);
 let records=world.tick(.1,[{x:0,z:0}]);assert.equal(records.find(r=>r.id===mob.id).state,'Run');
 assert.equal(world.hit(mob.id,{id:'p',faction:'players',x:0,z:0}),true);
 records=world.tick(0,[{x:0,z:0}]);const corpse=records.find(r=>r.id===mob.id);
 assert.equal(corpse.hp,0);assert.ok(corpse.loot.chicken_meat>=1);assert.ok(corpse.loot.feather>=1);
 const saved=world.snapshot();assert.deepEqual(saved.populations.chicken.generations,before.populations.chicken.generations);
 assert.equal(JSON.stringify(saved).includes(':debug:'),false);
 assert.deepEqual(world.clearTransient(),[mob.id]);assert.equal(world.tick(0,[{x:0,z:0}]).some(r=>r.id===mob.id),false);
});
test('transient spawns are bounded and validate coordinates, ground and color',()=>{
 const world=createMobWorld({seed:4,canStand:(x,z)=>z<=0});
 assert.equal(world.spawnTransient('chicken',NaN,0),null);
 assert.equal(world.spawnTransient('chicken',0,3),null);
 assert.equal(world.spawnTransient('chicken',0,0,{subcategory:'invalid'}),null);
 for(let i=0;i<8;i++)assert.ok(world.spawnTransient('chicken',i,-2));
 assert.equal(world.spawnTransient('chicken',0,-2),null);assert.equal(world.clearTransient().length,8);
 assert.ok(world.spawnTransient('chicken',0,-2));world.clear();
 assert.equal(JSON.stringify(world.snapshot()).includes(':debug:'),false);
});
test('debug menu spawner uses safe points ahead, supports five colors and rejects online calls',()=>{
 const created=[],points=[];
 const ctx={px:10,pz:20,yaw:0,isOnline:()=>false,mobs:{registry:createMobTypeRegistry(),spawnDebug(type,x,z,options){created.push({type,x,z,...options});return created.at(-1);}}};
 const spawn=createDebugMobSpawner(ctx,{findSafePoint:(context,x,z)=>{points.push([x,z]);return {x,y:0,z};}});
 const result=spawn('chicken',{count:'2',subcategory:'speckled'});
 assert.equal(result.length,2);assert.equal(created[0].subcategory,'speckled');assert.ok(points.every(([x,z])=>z<ctx.pz));
 assert.throws(()=>spawn('chicken',{count:9}),/1 до 8/);assert.throws(()=>spawn('chicken',{subcategory:'nope'}),/окрас/);
 ctx.isOnline=()=>true;assert.throws(()=>spawn('chicken'),/сетевой/);assert.equal(created.length,2);
});
