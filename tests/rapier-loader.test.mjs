import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysicsLoader} from '../src/rapier-loader.js';
test('prewarm and both ragdolls share one import and completed WASM initialization',async()=>{
 let imports=0,inits=0;const physics={init:async()=>{inits++;}};
 const load=createPhysicsLoader(async()=>{imports++;return {default:physics};});
 const pending=load();assert.equal(load(),pending);
 assert.equal(await pending,physics);assert.equal(await load(),physics);assert.equal(imports,1);assert.equal(inits,1);
});
test('failed import or initialization can retry rather than caching rejection',async()=>{
 let calls=0;const load=createPhysicsLoader(()=>{if(!calls++)throw Error('offline');return {init:async()=>{}};});
 await assert.rejects(load(),/offline/);assert.ok(await load());assert.equal(calls,2);
});
