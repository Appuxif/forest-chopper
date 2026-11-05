import test from 'node:test';
import assert from 'node:assert/strict';
import {createInventoryModel,LOG_STACK,QUICK_SLOTS,AXE_STATS,ITEM_WEIGHT,MAX_CARRY_WEIGHT,itemWeight} from '../src/inventory.js';
test('default bag holds one axe, 12 slots and four quick slots',()=>{
 const x=createInventoryModel();
 assert.equal(x.capacity(),12);assert.equal(x.slots.length,12);
 assert.deepEqual(x.slots[0],{id:'axe',tier:0});
 assert.equal(QUICK_SLOTS,4);assert.equal(LOG_STACK,5);
 assert.equal(x.equipped(),true);assert.equal(x.axe().damage,1);
 assert.equal(x.wood(),0);assert.equal(x.freeLogs(),9);
});
test('logs stack up to five; building consumption works regardless of selected slot',()=>{
 const x=createInventoryModel();assert.equal(x.addLogs(12),9);
 assert.deepEqual(x.slots[1],{id:'log',count:5});
 assert.deepEqual(x.slots[2],{id:'log',count:4});
 x.select(2);assert.equal(x.equipped(),false);
 assert.equal(x.spendLogs(2),true);
 assert.equal(x.wood(),7);assert.equal(x.spendLogs(8),false);
 assert.equal(x.wood(),7);assert.ok(x.slots.every(s=>s?.id!=='log'||s.count<=5));
});
test('bag capacity is bounded and upgrades add slots without deleting items',()=>{
 const x=createInventoryModel();
 assert.equal(x.addLogs(65),9);assert.equal(x.wood(),9);assert.equal(x.freeLogs(),0);
 assert.equal(x.upgradeBag(1),true);assert.equal(x.capacity(),16);
 assert.equal(x.addLogs(20),0);assert.equal(x.wood(),9,'more slots do not increase weight limit');
 assert.equal(x.upgradeBag(-1),false);
 assert.equal(x.upgradeBag(101),false);
 assert.equal(x.spendLogs(1),true);assert.equal(x.addLogs(1),1);
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
 a.addLogs(3);a.move(0,9);a.select(1);a.upgradeBag(2);
 const snapshot=a.serialize();
 const b=createInventoryModel();
 assert.equal(b.restore(snapshot,3),true);
 assert.deepEqual(b.serialize(),snapshot);
 assert.equal(b.restore({...snapshot,slots:[{id:'log',count:99}]},8),false);
 assert.equal(b.restore({...snapshot,selectedQuick:55},8),false);
 assert.equal(b.restore(snapshot,4),false);
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
 // Old overloaded inventories still load; no free slot prevents output.
 const y=createInventoryModel();
 const old=y.serialize();
 old.slots.fill({id:'bench',count:1},1);
 assert.equal(y.restore(old,0),true);
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
 const old=x.serialize();
 old.slots.fill({id:'bench',count:1},1);
 assert.equal(x.restore(old,0),true);
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

test('weight is additive across stacks; carrying 100kg is independent of slots',()=>{
 const bag=createInventoryModel();
 assert.equal(MAX_CARRY_WEIGHT,100);
 assert.equal(itemWeight({id:'axe',tier:0}),3);
 assert.equal(ITEM_WEIGHT.log,10);
 assert.equal(bag.weight(),3);
 assert.equal(bag.addLogs(7),7);
 assert.equal(bag.weight(),73);
 assert.equal(bag.remainingWeight(),27);
 assert.equal(bag.canAdd({id:'stone',count:10}),true);
 assert.equal(bag.addItem({id:'stone',count:10}),true);
 assert.equal(bag.weight(),93);
 assert.equal(bag.canAdd({id:'stone',count:4}),false);
 assert.equal(bag.canAdd({id:'stone',count:3}),true);
 assert.equal(bag.addItem({id:'stone',count:3}),true);
 assert.equal(bag.weight(),99);
 assert.equal(bag.canAdd({id:'branch',count:2}),true);
 assert.equal(bag.addItem({id:'branch',count:2}),true);
 assert.equal(bag.weight(),100);
 assert.equal(bag.freeLogs(),0);
 assert.equal(bag.canAdd({id:'branch',count:1}),false);
 assert.equal(bag.addItem({id:'flower:daisy',count:1}),false);
 const snapshot=bag.serialize();
 assert.equal(bag.move(1,9),true);
 assert.equal(bag.weight(),100);
 assert.equal(bag.spend('branch',2),true);
 assert.equal(bag.weight(),99);
 assert.equal(bag.addItem({id:'branch',count:2}),true);
 assert.equal(bag.weight(),100);
 assert.equal(bag.addItem({id:'branch',count:1}),false);
 assert.deepEqual(snapshot.slots[0],{id:'axe',tier:0});
});

test('craft uses net resulting weight, never consumes ingredients on failure',()=>{
 const x=createInventoryModel();
 assert.equal(x.addLogs(3),3);
 assert.equal(x.weight(),33);
 assert.equal(x.craftBench(),true);
 assert.equal(x.weight(),18);
 const overloaded=createInventoryModel();
 const saved=overloaded.serialize();
 saved.slots[1]={id:'stone',count:10};
 saved.slots[2]={id:'log',count:5};
 saved.slots[3]={id:'branch',count:3};
 saved.slots[4]={id:'stone',count:10};
 saved.slots[5]={id:'log',count:5};
 assert.equal(overloaded.restore(saved,10),true);
 const before=overloaded.serialize();
 // A crafted axe would still leave excess weight, so it must roll back.
 assert.equal(overloaded.craft('axe'),false);
 assert.deepEqual(overloaded.serialize(),before);
 assert.equal(overloaded.spend('log',5),true);
 assert.equal(overloaded.craft('axe'),true);
});

test('old overweight saves migrate without item loss and cannot receive more items',()=>{
 const old=createInventoryModel();
 assert.equal(old.restore(null,120),true);
 assert.equal(old.wood(),120);
 assert.equal(old.weight(),1203);
 assert.equal(old.addLogs(1),0);
 assert.equal(old.addItem({id:'branch',count:1}),false);
 assert.equal(old.restoreSlot(old.slots.findIndex(x=>!x),{id:'branch',count:1}),false);
 const copy=createInventoryModel();
 assert.equal(copy.restore(old.serialize(),120),true);
 assert.equal(copy.weight(),old.weight());
});

test('crafted structures are carried individually and survive saves',()=>{
 const inv=createInventoryModel();
 assert.equal(inv.craftStructure('campfire'),false);
 assert.equal(inv.addLogs(2),2);
 assert.equal(inv.addItem({id:'stone',count:3}),true);
 assert.equal(inv.canCraftStructure('campfire'),true);
 assert.equal(inv.craftStructure('campfire'),true);
 assert.equal(inv.count('log'),0);
 assert.equal(inv.count('stone'),0);
 assert.equal(inv.count('campfire'),1);
 const snapshot=inv.serialize(),other=createInventoryModel();
 assert.equal(other.restore(snapshot,0),true);
 assert.equal(other.count('campfire'),1);
 assert.equal(other.addItem({id:'campfire',count:1}),true);
 assert.equal(other.count('campfire'),2);
 assert.equal(other.slots.filter(x=>x?.id==='campfire').length,2);
 assert.equal(other.spend('campfire',1),true);
 assert.equal(other.count('campfire'),1);
});

test('failed campfire craft is transactional when bag is full',()=>{
 const inv=createInventoryModel();
 assert.equal(inv.addLogs(3),3);
 assert.equal(inv.addItem({id:'stone',count:4}),true);
 for(const kind of ['branch','dry_grass','flower:daisy','flower:buttercup',
     'flower:pink_wildflower','flower:blue_wildflower',
     'mushroom:boletus','mushroom:fly_agaric','mushroom:milkcap'])
   assert.equal(inv.addItem({id:kind,count:1}),true);
 assert.equal(inv.slots.every(Boolean),true);
 const before=inv.serialize();
 assert.equal(inv.canCraftStructure('campfire'),false);
 assert.equal(inv.craftStructure('campfire'),false);
 assert.deepEqual(inv.serialize(),before,'ingredients must not disappear on failed craft');
});


test('debug-granted crescent axe lives in the bag and equips through 1–4 quick slots',()=>{
 const x=createInventoryModel();
 assert.equal(x.addItem({id:'axe_crescent',count:1}),true);
 assert.equal(x.count('axe_crescent'),1);
 assert.equal(x.slots[1].id,'axe_crescent');
 assert.equal(x.assignQuick(1,1),true);
 assert.equal(x.select(1),true);
 assert.equal(x.selected(),'axe_crescent');
 assert.equal(x.equipped(),true);
 assert.equal(x.axe().damage,3);
 assert.equal(x.axe().speed,1);
 assert.equal(x.select(0),true);
 assert.equal(x.axe().damage,1,'existing axe remains independent');
 assert.equal(x.select(1),true);
 const snapshot=x.serialize();
 const restored=createInventoryModel();
 assert.equal(restored.restore(snapshot,0),true);
 assert.equal(restored.selected(),'axe_crescent');
 assert.equal(restored.axe().damage,3);
 assert.equal(restored.weight(),6,'two axes weigh three kilos each');
});

test('crescent axe is individually stack-limited and never craftable',()=>{
 const inv=createInventoryModel();
 assert.equal(inv.addItem({id:'axe_crescent',count:1}),true);
 assert.equal(inv.addItem({id:'axe_crescent',count:2}),false);
 assert.equal(inv.free('axe_crescent')>=1,true,'additional distinct items may use free slots');
 assert.equal(inv.craft('axe_crescent'),false);
 assert.equal(inv.canAdd({id:'axe_crescent',count:1}),true);
});
