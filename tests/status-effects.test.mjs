import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeEffects,applyTimedEffect,staminaRegenMultiplier,STATUS_DEFINITIONS,hasStatusEffect,lumberjackDamageMultiplier,sprintDrainMultiplier} from '../src/status-effects.js';
import {createVitals} from '../src/vitals.js';
import {createInventoryModel} from '../src/inventory.js';
test('status effects refresh instead of stacking and expire by real-world time',()=>{
 const list=[];
 assert.equal(applyTimedEffect(list,'stamina_regen',100),true);
 assert.deepEqual(list,[{id:'stamina_regen',expires_at:130}]);
 assert.equal(staminaRegenMultiplier(list,105),2);
 applyTimedEffect(list,'stamina_regen',110);
 assert.deepEqual(list,[{id:'stamina_regen',expires_at:140}]);
 assert.equal(staminaRegenMultiplier(list,141),1);
 assert.deepEqual(sanitizeEffects(list,145),[]);
 assert.equal(sanitizeEffects([{id:'hack',expires_at:120}],100),null);
 assert.equal(sanitizeEffects([{id:'stamina_regen',expires_at:900}],100),null);
 assert.equal(sanitizeEffects([{id:'stamina_regen',expires_at:120},{id:'stamina_regen',expires_at:121}],100),null);
});
test('health and stamina potions are bounded and timed regen survives offline restore',()=>{
 let time=0,epoch=100;
 const vitals=createVitals({now:()=>time,epoch:()=>epoch});
 vitals.restore({health:1,hunger:2,stamina:0,staminaLocked:true,hungerProgress:0});
 assert.equal(vitals.eat('potion:health'),true);
 assert.equal(vitals.health,4);
 assert.equal(vitals.hunger,3);
 assert.equal(vitals.eat('potion:stamina'),true);
 assert.equal(vitals.stamina,0,'stamina potion never fills the bar immediately');
 assert.equal(vitals.canSprint(),false,'potion does not unlock sprint on an empty bar');
 const snap=vitals.snapshot();
 assert.deepEqual(snap.effects,[{id:'stamina_regen',expires_at:130}]);
 time=1;epoch=101;vitals.tick();
 assert.ok(Math.abs(vitals.stamina-1.3)<1e-7,'regen is doubled for first second');
 const restored=createVitals({now:()=>time,epoch:()=>epoch});
 assert.equal(restored.restore(vitals.snapshot()),true);
 time=2;restored.tick();
 assert.ok(Math.abs(restored.stamina-2.6)<1e-7,'boost persists after restoring saved state');
 epoch=140;
 const expired=createVitals({now:()=>time,epoch:()=>epoch});
 assert.equal(expired.restore(snap),true);
 assert.equal(expired.snapshot().effects,undefined,'expired status is removed on reload');
});
test('potion item stacks respect bag mass and limits',()=>{
 const bag=createInventoryModel();
 assert.equal(bag.addItem({id:'potion:health',count:2}),true);
 assert.equal(bag.addItem({id:'potion:stamina',count:1}),true);
 assert.equal(bag.count('potion:health'),2);
 assert.equal(bag.consumeAt(1,'potion:health'),true);
 assert.equal(bag.count('potion:health'),1);
});

test('lumberjack, light feet and night vision expire independently and never stack',()=>{
 let epoch=100,time=0;
 const state=createVitals({now:()=>time,epoch:()=>epoch});
 state.restore({health:4,hunger:4,stamina:5,staminaLocked:false,hungerProgress:0});
 assert.equal(state.eat('potion:lumberjack'),true);
 assert.equal(state.eat('potion:light_feet'),true);
 assert.equal(state.eat('potion:night_vision'),true);
 assert.equal(state.health,2,'lumberjack and vision each cost a life');
 assert.equal(state.hunger,3,'light feet costs one hunger');
 assert.equal(state.damageMultiplier,2);
 assert.equal(state.sprintDrainMultiplier,.5);
 assert.equal(state.hasNightVision,true);
 assert.deepEqual(state.snapshot().effects,[
  {id:'lumberjack',expires_at:145},
  {id:'light_feet',expires_at:145},
  {id:'night_vision',expires_at:400},
 ]);
 time=1;epoch=101;state.tick({sprinting:true});
 assert.ok(Math.abs(state.stamina-4.6)<1e-7,'sprinting consumes half normal stamina');
 assert.equal(state.eat('potion:lumberjack'),true);
 assert.equal(state.damageMultiplier,2,'repeat dose refreshes duration; no stacking');
 const snapshot=state.snapshot();
 const active=snapshot.effects.find(x=>x.id==='lumberjack');
 assert.equal(active.expires_at,146);
 const resumed=createVitals({now:()=>time,epoch:()=>epoch});
 assert.equal(resumed.restore(snapshot),true,'all active effects persist in offline save');
 assert.equal(resumed.damageMultiplier,2);
 assert.equal(resumed.sprintDrainMultiplier,.5);
 assert.equal(resumed.hasNightVision,true);
 epoch=145.5;time=2;resumed.tick();
 assert.equal(resumed.damageMultiplier,2,'refreshed lumberjack still active');
 assert.equal(resumed.sprintDrainMultiplier,1,'light feet expires at 145');
 assert.equal(resumed.hasNightVision,true,'night vision lasts 300s');
 epoch=147;resumed.tick();
 assert.equal(resumed.damageMultiplier,1);
 epoch=401;resumed.tick();
 assert.equal(resumed.hasNightVision,false);
 assert.equal(resumed.snapshot().effects,undefined);
 assert.equal(STATUS_DEFINITIONS.night_vision.duration,300);
});
test('new effects use wall-clock expiry and cannot be forged by stale/duplicate saves',()=>{
 const effects=[];
 assert.equal(applyTimedEffect(effects,'night_vision',100),true);
 assert.equal(hasStatusEffect(effects,'night_vision',399),true);
 assert.equal(hasStatusEffect(effects,'night_vision',400),false);
 assert.equal(applyTimedEffect(effects,'light_feet',100),true);
 assert.equal(applyTimedEffect(effects,'lumberjack',100),true);
 assert.equal(lumberjackDamageMultiplier(effects,120),2);
 assert.equal(sprintDrainMultiplier(effects,120),.5);
 assert.equal(sprintDrainMultiplier(effects,146),1);
 assert.equal(sanitizeEffects(effects,101)?.length,3);
 assert.equal(sanitizeEffects([{id:'night_vision',expires_at:450}],100),null,
  'cannot load a vision timer longer than the prescribed duration');
 assert.equal(sanitizeEffects([...effects,...effects],100),null,'duplicate statuses refused');
});
