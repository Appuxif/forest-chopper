import test from 'node:test';
import assert from 'node:assert/strict';
import {createCorpseLootPointer} from '../src/corpse-loot-pointer.js';
function fixture(){
 const events=[],canvas={requestPointerLock(){events.push('lock');doc.pointerLockElement=canvas;}};
 const doc={pointerLockElement:canvas,exitPointerLock(){events.push('unlock');doc.pointerLockElement=null;},hasFocus:()=>true};
 const ctx={renderer:{domElement:canvas},keys:{KeyW:true},notify:m=>events.push(m)};
 return {ctx,doc,canvas,events,pointer:createCorpseLootPointer(ctx,{doc})};
}
test('opening frees a previously locked mouse, releases movement and closing restores it once',()=>{
 const f=fixture();f.pointer.open();f.pointer.open();assert.deepEqual(f.events,['unlock']);
 assert.equal(f.ctx.keys.KeyW,false);assert.equal(f.doc.pointerLockElement,null);
 f.pointer.close(true);f.pointer.close(true);assert.deepEqual(f.events,['unlock','lock']);
});
test('Escape and automatic dismissal do not recapture; opening with a free cursor leaves it free',()=>{
 const f=fixture();f.pointer.open();f.pointer.close(false);assert.deepEqual(f.events,['unlock']);
 f.pointer.open();f.pointer.close(true);assert.deepEqual(f.events,['unlock']);
});
test('background tab, death and other modals never steal the mouse back',()=>{
 for(const block of [f=>f.doc.hasFocus=()=>false,f=>f.ctx.deathSystem={active:true},f=>f.ctx.inventory={isOpen:true},f=>f.ctx.storages={opened:'chest'}]){
  const f=fixture();f.pointer.open();block(f);f.pointer.close(true);assert.deepEqual(f.events,['unlock']);
 }
});
test('a rejected or throwing lock request gives a continuation hint without throwing',async()=>{
 for(const asyncFailure of [true,false]){
  const f=fixture();f.canvas.requestPointerLock=()=>{if(asyncFailure)return Promise.reject(new Error('blocked'));throw new Error('blocked');};
  f.pointer.open();f.pointer.close(true);await Promise.resolve();
  assert.deepEqual(f.events,['unlock','Нажмите по игре, чтобы продолжить']);
 }
});
test('canvas clicks and taps cannot attack while the real-cursor dialog is open',()=>{
 const f=fixture();let consumed=0;const event={preventDefault(){consumed++;},stopImmediatePropagation(){consumed++;}};
 assert.equal(f.pointer.handlePointer(event),false);f.pointer.open();assert.equal(f.pointer.handlePointer(event),true);assert.equal(consumed,2);
 f.pointer.close();assert.equal(f.pointer.handlePointer(event),false);
});
