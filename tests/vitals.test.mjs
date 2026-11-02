import test from 'node:test';
import assert from 'node:assert/strict';
import {createVitals,isFood,eatEffect,FOOD_EFFECTS,MAX_VITALS,HUNGER_INTERVAL_SECONDS,canChop} from '../src/vitals.js';
import {createInventoryModel} from '../src/inventory.js';

test('health and hunger have five slots; at one or zero cannot chop',()=>{
 const x=createVitals({now:()=>0});
 assert.deepEqual(x.snapshot(),{health:5,hunger:5,stamina:5,staminaLocked:false,hungerProgress:0,starvationProgress:0});
 assert.equal(MAX_VITALS,5);
 assert.equal(canChop({health:2,hunger:2}),true);
 for(const health of [0,1])assert.equal(canChop({health,hunger:5}),false);
 for(const hunger of [0,1])assert.equal(canChop({health:5,hunger}),false);
});
test('hunger loses one slot every 192 seconds; empty hunger causes starvation damage every ten seconds',()=>{
 let now=0;
 const x=createVitals({now:()=>now});
 assert.equal(HUNGER_INTERVAL_SECONDS,192);
 now=191;assert.equal(x.tick(),false);assert.equal(x.hunger,5);
 now=192;assert.equal(x.tick(),true);assert.equal(x.hunger,4);
 now=576;assert.equal(x.tick(),true);assert.equal(x.hunger,2);
 now=768;assert.equal(x.tick(),true);assert.equal(x.hunger,1);assert.equal(x.canChop,false);
 now=960;assert.equal(x.tick(),true);assert.equal(x.hunger,0);assert.equal(x.health,5);
 now=1260;assert.equal(x.tick(),true);assert.equal(x.hunger,0);assert.equal(x.health,0);
});
test('poison mushrooms subtract a life; edible milkcap and boletus restore hunger',()=>{
 const x=createVitals({now:()=>0});
 assert.equal(x.eat('mushroom:fly_agaric'),true);assert.equal(x.health,4);
 assert.equal(x.eat('mushroom:death_cap'),true);assert.equal(x.health,3);
 assert.equal(x.eat('mushroom:death_cap'),true);
 assert.equal(x.eat('mushroom:death_cap'),true);
 assert.equal(x.health,1);assert.equal(x.canChop,false);
 x.eat('mushroom:death_cap');x.eat('mushroom:death_cap');assert.equal(x.health,0);
 assert.equal(x.eat('flower:daisy'),true);assert.equal(x.health,1);
 x.eat('flower:daisy');assert.equal(x.health,2);assert.equal(x.canChop,true);
 assert.equal(x.eat('mushroom:milkcap'),true);
 assert.equal(x.hunger,5,'hunger cannot rise above the maximum');
 const y=createVitals({now:()=>0});
 y.restore({health:3,hunger:1,hungerProgress:0});
 y.eat('mushroom:boletus');assert.equal(y.hunger,2);
 y.eat('mushroom:milkcap');assert.equal(y.hunger,3);
});
test('daisy heals, other flowers are edible with no status effect',()=>{
 const x=createVitals({now:()=>0});
 x.eat('mushroom:fly_agaric');
 x.eat('flower:daisy');assert.equal(x.health,5);
 for(const id of ['flower:buttercup','flower:pink_wildflower','flower:blue_wildflower']){
  assert.equal(isFood(id),true);
  assert.deepEqual(eatEffect(4,3,id),{health:4,hunger:3});
 }
 assert.equal(x.eat('log'),false);assert.equal(isFood('mushroom:unknown'),false);
 assert.equal(Object.keys(FOOD_EFFECTS).length,15);
});
test('consumption always decrements the exact selected stack and does not touch neighbours',()=>{
 const inventory=createInventoryModel();
 assert.equal(inventory.addItem({id:'flower:daisy',count:3}),true);
 assert.equal(inventory.addItem({id:'flower:buttercup',count:4}),true);
 const first=inventory.slots.findIndex(x=>x?.id==='flower:daisy');
 assert.equal(inventory.consumeAt(first,'flower:daisy'),true);
 assert.equal(inventory.count('flower:daisy'),2);assert.equal(inventory.count('flower:buttercup'),4);
 assert.equal(inventory.consumeAt(first,'mushroom:fly_agaric'),false);
 inventory.consumeAt(first,'flower:daisy');inventory.consumeAt(first,'flower:daisy');
 assert.equal(inventory.slots[first],null);
 assert.equal(inventory.consumeAt(first,'flower:daisy'),false);
});
test('saving vitals preserves countdown progress but does not reduce hunger while offline',()=>{
 let now=0;
 const x=createVitals({now:()=>now});
 now=56;x.tick();
 x.eat('mushroom:fly_agaric');
 const saved=x.snapshot();
 assert.deepEqual(saved,{health:4,hunger:5,stamina:5,staminaLocked:false,hungerProgress:56,starvationProgress:0});
 now=1400;
 const y=createVitals({now:()=>now});
 assert.equal(y.restore(saved),true);
 assert.equal(y.hunger,5);
 now=1535;y.tick();assert.equal(y.hunger,5);
 now=1536;y.tick();assert.equal(y.hunger,4);
 assert.equal(y.restore({health:6,hunger:5,hungerProgress:0}),false);
 assert.equal(y.restore({health:0,hunger:-1,hungerProgress:0}),false);
 assert.equal(y.restore({health:1,hunger:2,hungerProgress:300}),false);
 y.reset();assert.equal(y.health,5);assert.equal(y.hunger,5);
});

