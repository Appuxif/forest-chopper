import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInventoryModel} from '../src/inventory.js';
import {makeStorage,storageWeight,validStorage,storeItem,transferStorage,
 moveStorageSlot,renameStorage,CHEST_SLOTS,RACK_MAX_LOGS} from '../src/storage-model.js';

test('chest has 24 slots and 300kg independent limits',()=>{
 const chest=makeStorage('chest',1,2,4);
 assert.equal(chest.slots.length,CHEST_SLOTS);
 assert.equal(validStorage(chest),true);
 assert.equal(storeItem(chest,{id:'stone',count:10}),true);
 for(let i=0;i<14;i++)assert.equal(storeItem(chest,{id:'stone',count:10}),true);
 assert.equal(storageWeight(chest),300);
 assert.equal(storeItem(chest,{id:'flower:daisy',count:1}),false);
 assert.equal(validStorage(chest),true);
 chest.slots[0].count=999;
 assert.equal(validStorage(chest),false);
});
test('chest transfers quantities atomically and rejects overweight player transfers',()=>{
 const bag=createInventoryModel(),chest=makeStorage('chest',2,1,1);
 bag.addItem({id:'stone',count:10});
 assert.equal(transferStorage(chest,bag,{direction:'deposit',slot:1,qty:5}),true);
 assert.equal(bag.count('stone'),5);assert.equal(chest.slots[0].count,5);
 assert.equal(transferStorage(chest,bag,{direction:'withdraw',slot:0,qty:1}),true);
 assert.equal(bag.count('stone'),6);assert.equal(chest.slots[0].count,4);
 assert.equal(transferStorage(chest,bag,{direction:'deposit',slot:1,qty:9}),false);
 assert.equal(bag.count('stone'),6);
 assert.equal(chest.slots[0].count,4);
 assert.equal(renameStorage(chest,'  Heavy items  '),true);
 assert.equal(chest.name,'Heavy items');
 assert.equal(renameStorage(chest,'   '),false);
});
test('rack initial quantity and malformed storage data',()=>{
 const rack=makeStorage('rack',3,0,0);
 assert.equal(rack.logs,0);assert.equal(validStorage(rack),true);
 rack.logs=RACK_MAX_LOGS;assert.equal(validStorage(rack),true);
 rack.logs++;assert.equal(validStorage(rack),false);
});

test('chest drag/drop: exact slots, merging, half split and swaps are atomic',()=>{
 const bag=createInventoryModel(),chest=makeStorage('chest',9,0,0);
 assert.equal(bag.addItem({id:'stone',count:8}),true);
 assert.equal(bag.addItem({id:'branch',count:4}),true);
 assert.equal(moveStorageSlot(chest,bag,{fromArea:'bag',from:1,toArea:'chest',to:7}),true);
 assert.deepEqual(chest.slots[7],{id:'stone',count:8});
 assert.equal(bag.count('stone'),0);
 assert.equal(moveStorageSlot(chest,bag,{fromArea:'chest',from:7,toArea:'chest',to:3,half:true}),true);
 assert.deepEqual(chest.slots[3],{id:'stone',count:4});
 assert.deepEqual(chest.slots[7],{id:'stone',count:4});
 assert.equal(moveStorageSlot(chest,bag,{fromArea:'chest',from:3,toArea:'chest',to:7}),true);
 assert.equal(chest.slots[3],null);
 assert.equal(chest.slots[7].count,8);
 assert.equal(moveStorageSlot(chest,bag,{fromArea:'bag',from:2,toArea:'chest',to:7}),true);
 assert.equal(chest.slots[7].id,'branch','a different item swaps across inventories');
 assert.equal(bag.slots[2].id,'stone');
 assert.equal(bag.count('stone'),8);
 assert.equal(moveStorageSlot(chest,bag,{fromArea:'chest',from:7,toArea:'bag',to:4,half:true}),true);
 assert.equal(bag.slots[4].count,2);
 assert.equal(chest.slots[7].count,2);
 assert.equal(moveStorageSlot(chest,bag,{fromArea:'chest',from:7,toArea:'bag',to:4}),true);
 assert.equal(bag.slots[4].count,4);
 assert.equal(chest.slots[7],null);
});
test('chest drag/drop enforces item limits and weight without losing items',()=>{
 const bag=createInventoryModel(),chest=makeStorage('chest',10,0,0);
 assert.equal(bag.addItem({id:'stone',count:10}),true);
 assert.equal(bag.addItem({id:'stone',count:10}),true);
 assert.equal(moveStorageSlot(chest,bag,{fromArea:'bag',from:1,toArea:'chest',to:0}),true);
 assert.equal(moveStorageSlot(chest,bag,{fromArea:'bag',from:2,toArea:'chest',to:1}),true);
 assert.equal(moveStorageSlot(chest,bag,{fromArea:'chest',from:0,toArea:'chest',to:1}),false,'cannot overfill stack');
 assert.equal(chest.slots[0].count,10);
 assert.equal(chest.slots[1].count,10);
 assert.equal(moveStorageSlot(chest,bag,{fromArea:'chest',from:0,toArea:'bag',to:0}),true,
  'swap axe and stone, respecting weight and special item metadata');
 assert.equal(chest.slots[0].id,'axe');
 assert.equal(bag.slots[0].count,10);
 assert.equal(bag.slots[0].id,'stone');
 assert.equal(moveStorageSlot(chest,bag,{fromArea:'chest',from:0,toArea:'bag',to:0,half:true}),true,
  'single axe swaps even when half modifier is pressed');
 assert.equal(chest.slots[0].id,'stone');
 assert.equal(bag.slots[0].id,'axe');
 chest.slots[5]={id:'log',count:5};
 chest.slots[6]={id:'log',count:5};
 chest.slots[7]={id:'log',count:5};
 chest.slots[8]={id:'log',count:5};
 chest.slots[9]={id:'log',count:5};
 assert.equal(storageWeight(chest),290,'pre-transfer chest is within its 300kg limit');
 assert.equal(bag.addItem({id:'stone',count:10}),true);
 const initial=bag.serialize();
 assert.equal(moveStorageSlot(chest,bag,{fromArea:'bag',from:1,toArea:'chest',to:11}),false);
 assert.deepEqual(bag.serialize(),initial);
});

test('storage has no separate floating E button; nameplate sits on chest lid',()=>{
 const ui=readFileSync(new URL('../src/storages.js',import.meta.url),'utf8');
 assert.doesNotMatch(ui,/fc-storage-open|Открыть хранилище \(E\)/,
  'the old floating button is removed, not merely moved');
 assert.match(ui,/board\.rotation\.x=-Math\.PI\/2/,'nameplate is horizontal');
 assert.match(ui,/board\.position\.set\(0,1\.074,0\)/,
  'the nameplate is mounted just above the lid');
 assert.match(ui,/label\.material=nameMaterial\(existing\.name\)/,
  'renaming updates the label texture in place');
});
