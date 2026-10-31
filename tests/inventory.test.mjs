import test from 'node:test';
import assert from 'node:assert/strict';
import {createInventoryModel,LOG_STACK,QUICK_SLOTS,AXE_STATS} from '../src/inventory.js';
test('default bag holds one axe, 12 slots and four quick slots',()=>{
 const x=createInventoryModel();
 assert.equal(x.capacity(),12);assert.equal(x.slots.length,12);
 assert.deepEqual(x.slots[0],{id:'axe',tier:0});
 assert.equal(QUICK_SLOTS,4);assert.equal(LOG_STACK,5);
 assert.equal(x.equipped(),true);assert.equal(x.axe().damage,1);
 assert.equal(x.wood(),0);assert.equal(x.freeLogs(),55);
});
test('logs stack up to five; building consumption works regardless of selected slot',()=>{
 const x=createInventoryModel();assert.equal(x.addLogs(12),12);
 assert.deepEqual(x.slots.slice(1,4).map(s=>s?.count),[5,5,2]);
 x.select(2);assert.equal(x.equipped(),false);
 assert.equal(x.spendLogs(6),true);
 assert.equal(x.wood(),6);assert.equal(x.spendLogs(7),false);
 assert.equal(x.wood(),6);assert.ok(x.slots.every(s=>s?.id!=='log'||s.count<=5));
});
test('bag capacity is bounded and upgrades add slots without deleting items',()=>{
 const x=createInventoryModel();
 assert.equal(x.addLogs(65),55);assert.equal(x.wood(),55);assert.equal(x.freeLogs(),0);
 assert.equal(x.upgradeBag(1),true);assert.equal(x.capacity(),16);
 assert.equal(x.addLogs(20),20);assert.equal(x.wood(),75);
 assert.equal(x.upgradeBag(-1),false);
 assert.equal(x.upgradeBag(101),false);
 assert.equal(x.wood(),75);
});
test('moving the axe preserves its hotbar binding until explicitly reassigned',()=>{
 const x=createInventoryModel();
 assert.equal(x.move(0,8),true);
 assert.equal(x.equipped(),true,'hotbar follows moved axe');
 assert.equal(x.selectedSlot(),8);
 assert.equal(x.move(8,3),true);
 x.select(3);
 assert.equal(x.equipped(),false,'unassigned hotbar entry remains empty');
 assert.equal(x.assignQuick(3,3),true);
 assert.equal(x.equipped(),true);
 assert.equal(x.axe().speed,1);
 assert.deepEqual(AXE_STATS.map(x=>x.damage),[1,2,3,4]);
});
test('serialized bag restores axe position and log stacks',()=>{
 const a=createInventoryModel();
 a.addLogs(8);a.move(0,9);a.select(1);a.upgradeBag(2);
 const snapshot=a.serialize();
 const b=createInventoryModel();
 assert.equal(b.restore(snapshot,8),true);
 assert.deepEqual(b.serialize(),snapshot);
 assert.equal(b.restore({...snapshot,slots:[{id:'log',count:99}]},8),false);
 assert.equal(b.restore({...snapshot,selectedQuick:55},8),false);
 assert.equal(b.restore(snapshot,9),false);
});
test('legacy wood saves migrate without losing items',()=>{
 const x=createInventoryModel();assert.equal(x.restore(null,120),true);
 assert.equal(x.wood(),120);assert.ok(x.capacity()>=25);
 assert.equal(x.slots.filter(s=>s?.id==='axe').length,1);
 assert.equal(x.equipped(),true);
});
test('multiple crafted axes are permitted; unknown items still rejected',()=>{
 const x=createInventoryModel();
 const snapshot=x.serialize();
 const slots=snapshot.slots.slice();slots[1]={id:'axe',tier:2};
 assert.equal(x.restore({...snapshot,slots},0),true);
 slots[1]={id:'diamond',count:1};
 assert.equal(x.restore({...snapshot,slots},0),false);
});

test('crafting needs three wood and a free output slot before consuming',()=>{
 const x=createInventoryModel();
 assert.equal(x.craftBench(),false);
 assert.equal(x.addLogs(3),3);
 assert.equal(x.craftBench(),true);
 assert.equal(x.wood(),0);
 assert.equal(x.slots.filter(s=>s?.id==='bench').length,1);
 // Fill remaining slots with benches, then take three wood from one bench slot.
 const y=createInventoryModel();
 for(let i=1;i<12;i++)assert.equal(y.addBench(),true);
 assert.equal(y.hasSpace(),false);
 assert.equal(y.craftBench(),false);
 assert.equal(y.slots.filter(s=>s?.id==='bench').length,11);
 assert.equal(x.assignQuick(1,x.slots.findIndex(s=>s?.id==='bench')),true);
 assert.equal(x.select(1),true);
 assert.equal(x.selected(),'bench');
 assert.equal(x.consumeSelected('bench'),true);
 assert.equal(x.selected(),null);
});
test('dismantling a bench cannot create item when every bag slot is used',()=>{
 const x=createInventoryModel();
 for(let i=1;i<12;i++)x.addBench();
 assert.equal(x.hasSpace(),false);
 assert.equal(x.addBench(),false);
 assert.equal(x.slots.filter(s=>s?.id==='bench').length,11);
});

