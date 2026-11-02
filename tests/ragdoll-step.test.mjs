import test from 'node:test';
import assert from 'node:assert/strict';
import {stepRagdollPhysics,RAGDOLL_FIXED_STEP} from '../src/ragdoll-step.js';

test('ragdoll physics runs a bounded number of fixed steps and settles once per display tick',()=>{
 const calls=[];
 const instance={
  accumulator:0,elapsed:0,
  world:{step(){calls.push('world');}},
  settling:{tick(dt){calls.push(['settling',dt]);}},
 };
 assert.equal(stepRagdollPhysics(instance,1/60),1);
 assert.equal(instance.elapsed,RAGDOLL_FIXED_STEP);
 assert.deepEqual(calls,['world',['settling',RAGDOLL_FIXED_STEP]]);
 calls.length=0;
 assert.equal(stepRagdollPhysics(instance,.5),7);
 assert.equal(calls.filter(x=>x==='world').length,7);
 assert.deepEqual(calls.at(-1),['settling',7*RAGDOLL_FIXED_STEP]);
});

test('WASM step failure propagates to the owning ragdoll for safe shutdown',()=>{
 let called=0;
 const instance={
  accumulator:0,elapsed:0,
  world:{step(){
   called++;
   if(called===2)throw new Error('recursive use of an object detected which would lead to unsafe aliasing in rust');
  }},
  settling:{tick(){throw Error('must not run settling after a world panic');}},
 };
 assert.throws(()=>stepRagdollPhysics(instance,.06),
  /recursive use of an object/);
 assert.equal(called,2);
 assert.equal(instance.elapsed,RAGDOLL_FIXED_STEP);
});
