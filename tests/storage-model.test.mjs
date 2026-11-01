import test from 'node:test';
import assert from 'node:assert/strict';
import {createInventoryModel} from '../src/inventory.js';
import {makeStorage,storageWeight,validStorage,storeItem,transferStorage,
 renameStorage,CHEST_SLOTS,RACK_MAX_LOGS} from '../src/storage-model.js';

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
