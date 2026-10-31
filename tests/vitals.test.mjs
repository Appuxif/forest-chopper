import test from 'node:test';
import assert from 'node:assert/strict';
import {createVitals,isFood,eatEffect,FOOD_EFFECTS,MAX_VITALS,HUNGER_INTERVAL_SECONDS,canChop} from '../src/vitals.js';
import {createInventoryModel} from '../src/inventory.js';

test('health and hunger have five slots; at one or zero cannot chop',()=>{
 const x=createVitals({now:()=>0});
 assert.deepEqual(x.snapshot(),{health:5,hunger:5,hungerProgress:0});
 assert.equal(MAX_VITALS,5);
 assert.equal(canChop({health:2,hunger:2}),true);
 for(const health of [0,1])assert.equal(canChop({health,hunger:5}),false);
 for(const hunger of [0,1])assert.equal(canChop({health:5,hunger}),false);
});
test('hunger loses one slot every five minutes; does not drain health or go below zero',()=>{
 let now=0;
 const x=createVitals({now:()=>now});
 assert.equal(HUNGER_INTERVAL_SECONDS,300);
 now=299;assert.equal(x.tick(),false);assert.equal(x.hunger,5);
 now=300;assert.equal(x.tick(),true);assert.equal(x.hunger,4);
 now=900;assert.equal(x.tick(),true);assert.equal(x.hunger,2);
 now=1200;assert.equal(x.tick(),true);assert.equal(x.hunger,1);assert.equal(x.canChop,false);
 now=1800;assert.equal(x.tick(),true);assert.equal(x.hunger,0);assert.equal(x.health,5);
 now=2100;assert.equal(x.tick(),false);assert.equal(x.hunger,0);
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
 assert.equal(Object.keys(FOOD_EFFECTS).length,8);
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
 now=200;x.tick();
 x.eat('mushroom:fly_agaric');
 const saved=x.snapshot();
 assert.deepEqual(saved,{health:4,hunger:5,hungerProgress:200});
 now=1400;
 const y=createVitals({now:()=>now});
 assert.equal(y.restore(saved),true);
 assert.equal(y.hunger,5);
 now=1499;y.tick();assert.equal(y.hunger,5);
 now=1500;y.tick();assert.equal(y.hunger,4);
 assert.equal(y.restore({health:6,hunger:5,hungerProgress:0}),false);
 assert.equal(y.restore({health:0,hunger:-1,hungerProgress:0}),false);
 assert.equal(y.restore({health:1,hunger:2,hungerProgress:300}),false);
 y.reset();assert.equal(y.health,5);assert.equal(y.hunger,5);
});
