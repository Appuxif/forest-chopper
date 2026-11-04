import test from 'node:test';
import assert from 'node:assert/strict';
import {slotKey} from '../src/offline-save.js';
import {exportSlots,parseSlotArchive,importSlots,deleteSlot} from '../src/save-slots.js';

const save=seed=>({version:1,seed,wood:0,cuts:0,logsCollected:0,felled:[],damage:{},logs:[],position:{x:0,y:0,z:0,yaw:0,pitch:0},createdAt:100,savedAt:200});
function storage(){const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
test('archive exports all occupied slots and imports an explicit subset',()=>{
 const source=storage();source.setItem(slotKey(1),JSON.stringify(save(111)));source.setItem(slotKey(10),JSON.stringify(save(222)));
 const entries=parseSlotArchive(JSON.stringify(exportSlots(source)));assert.deepEqual(entries.map(e=>e.slot),[1,10]);
 const dest=storage();dest.setItem(slotKey(1),JSON.stringify(save(333)));
 importSlots(dest,entries.filter(e=>e.slot===10));assert.equal(JSON.parse(dest.getItem(slotKey(1))).seed,333);assert.equal(JSON.parse(dest.getItem(slotKey(10))).seed,222);
 importSlots(dest,entries);assert.equal(JSON.parse(dest.getItem(slotKey(1))).seed,111);
});
test('malformed archives and invalid slot numbers are rejected',()=>{
 const archive={format:'forest-chopper-slots',version:1,slots:[{slot:1,save:save(1)}]};
 for(const bad of [{...archive,version:2},{...archive,slots:[...archive.slots,...archive.slots]},{...archive,slots:[{slot:11,save:save(1)}]},{...archive,slots:[{slot:1,save:save(-1)}]}]) assert.throws(()=>parseSlotArchive(JSON.stringify(bad)));
 assert.throws(()=>slotKey(0));assert.throws(()=>slotKey(11));
});
test('failed multi-slot write restores earlier slots',()=>{
 const dest=storage();dest.setItem(slotKey(1),JSON.stringify(save(3)));const original=dest.getItem(slotKey(1));
 const set=dest.setItem;let failed=false;dest.setItem=(key,value)=>{if(key===slotKey(2)&&!failed){failed=true;throw Error('quota');}set(key,value);};
 assert.throws(()=>importSlots(dest,[{slot:1,save:save(4)},{slot:2,save:save(5)}]));assert.equal(dest.getItem(slotKey(1)),original);assert.equal(dest.getItem(slotKey(2)),null);
});


test('deleting one saved world leaves other slots untouched',()=>{
 const dest=storage();dest.setItem(slotKey(3),JSON.stringify(save(123)));dest.setItem(slotKey(4),JSON.stringify(save(456)));
 deleteSlot(dest,3);assert.equal(dest.getItem(slotKey(3)),null);assert.equal(JSON.parse(dest.getItem(slotKey(4))).seed,456);
 assert.throws(()=>deleteSlot(dest,11));assert.equal(JSON.parse(dest.getItem(slotKey(4))).seed,456);
});