test('branches and stones stack to ten; recipes make an axe and accept extra axes',()=>{
 const x=createInventoryModel();
 assert.equal(x.addItem({id:'branch',count:14}),true);
 assert.equal(x.addItem({id:'stone',count:12}),true);
 assert.deepEqual(x.slots.filter(item=>item?.id==='branch').map(item=>item.count),[10,4]);
 assert.equal(x.craft('axe'),true);
 assert.equal(x.count('branch'),11);
 assert.equal(x.count('stone'),10);
 assert.equal(x.slots.filter(item=>item?.id==='axe').length,2);
 const snapshot=x.serialize();
 const other=createInventoryModel();
 assert.equal(other.restore(snapshot,x.wood()),true);
 assert.deepEqual(other.serialize(),snapshot);
});
test('dropping or trashing any occupied stack frees exactly that slot',()=>{
 const x=createInventoryModel();x.addItem({id:'branch',count:6});
 const before=x.slots[1];assert.deepEqual(before,{id:'branch',count:6});
 const removed=x.removeSlot(1);
 assert.deepEqual(removed,before);assert.equal(x.count('branch'),0);
 assert.equal(x.restoreSlot(1,removed),true);
 assert.equal(x.restoreSlot(1,removed),false);
 assert.equal(x.removeSlot(50),null);
});

test('hotbar shows the aggregate item type across stacks and survives moving a depleted source',()=>{
 const x=createInventoryModel();
 x.addItem({id:'stone',count:23});
 const indices=x.slots.map((s,i)=>s?.id==='stone'?i:-1).filter(i=>i>=0);
 assert.deepEqual(indices.map(i=>x.slots[i].count),[10,10,3]);
 x.assignQuick(2,indices[2]);
 x.select(2);
 assert.equal(x.quickItem(2).count,3);
 assert.equal(x.count('stone'),23);
 assert.equal(x.selectedSlot(),indices[2]);
 x.consumeAt(indices[2],'stone');
 x.consumeAt(indices[2],'stone');
 x.consumeAt(indices[2],'stone');
 assert.equal(x.count('stone'),20);
 assert.equal(x.selectedSlot(),indices[0],'falls back to another stack of the same type');
 assert.equal(x.selected(),'stone');
 const restored=createInventoryModel();
 assert.equal(restored.restore(x.serialize(),x.wood()),true);
 assert.equal(restored.selected(),'stone');
 assert.equal(restored.count('stone'),20);
});

test('split, merge, half-drag and cross-type swaps preserve total counts',()=>{
 const x=createInventoryModel();
 x.addItem({id:'branch',count:9});
 x.addItem({id:'stone',count:3});
 assert.equal(x.split(1),true);
 assert.equal(x.count('branch'),9);
 assert.equal(x.slots[1].count,5);
 assert.equal(x.slots[3].count,4);
 assert.equal(x.transfer(1,3),true);
 assert.equal(x.slots[1],null);
 assert.equal(x.slots[3].count,9);
 assert.equal(x.transfer(3,2,{half:true}),false,'cannot half-drag onto a different item');
 assert.equal(x.transfer(3,1,{half:true}),true);
 assert.equal(x.slots[3].count,5);
 assert.equal(x.slots[1].count,4);
 assert.equal(x.transfer(1,2),true,'different items swap');
 assert.equal(x.count('branch'),9);
 assert.equal(x.count('stone'),3);
 assert.equal(x.transfer(3,2),true,'merge partial stacks');
 assert.equal(x.count('branch'),9);
 assert.equal(x.slots[3],null);
});

test('quickbar axes retain specific tiers and never silently switch to another axe',()=>{
 const x=createInventoryModel();
 x.addItem({id:'axe',tier:3});
 const master=x.slots.findIndex(s=>s?.id==='axe'&&s.tier===3);
 x.assignQuick(1,master);x.select(1);
 assert.equal(x.axe().damage,4);
 x.move(master,7);
 assert.equal(x.axe().damage,4,'moving the equipped stack keeps its exact reference');
 x.removeSlot(7);
 assert.equal(x.selected(),null,'do not silently equip the basic axe');
 assert.equal(x.axe(),null);
});

test('restore rejects malformed quick bindings without mutating the inventory',()=>{
 const x=createInventoryModel();
 const initial=x.serialize();
 for(const patch of [
   {quickRefs:[0,0,2,3]},
   {quickRefs:[0,1,-1,3]},
   {quickRefs:[0,1,2,99]},
   {quickIds:['axe','unrecognized',null,null]},
   {quickIds:['axe','log']},
 ]){
   assert.equal(x.restore({...initial,...patch},0),false);
   assert.deepEqual(x.serialize(),initial);
 }
});
