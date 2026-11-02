import test from 'node:test';
import assert from 'node:assert/strict';
import {setRagdollCameraClipping} from '../src/player.js';

test('ragdoll reduces near clipping without moving camera or changing orbit settings',()=>{
 let updates=0;
 const camera={near:.1,far:280,position:{x:3,y:4,z:5},
   updateProjectionMatrix(){updates++;}};
 assert.equal(setRagdollCameraClipping(camera,true,.1),true);
 assert.equal(camera.near,.01);
 assert.deepEqual(camera.position,{x:3,y:4,z:5});
 assert.equal(camera.far,280);
 assert.equal(setRagdollCameraClipping(camera,true,.1),false,'no per-frame projection update');
 assert.equal(setRagdollCameraClipping(camera,false,.1),true);
 assert.equal(camera.near,.1);
 assert.equal(updates,2);
});
