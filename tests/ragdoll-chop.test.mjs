import test from 'node:test';
import assert from 'node:assert/strict';
import {createChopping} from '../src/chopping.js';
import {createInventoryModel} from '../src/inventory.js';
import {createVitals} from '../src/vitals.js';

test('mouse click during ragdoll cannot launch Chop2 or use items',()=>{
 const calls=[];
 class Noop{}
 const ctx={
  THREE:{Raycaster:Noop,Vector2:Noop,Vector3:Noop,
    BoxGeometry:Noop,MeshLambertMaterial:Noop},
  ragdoll:{active:true},ragdollControls:{mode:'manual',busy:false},
  actorChop(){calls.push('Chop2');},
  inventory:{get selected(){calls.push('inventory');return 'log';}},
 };
 const {chop}=createChopping(ctx);
 chop();
 assert.deepEqual(calls,[]);
 ctx.ragdoll.active=false;
 ctx.ragdollControls.mode='sleep';
 chop();
 assert.deepEqual(calls,[]);
 ctx.ragdollControls.mode='none';ctx.ragdollControls.busy=true;
 chop();
 assert.deepEqual(calls,[]);
});

test('clicking with selected chicken meat consumes it and restores one hunger',()=>{
 class Noop{}
 const inventoryState=createInventoryModel();
 assert.equal(inventoryState.addItem({id:'chicken_meat',count:1}),true);
 const meatSlot=inventoryState.slots.findIndex(item=>item?.id==='chicken_meat');
 assert.equal(inventoryState.assignQuick(1,meatSlot),true);
 assert.equal(inventoryState.select(1),true);
 const vitalsState=createVitals();
 assert.equal(vitalsState.restore({health:4,hunger:0,hungerProgress:0}),true);
 const ctx={
  THREE:{Raycaster:Noop,Vector2:Noop,Vector3:Noop,
    BoxGeometry:Noop,MeshLambertMaterial:Noop},
  inventory:{state:inventoryState},
  vitals:{consume(index){
   const item=inventoryState.slots[index];
   if(!item||!inventoryState.consumeAt(index,item.id))return false;
   return vitalsState.eat(item.id);
  }},
 };
 const {chop}=createChopping(ctx);
 const hunger=vitalsState.hunger;
 chop();
 assert.equal(inventoryState.count('chicken_meat'),0);
 assert.equal(vitalsState.hunger,Math.min(5,hunger+1));
});
