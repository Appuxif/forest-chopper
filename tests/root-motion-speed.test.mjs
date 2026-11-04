import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MIN_ROOT_TRAVEL,rootMotionSpeed,playbackRateForSpeed,mirroredWalkPhaseTime,walkingMotion,rootMotionSampleDelta,humanoidTargetSpeed,STRAFE_SPEED,STRAFE_SPRINT_SPEED,WALK_SPEED,playbackDirectionForMotion} from '../src/root-motion-speed.js';

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

test('authored 1.32m walk moves at 2.0m/s (20% slower than old rate)',()=>{
 const walk=info(0,1.32,1);
 const backward=info(0,-1.32,1);
 for(const clip of [walk,backward]){
  assert.equal(rootMotionSpeed(clip),1.32);
  const rate=playbackRateForSpeed(clip,WALK_SPEED);
  assert.equal(WALK_SPEED,2.0);
  assert.equal(humanoidTargetSpeed('Walk',false),WALK_SPEED);
  assert.equal(humanoidTargetSpeed('WalkBackward',false),WALK_SPEED);
  assert.ok(Math.abs(rate-2/1.32)<1e-10);
  assert.ok(Math.abs(rootMotionSpeed(clip)*rate-2)<1e-10);
  assert.ok(Math.abs(1/rate-.66)<1e-10,
   'one 30-frame cycle spans 0.66 seconds at the new 2.0 m/s walking speed');
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


test('authored 60cm side steps move farther, but play 20% slower',()=>{
 const delta=.6,duration=26/30;
 for(const sign of [1,-1]){
  const strafe=info(sign*delta,0,duration);
  assert.ok(Math.abs(rootMotionSpeed(strafe)-.6/duration)<1e-10);
  for(const sprint of [false,true]){
   const motion=sign>0?'StrafeLeft':'StrafeRight';
   const target=humanoidTargetSpeed(motion,sprint);
   assert.equal(target,sprint?STRAFE_SPRINT_SPEED:STRAFE_SPEED);
   const rate=playbackRateForSpeed(strafe,target);
   const previousRate=(sprint?1.5:1.0)/(.4/duration);
   assert.ok(Math.abs(rate/previousRate-.8)<1e-10,
     'strafe animation must play at 80% of the previous playback rate');
   assert.ok(rate>1&&rate<3,'do not accelerate the two-step animation excessively');
   assert.ok(Math.abs(rate*rootMotionSpeed(strafe)-target)<1e-8);
  }
 }
 assert.equal(humanoidTargetSpeed('Walk',false),2.0);
 assert.equal(humanoidTargetSpeed('WalkBackward',false),2.0);
 assert.equal(humanoidTargetSpeed('Run',true),4.6);
 // Run still bypasses computed root speed: preserve the existing fixed 1.2x.
 const fs=readFileSync(new URL('../src/player.js',import.meta.url),'utf8');
 assert.match(fs,/motion==='Run'\?1\.2:playbackRateForSpeed/);
});

test('left and right strafe root steps move smoothly on every frame through loop wrap',()=>{
 const duration=26/30;
 for(const sign of [1,-1]){
  const reused=new Float32Array(3),dx=sign*.6;
  const strafe={
   duration,travel:{x:dx,y:0,z:0},
   sampler:{evaluate(t){reused[0]=dx*t/duration;reused[1]=0;reused[2]=0;return reused;}},
  };
  const velocity=humanoidTargetSpeed('StrafeLeft',false);
  const rate=playbackRateForSpeed(strafe,velocity);
  const dt=1/60;
  let previous=0,moved=0,loops=0;
  for(let frame=1;frame<=240;frame++){
   const fromAbsolute=(frame-1)*dt*rate;
   const toAbsolute=frame*dt*rate;
   const from=fromAbsolute%duration;
   const to=toAbsolute%duration;
   if(to<from)loops++;
   const step=rootMotionSampleDelta(strafe,from,to,false);
   assert.ok(Math.abs(step[0]-sign*velocity*dt)<.00001,
    'no foot sliding, stall, or full-cycle teleport');
   assert.ok(Math.abs(step[1])<1e-10&&Math.abs(step[2])<1e-10);
   moved+=step[0];
   previous=to;
  }
  assert.ok(loops>2);
  assert.ok(Math.abs(moved-sign*4*velocity)<.0001);
 }
});


test('dedicated left/right strafe clips must never reverse with backward camera motion',()=>{
 for(const motion of ['StrafeLeft','StrafeRight','WalkBackward','Idle']){
  assert.equal(playbackDirectionForMotion(motion,true),1);
  assert.equal(playbackDirectionForMotion(motion,false),1);
 }
 assert.equal(playbackDirectionForMotion('Walk',true),-1);
 assert.equal(playbackDirectionForMotion('Run',true),-1);
 assert.equal(playbackDirectionForMotion('Run',false),1);
});
