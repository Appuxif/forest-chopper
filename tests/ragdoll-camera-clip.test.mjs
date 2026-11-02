import test from 'node:test';
import assert from 'node:assert/strict';
import {setRagdollCameraClipping,createRagdollCameraLifecycle} from '../src/player.js';

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

function cameraFixture(thirdPerson){
 let projectionUpdates=0,orbitResets=0,toggleCount=0;
 const ctx={thirdPerson,camera:{near:.1,far:280,
   updateProjectionMatrix(){projectionUpdates++;}}};
 const lifecycle=createRagdollCameraLifecycle(ctx,{
   toggleView(){toggleCount++;ctx.thirdPerson=!ctx.thirdPerson;},
   resetOrbit(){orbitResets++;},
 });
 return {ctx,lifecycle,get projectionUpdates(){return projectionUpdates},
   get orbitResets(){return orbitResets},get toggleCount(){return toggleCount}};
}

test('first-person death ragdoll restores exact prior camera mode, clipping and orbit',()=>{
 const f=cameraFixture(false);
 assert.equal(f.lifecycle.enter(),true);
 assert.equal(f.ctx.thirdPerson,true,'death needs to show the fallen body');
 assert.equal(f.ctx.camera.near,.01);
 assert.equal(f.lifecycle.enter(),false,'enter is idempotent');
 assert.equal(f.lifecycle.exit(),true);
 assert.equal(f.ctx.thirdPerson,false,'respawn must restore first-person mode');
 assert.equal(f.ctx.camera.near,.1);
 assert.equal(f.toggleCount,2);
 assert.equal(f.orbitResets,2,'teleport should discard the old camera pivot');
 assert.equal(f.projectionUpdates,2);
 assert.equal(f.lifecycle.exit(),false,'exit is idempotent');
 assert.equal(f.orbitResets,2);
});

test('third-person ragdoll reset preserves view and restores camera after bed/manual get-up',()=>{
 const f=cameraFixture(true);
 f.lifecycle.enter();
 assert.equal(f.ctx.thirdPerson,true);
 f.lifecycle.exit();
 assert.equal(f.ctx.thirdPerson,true);
 assert.equal(f.ctx.camera.near,.1);
 assert.equal(f.toggleCount,0);
 assert.equal(f.orbitResets,2);
 // A second, independent ragdoll is equally safe.
 f.lifecycle.enter();
 f.lifecycle.exit();
 assert.equal(f.orbitResets,4);
});

test('ragdoll restores the original camera even if user toggles view while fallen',()=>{
 const f=cameraFixture(false);
 f.lifecycle.enter();
 f.ctx.thirdPerson=false; // user presses V while lying down
 f.lifecycle.exit();
 assert.equal(f.ctx.thirdPerson,false);
 assert.equal(f.toggleCount,1,'do not blindly toggle when view is already correct');
 assert.equal(f.ctx.camera.near,.1);
});
