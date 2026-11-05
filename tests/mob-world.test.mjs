import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CHICKEN_TYPE,createMobTypeRegistry,selectMobSubcategory} from '../src/mob-types.js';
import {createMobWorld} from '../src/mob-world.js';
import {createHenWorld} from '../src/hen-rules.js';
import {applyEntityDamage} from '../src/entity-combat.js';
function dummy(){
 const d=structuredClone(CHICKEN_TYPE);d.id='test_guard';d.name='Тестовый страж';d.category='test';d.faction='guards';
 d.subcategories={plain:{id:'plain',name:'Обычный'}};d.stats.maxHealth=4;d.stats.damage=2;d.behavior.id='passive';
 d.spawn.idPrefix='guard';d.spawn.groupMin=d.spawn.groupMax=d.spawn.starterCount=1;d.spawn.chance=1;
 d.loot={branch:{min:2,max:2},stone:{min:1,max:1}};d.animations.forage=[];d.animations.peaceful=[{clip:'Walk',weight:1}];
 return d;
}
test('one world contains different types, partial damage and independent corpse inventory',()=>{
 const registry=createMobTypeRegistry([CHICKEN_TYPE,dummy()]),world=createMobWorld({seed:2,registry});
 let records=world.tick(0,[{x:0,z:0}]);const chicken=records.find(r=>r.type==='chicken'),guard=records.find(r=>r.type==='test_guard');
 assert.ok(chicken&&guard);assert.notEqual(chicken.id,guard.id);assert.equal(guard.hp,4);
 const attacker={id:'p',faction:'players',x:guard.x-1,z:guard.z};
 assert.equal(world.damage(guard.id,1,attacker),true);
 records=world.tick(0,[{x:0,z:0}]);let entity=records.find(r=>r.id===guard.id);
 assert.equal(entity.hp,3);assert.deepEqual(entity.loot,{branch:0,stone:0});
 assert.equal(world.damage(guard.id,10,attacker),true);
 records=world.tick(0,[{x:0,z:0}]);entity=records.find(r=>r.id===guard.id);
 assert.equal(entity.hp,0);assert.deepEqual(entity.loot,{branch:2,stone:1});
 assert.equal(world.damage(guard.id,10,attacker),false);
 const received=[];assert.equal(world.take(guard.id,'branch',2,()=>true,(...item)=>{received.push(item);return true;}),2);
 assert.deepEqual(received,[['branch',2]]);assert.equal(world.take(guard.id,'feather',1),0);
 const restored=createMobWorld({seed:2,registry});assert.equal(restored.restore(world.snapshot()),true);
 const saved=restored.tick(0,[{x:0,z:0}]).find(r=>r.id===guard.id);assert.deepEqual(saved.loot,{branch:0,stone:1});
 assert.equal(saved.category,'test');assert.equal(saved.subcategory,'plain');
});
test('passive and wary behavior use the same movement core but react differently to an observer',()=>{
 const world=createMobWorld({seed:9,registry:createMobTypeRegistry([CHICKEN_TYPE,dummy()])});
 let records=world.tick(0,[{x:0,z:0}]);const chicken=records.find(r=>r.type==='chicken'),guard=records.find(r=>r.type==='test_guard');
 records=world.tick(.1,[{x:chicken.x+.5,z:chicken.z},{x:guard.x+.5,z:guard.z}]);
 assert.equal(records.find(r=>r.id===chicken.id).state,'Run');assert.notEqual(records.find(r=>r.id===guard.id).state,'Run');
});
test('legacy hen snapshot restores through the new world without changing IDs or loot',()=>{
 const legacy=createHenWorld({seed:123,random:()=>.999});const hen=legacy.tick(0,[{x:0,z:0}])[0];legacy.hit(hen.id);
 const modern=createMobWorld({seed:123});assert.equal(modern.restore(legacy.snapshot()),true);
 const record=modern.tick(0,[{x:0,z:0}]).find(r=>r.id===hen.id);assert.deepEqual(record.loot,{chicken_meat:3,feather:5});
 const invalid=modern.snapshot();invalid.populations.unknown=invalid.populations.chicken;assert.equal(modern.restore(invalid),false);
});
test('chicken category has five real assets and deterministic persisted subcategories',()=>{
 assert.equal(CHICKEN_TYPE.category,'chicken');assert.deepEqual(Object.keys(CHICKEN_TYPE.subcategories),['russet','white','black','golden','speckled']);
 const seen=new Set();for(let i=0;i<100;i++){const v=selectMobSubcategory(CHICKEN_TYPE,10,'mob'+i);seen.add(v);assert.equal(selectMobSubcategory(CHICKEN_TYPE,10,'mob'+i),v);}
 assert.equal(seen.size,5);
 for(const variant of Object.values(CHICKEN_TYPE.subcategories))assert.ok(fs.existsSync(new URL('../'+variant.texture,import.meta.url)));
 const world=createMobWorld({seed:5});const before=world.tick(0,[{x:0,z:0}]).map(r=>[r.id,r.subcategory]);
 const next=createMobWorld({seed:5});assert.equal(next.restore(world.snapshot()),true);assert.deepEqual(next.tick(0,[{x:0,z:0}]).map(r=>[r.id,r.subcategory]),before);
});
test('entity damage contract supports player adapters without enabling friendly PvP',()=>{
 let hp=5;const target={id:'player-b',kind:'player',faction:'players',get health(){return hp;},receiveDamage(n){hp-=n;return true;}};
 const source={id:'player-a',kind:'player',faction:'players'};
 assert.equal(applyEntityDamage(source,target,2),false);assert.equal(hp,5);
 assert.equal(applyEntityDamage({...source,faction:'monsters'},target,2),true);assert.equal(hp,3);
 assert.equal(applyEntityDamage(source,target,NaN),false);
});
test('duplicate IDs or invalid definitions cannot be registered',()=>{
 const registry=createMobTypeRegistry();assert.throws(()=>registry.register(CHICKEN_TYPE),/Duplicate/);
 const bad=dummy();bad.stats.maxHealth=0;assert.throws(()=>registry.register(bad),/Invalid/);
});

