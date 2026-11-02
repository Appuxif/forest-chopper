import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerMotionTracker,captureRagdollMomentum,applyRagdollMomentum} from '../src/ragdoll-motion.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`expected ${a} ≈ ${b}`);
test('real player displacement (Root Motion + collision resolved) provides world velocity',()=>{
 const m=createPlayerMotionTracker();
 m.reset(0,0,0);
 const sprint=m.sample(0,-.08,0,.02);
 near(sprint.z,-4);near(sprint.x,0);
 const strafe=m.sample(.06,-.08,0,.02);
 near(strafe.x,3);near(strafe.z,0);
 const blocked=m.sample(.06,-.08,0,.02);
 near(blocked.x,0);near(blocked.z,0);
});
test('turn rate wraps correctly at ±pi, avoiding spurious spins',()=>{
 const m=createPlayerMotionTracker();
 m.reset(0,0,Math.PI-.01);
 const v=m.sample(0,0,-Math.PI+.01,.02);
 near(v.angularY,1);
});
test('ragdoll inherits horizontal sprint, upward jump velocity and yaw inertia',()=>{
 const motion=captureRagdollMomentum({motionVelocity:{x:3,z:-4,angularY:2},verticalSpeed:7.5});
 assert.deepEqual(motion,{x:3,y:7.5,z:-4,angularY:2});
 const calls=[];
 const parts=Array.from({length:11},()=>({body:{
  setLinvel(v,wake){calls.push(['velocity',v,wake]);},
  setAngvel(v,wake){calls.push(['spin',v,wake]);},
 }}));
 applyRagdollMomentum(parts,motion);
 assert.equal(calls.length,22);
 assert.equal(calls.filter(c=>c[0]==='velocity'&&c[1].z===-4&&c[1].y===7.5&&c[2]).length,11);
 assert.equal(calls.filter(c=>c[0]==='spin'&&c[1].y===2&&c[2]).length,11);
});
test('yaw inertia adds tangential linear velocity to limbs without changing hips speed',()=>{
 const velocities=[];
 const parts=[{center:{x:0,z:0}},{center:{x:1,z:0}},{center:{x:-1,z:0}}].map(p=>({
  ...p,body:{setLinvel(v){velocities.push(v)},setAngvel(){}},
 }));
 applyRagdollMomentum(parts,{x:0,y:-2,z:-3,angularY:2});
 assert.deepEqual(velocities[0],{x:0,y:-2,z:-3});
 assert.deepEqual(velocities[1],{x:0,y:-2,z:-1});
 assert.deepEqual(velocities[2],{x:0,y:-2,z:-5});
});
test('ragdoll retains downward speed and limits absurd spikes; sleeping has no inherited velocity',()=>{
 const ctx={motionVelocity:{x:300,z:-400,angularY:200},verticalSpeed:-60};
 const v=captureRagdollMomentum(ctx);
 near(Math.hypot(v.x,v.z),12);
 near(v.y,-40);near(v.angularY,4);
 assert.deepEqual(captureRagdollMomentum(ctx,{bed:true}),{x:0,y:0,z:0,angularY:0});
});
test('tracker reset after ragdoll/respawn cannot produce teleport velocity',()=>{
 const m=createPlayerMotionTracker();
 m.reset(3,4,0);
 m.sample(3,-2,0,.02);
 m.reset(0,0,0);
 assert.deepEqual(m.sample(0,0,0,.016),{x:0,z:0,angularY:0});
});
