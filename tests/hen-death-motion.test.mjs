import test from 'node:test';
import assert from 'node:assert/strict';
import {henDeathMotion} from '../src/hen-death-motion.js';
import {createHenWorld} from '../src/hen-rules.js';
test('axe sends a stationary hen away from the attacker and retains bounded running inertia',()=>{
 assert.deepEqual(henDeathMotion({x:0,z:1},{x:0,z:0}),{velocityX:0,velocityZ:2});
 const sideways=henDeathMotion({x:0,z:1,velocityX:4.5,velocityZ:0},{x:0,z:0});
 assert.ok(Math.abs(sideways.velocityX-1.35)<1e-9);assert.equal(sideways.velocityZ,2);
 const fast=henDeathMotion({x:0,z:1,velocityZ:100},{x:0,z:0});assert.equal(Math.hypot(fast.velocityX,fast.velocityZ),3);
 assert.ok(henDeathMotion({x:0,z:0},{x:0,z:0,yaw:0}).velocityZ<0);
});
test('offline death stores the impact exactly once, and loot actions never add another impulse',()=>{
 const world=createHenWorld({seed:8});const bird=world.tick(0,[{x:0,z:0}])[0];
 const attacker={x:bird.x-1,z:bird.z};assert.equal(world.hit(bird.id,attacker),true);
 const corpse=world.tick(0,[{x:0,z:0}]).find(r=>r.id===bird.id);assert.equal(corpse.velocityX,2);
 assert.equal(world.hit(bird.id,{x:bird.x+1,z:bird.z}),false);
 assert.equal(world.tick(0,[{x:0,z:0}]).find(r=>r.id===bird.id).velocityX,2);
});