test('custom behavior receives entity identity/faction, not just anonymous coordinates',async()=>{
 const {createMobBehaviorRegistry}=await import('../src/mob-ai.js');
 const behaviors=createMobBehaviorRegistry();let seen;
 behaviors.register('test_observer',(mob,env)=>{seen=env.targets[0];mob.velocityX=mob.velocityZ=0;});
 const d=dummy();d.behavior.id='test_observer';
 const world=createMobWorld({seed:1,registry:createMobTypeRegistry([d]),behaviors});
 world.tick(.1,[{id:'p1',kind:'player',faction:'players',x:0,z:0}]);
 assert.equal(seen.id,'p1');assert.equal(seen.kind,'player');assert.equal(seen.faction,'players');
});
test('client/server creature balance, categories and deterministic colors agree',async()=>{
 const {spawnSync}=await import('node:child_process');
 const code=`import json
from mob_definitions import CHICKEN as d
from mob_world import _appearance
print(json.dumps(dict(health=d.health,faction=d.faction,category=d.category,subcategories=d.subcategories,speeds=[d.walk_speed,d.fast_speed,d.run_speed],behavior=d.behavior,flock=d.flock,radii=[d.notice_radius,d.safe_radius,d.calm_seconds],loot=d.loot,roles=d.animations,appearance=_appearance(123,'h:0,0:0:g0',d))))`;
 const result=spawnSync('python3',['-c',code],{cwd:new URL('..',import.meta.url),encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const d=JSON.parse(result.stdout),c=CHICKEN_TYPE;
 assert.equal(d.health,c.stats.maxHealth);assert.equal(d.faction,c.faction);assert.equal(d.category,c.category);assert.deepEqual(d.subcategories,Object.keys(c.subcategories));
 assert.deepEqual(d.speeds,[c.stats.speeds.walk,c.stats.speeds.fast,c.stats.speeds.run]);assert.equal(d.behavior,c.behavior.id);assert.deepEqual(d.flock,c.behavior.flock);
 assert.deepEqual(d.radii,[c.behavior.noticeRadius,c.behavior.safeRadius,c.behavior.calmSeconds]);
 assert.deepEqual(d.loot,Object.fromEntries(Object.entries(c.loot).map(([id,r])=>[id,[r.min,r.max]])));
 for(const role of ['idle','walk','fast','run','rest'])assert.equal(d.roles[role],c.animations[role]);
 assert.equal(d.appearance,selectMobSubcategory(c,123,'h:0,0:0:g0'));
});

test('a pursued mob stays active hundreds of meters from its spawn and is not duplicated at home',()=>{
 const world=createMobWorld({seed:123});let bird=world.tick(0,[{x:0,z:0}]).find(r=>r.type==='chicken');
 const id=bird.id,origin={x:bird.x,z:bird.z};
 for(let i=0;i<750;i++){
  const player={x:bird.x-2,z:bird.z};
  const records=world.tick(.2,[player]);bird=records.find(r=>r.id===id);
  assert.ok(bird,`pursued mob vanished after ${i} steps`);
  assert.ok(Math.hypot(bird.x-player.x,bird.z-player.z)<4);
 }
 assert.ok(bird.x-origin.x>500);
 const records=world.tick(0,[{x:bird.x-2,z:bird.z},origin]);
 assert.equal(records.filter(r=>r.id===id).length,1);assert.ok(records.find(r=>r.id===id).x-origin.x>500);
 const restored=createMobWorld({seed:123});assert.equal(restored.restore(world.snapshot()),true);
 assert.ok(restored.tick(0,[{x:bird.x-2,z:bird.z}]).some(r=>r.id===id&&r.x-origin.x>500));
 assert.equal(restored.hit(id,{id:'p',faction:'players',x:bird.x-2,z:bird.z}),true);
 assert.ok(restored.tick(0,[{x:bird.x-2,z:bird.z}]).find(r=>r.id===id).hp===0);
});
