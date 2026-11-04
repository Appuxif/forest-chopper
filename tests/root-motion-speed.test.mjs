import test from 'node:test';
import assert from 'node:assert/strict';
import {MIN_ROOT_TRAVEL,rootMotionSpeed,playbackRateForSpeed,mirroredWalkPhaseTime,walkingMotion,rootMotionSampleDelta} from '../src/root-motion-speed.js';

const info=(x,z,duration)=>({travel:{x,z},duration});

test('animation travel and duration determine native meters per second',()=>{
 const run=info(0,1.8882,22/30);
 assert.ok(Math.abs(rootMotionSpeed(run)-2.5748)<.001);
 assert.ok(Math.abs(playbackRateForSpeed(run,4.6)-1.786)<.005);
});

test('root playback reacts to different animation frame counts',()=>{
 const sameTravelShort=info(0,1.5,15/30);
 const sameTravelLong=info(0,1.5,30/30);
 assert.equal(rootMotionSpeed(sameTravelShort),3);
 assert.equal(rootMotionSpeed(sameTravelLong),1.5);
 assert.equal(playbackRateForSpeed(sameTravelLong,3),2);
 assert.equal(playbackRateForSpeed(sameTravelShort,3),1);
});

test('stationary walk is not mistaken for real root motion',()=>{
 assert.equal(rootMotionSpeed(info(.0009,.0001,1)),0);
 assert.equal(playbackRateForSpeed(info(0,0,1),2.5),1);
 assert.equal(rootMotionSpeed(info(MIN_ROOT_TRAVEL,0,1)),MIN_ROOT_TRAVEL);
 assert.equal(rootMotionSpeed(info(1,0,0)),0);
});

test('authored 1.32m walking cycle matches existing 2.5m/s gameplay speed',()=>{
 const walk=info(0,1.32,1);
 const backward=info(0,-1.32,1);
 for(const clip of [walk,backward]){
  assert.equal(rootMotionSpeed(clip),1.32);
  const rate=playbackRateForSpeed(clip,2.5);
  assert.ok(Math.abs(rate-2.5/1.32)<1e-10);
  assert.ok(Math.abs(rootMotionSpeed(clip)*rate-2.5)<1e-10);
  assert.ok(Math.abs(1/rate-.528)<1e-10,'one 30-frame cycle spans 0.528 seconds at game speed');
 }
});

test('legacy playback remains reversed, new humanoids use authored backwards action',()=>{
 const actor={lower:{Walk:{},WalkBackward:{}}};
 assert.equal(walkingMotion(actor,false),'Walk');
 assert.equal(walkingMotion(actor,true),'WalkBackward');
 assert.equal(walkingMotion({lower:{Walk:{}}},true),'Walk');
 assert.equal(walkingMotion(null,true),'Walk');
});

test('opposite walking direction starts at mirrored phase rather than restarting a stride',()=>{
 assert.ok(Math.abs(mirroredWalkPhaseTime(.25,1,1)-.75)<1e-12);
 assert.ok(Math.abs(mirroredWalkPhaseTime(.90,1,1)-.10)<1e-12);
 assert.equal(mirroredWalkPhaseTime(0,1,1),0);
 assert.equal(mirroredWalkPhaseTime(1,1,1),0);
 assert.ok(Math.abs(mirroredWalkPhaseTime(.25,1,2)-1.5)<1e-12);
 assert.equal(mirroredWalkPhaseTime(0,0,1),0);
});

test('root-motion sampler crosses a loop seam without dropping or double-counting distance',()=>{
 const delta=1.32;
 const forward={
  sampler:{evaluate(t){return [0,0,delta*t];}},
  travel:{x:0,z:delta},
 };
 const backward={
  sampler:{evaluate(t){return [0,0,-delta*t];}},
  travel:{x:0,z:-delta},
 };
 for(const data of [forward,backward]){
  const expected=data.travel.z;
  const intervals=[[.1,.35],[.35,.75],[.75,.98],[.98,.07],[.07,.1]];
  const steps=intervals.map(([from,to])=>rootMotionSampleDelta(data,from,to,false)[2]);
  assert.ok(steps.every(value=>Math.sign(value)===Math.sign(expected)));
  assert.ok(Math.abs(steps.reduce((a,b)=>a+b,0)-expected)<1e-10);
  assert.ok(Math.abs(steps[3]-(.09*expected))<1e-10,
   'wrap contributes the final 2% and the first 7% of a stride');
  // Classic backwards playback still uses the same sampler with a
  // negative time scale, so its wrap runs in the opposite direction.
  assert.ok(Math.abs(rootMotionSampleDelta(data,.08,.97,true)[2]-
    (-.11*expected))<1e-10);
 }
});

test('Three.js interpolant reuses one sample buffer: movement must be smooth every frame',()=>{
 // Regression for the original freeze-then-teleport bug: evaluate(from)
 // and evaluate(to) return the SAME Float32Array, overwritten on each call.
 const reused=new Float32Array(3),duration=1,travel=1.32;
 for(const sign of [1,-1]){
  const info={
   sampler:{evaluate(time){reused[0]=0;reused[1]=0;reused[2]=sign*travel*time;return reused;}},
   travel:{x:0,y:0,z:sign*travel},
  };
  let accumulated=0;
  let previous=0;
  const dt=1/60,rate=2.5/travel;
  const frameFraction=dt*rate/duration;
  for(let frame=1;frame<=180;frame++){
   const current=(frame*frameFraction)%1;
   const step=rootMotionSampleDelta(info,previous,current);
   assert.ok(Math.abs(step[2]-sign*2.5*dt)<2e-6,
    'each animation frame must contribute its own travel, not wait for the loop seam');
   accumulated+=step[2];
   previous=current;
  }
  assert.ok(Math.abs(accumulated-sign*7.5)<1e-4,
   '3 seconds of walking at 2.5 m/s moves 7.5m without discontinuities');
 }
});