test('sprint drains to zero before lockout; 0.5 stamina unlocks it',()=>{
 let now=0;
 const x=createVitals({now:()=>now});
 for(let i=1;i<=5;i++){now=i;x.tick({sprinting:true});}
 assert.ok(Math.abs(x.stamina-1)<1e-6);
 assert.equal(x.canSprint(),true,'run remains possible with 20% stamina');
 assert.equal(x.canChop,false);
 now=6;x.tick({sprinting:true});assert.ok(x.stamina>0);
 now=7;x.tick({sprinting:true});assert.equal(x.stamina,0);
 assert.equal(x.canSprint(),false);
 assert.equal(x.snapshot().staminaLocked,true);
 now=7.5;x.tick({sprinting:false});
 assert.equal(x.canSprint(),false);
 now=8;x.tick({sprinting:false});
 assert.equal(x.canSprint(),true);
 const start=x.stamina;
 now=8.5;x.tick({sprinting:true});
 assert.ok(x.stamina<start);
});
test('each valid tree hit costs a full stamina slot and rejects exhausted strikes',()=>{
 let now=0;
 const x=createVitals({now:()=>now});
 for(let i=0;i<4;i++){
   assert.equal(x.canChop,true);
   assert.equal(x.hit(),true);
   assert.equal(x.stamina,4-i);
 }
 assert.equal(x.stamina,1);
 assert.equal(x.canChop,false);
 assert.equal(x.hit(),false);
 const snapshot=x.snapshot();
 const restored=createVitals({now:()=>now});
 assert.equal(restored.restore(snapshot),true);
 assert.equal(restored.canChop,false);
 now=3;
 restored.tick({sprinting:false});
 assert.ok(restored.stamina>1);
 assert.equal(restored.canChop,true);
});
test('old save without stamina starts full; malformed stamina is rejected',()=>{
 const x=createVitals({now:()=>0});
 assert.equal(x.restore({health:3,hunger:4,hungerProgress:12}),true);
 assert.equal(x.stamina,5);
 assert.equal(x.restore({health:3,hunger:4,hungerProgress:12,stamina:-1}),false);
 assert.equal(x.restore({health:3,hunger:4,hungerProgress:12,stamina:6}),false);
 assert.equal(x.restore({health:3,hunger:4,hungerProgress:12,stamina:NaN}),false);
});

test('stamina lock from older snapshots is cleared at the new 0.5 threshold',()=>{
 let now=10;
 const x=createVitals({now:()=>now});
 assert.equal(x.restore({health:5,hunger:5,stamina:1.8,staminaLocked:true,hungerProgress:0}),true);
 assert.equal(x.canSprint(),true);
 assert.equal(x.snapshot().staminaLocked,false);
 assert.equal(x.restore({health:5,hunger:5,stamina:0,staminaLocked:true,hungerProgress:0}),true);
 assert.equal(x.canSprint(),false);
 now+=1;x.tick();
 assert.equal(x.canSprint(),true);
});
test('jump costs one full stamina; low stamina prevents repeated jumping',()=>{
 const x=createVitals({now:()=>0});
 for(let i=4;i>=0;i--){
   assert.equal(x.jump(),true);
   assert.equal(x.stamina,i);
 }
 assert.equal(x.jump(),false);
 assert.equal(x.stamina,0);
 assert.equal(x.canSprint(),false);
});
test('short action warnings select exact reason by priority',()=>{
 const x=createVitals({now:()=>0});
 assert.equal(x.chopWarning(),'');
 x.restore({health:1,hunger:1,stamina:0,hungerProgress:0});
 assert.equal(x.chopWarning(),'Мало жизней');
 x.restore({health:5,hunger:1,stamina:0,hungerProgress:0});
 assert.equal(x.chopWarning(),'Вы голодны');
 x.restore({health:5,hunger:5,stamina:1,hungerProgress:0});
 assert.equal(x.chopWarning(),'Нет сил');
});

test('health potion outperforms its ingredients, keeps the boletus hunger bonus and clamps',()=>{
 assert.deepEqual(eatEffect(1,1,'potion:health'),{health:4,hunger:2});
 assert.deepEqual(eatEffect(4,4,'potion:health'),{health:5,hunger:5});
 let separate=eatEffect(1,1,'flower:daisy');
 separate=eatEffect(separate.health,separate.hunger,'flower:daisy');
 separate=eatEffect(separate.health,separate.hunger,'mushroom:boletus');
 assert.deepEqual(separate,{health:3,hunger:2});
 const combined=eatEffect(1,1,'potion:health');
 assert.equal(combined.health,separate.health+1);
 assert.equal(combined.hunger,separate.hunger);
});

test('starvation damages exactly one health each ten seconds and stops immediately after eating',()=>{
 let now=0;
 const v=createVitals({now:()=>now});
 assert.equal(v.restore({health:5,hunger:0,hungerProgress:0,starvationProgress:0}),true);
 now=9.5;v.tick();assert.equal(v.health,5);
 now=10;v.tick();assert.equal(v.health,4);
 now=19.9;v.tick();assert.equal(v.health,4);
 now=20;v.tick();assert.equal(v.health,3);
 const saved=v.snapshot();
 assert.equal(saved.starvationProgress,0);
 const resumed=createVitals({now:()=>now});
 assert.equal(resumed.restore(saved),true);
 now=25;resumed.tick();assert.equal(resumed.health,3);
 assert.equal(resumed.eat('mushroom:boletus'),true);
 assert.equal(resumed.hunger,1);
 assert.equal(resumed.snapshot().starvationProgress,0);
 now=100;resumed.tick();assert.equal(resumed.health,3);
 assert.equal(resumed.hunger,1);
 assert.equal(resumed.restore({...saved,starvationProgress:10}),false);
});
