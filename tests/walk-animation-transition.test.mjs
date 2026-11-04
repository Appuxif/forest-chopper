import test from 'node:test';
import assert from 'node:assert/strict';
import {transitionLayer} from '../src/animations.js';
import {walkingMotion,playbackRateForSpeed} from '../src/root-motion-speed.js';

function action(time=0,duration=1){
 return {
  time,duration,scale:1,resets:0,fadeInMs:null,fadeOutMs:null,plays:0,
  getClip(){return {duration:this.duration};},
  getEffectiveTimeScale(){return this.scale;},
  reset(){this.time=0;this.resets++;return this;},
  setEffectiveTimeScale(scale){this.scale=scale;return this;},
  setEffectiveWeight(){return this;},
  fadeIn(secs){this.fadeInMs=secs;return this;},
  fadeOut(secs){this.fadeOutMs=secs;return this;},
  play(){this.plays++;return this;},
 };
}
function humanoid(){
 const lower={Walk:action(.27),WalkBackward:action(),Idle:action()};
 const upper={Walk:action(.27),WalkBackward:action(),Idle:action()};
 return {
  model:'male',lower,upper,lowerState:'Walk',upperState:'Walk',
  rmTimes:{Walk:.27},
 };
}

test('W-to-S switches to authored reverse clip without restarting halfway through stance',()=>{
 const actor=humanoid(),rate=playbackRateForSpeed({duration:1,travel:{x:0,z:1.32}},2.5);
 assert.equal(walkingMotion(actor,true),'WalkBackward');
 transitionLayer(null,actor,'lower','WalkBackward',rate);
 transitionLayer(null,actor,'upper','WalkBackward',rate);
 assert.equal(actor.lowerState,'WalkBackward');
 assert.equal(actor.upperState,'WalkBackward');
 assert.ok(Math.abs(actor.lower.WalkBackward.time-.73)<1e-10);
 assert.ok(Math.abs(actor.upper.WalkBackward.time-.73)<1e-10);
 assert.ok(Math.abs(actor.rmTimes.WalkBackward-.73)<1e-10);
 assert.equal(actor.lower.WalkBackward.scale,rate);
 assert.equal(actor.upper.WalkBackward.scale,rate);
 assert.equal(actor.lower.Walk.fadeOutMs,.12);
 assert.equal(actor.lower.WalkBackward.fadeInMs,.12);
 assert.equal(actor.upper.Walk.fadeOutMs,.12);
 assert.equal(actor.upper.WalkBackward.fadeInMs,.12);
 assert.equal(actor.lower.WalkBackward.resets,1);
 assert.equal(actor.upper.WalkBackward.resets,1);
 // Subsequent frames continue in the same Action, not a fresh restart.
 actor.lower.WalkBackward.time=.81;
 actor.upper.WalkBackward.time=.81;
 transitionLayer(null,actor,'lower','WalkBackward',rate);
 transitionLayer(null,actor,'upper','WalkBackward',rate);
 assert.equal(actor.lower.WalkBackward.time,.81);
 assert.equal(actor.upper.WalkBackward.time,.81);
 assert.equal(actor.lower.WalkBackward.resets,1);
});

test('S-to-W switches at the exact mirrored phase of the backward stride',()=>{
 const actor=humanoid(),rate=2.5/1.32;
 for(const layer of ['lower','upper']){
  actor[layer+'State']='WalkBackward';
  actor[layer].WalkBackward.time=.65;
 }
 transitionLayer(null,actor,'lower','Walk',rate);
 transitionLayer(null,actor,'upper','Walk',rate);
 for(const layer of ['lower','upper']){
  assert.equal(actor[layer+'State'],'Walk');
  assert.ok(Math.abs(actor[layer].Walk.time-.35)<1e-10);
  assert.equal(actor[layer].WalkBackward.fadeOutMs,.12);
 }
 assert.ok(Math.abs(actor.rmTimes.Walk-.35)<1e-10);
});

test('releasing direction blends into idle rather than cutting the walk early',()=>{
 const actor=humanoid();
 transitionLayer(null,actor,'lower','Idle');
 transitionLayer(null,actor,'upper','Idle');
 assert.equal(actor.lower.Walk.fadeOutMs,.12);
 assert.equal(actor.upper.Walk.fadeOutMs,.12);
 assert.equal(actor.lower.Idle.fadeInMs,.12);
 assert.equal(actor.upper.Idle.fadeInMs,.12);
 assert.equal(actor.lower.Idle.plays,1);
 assert.equal(actor.upper.Idle.plays,1);
});


test('Run to RunBackward uses reverse-phase transition on both layers',()=>{
 const lower={Run:action(.22,2/3),RunBackward:action(0,2/3)};
 const upper={Run:action(.22,2/3),RunBackward:action(0,2/3)};
 const actor={model:'male',lower,upper,lowerState:'Run',upperState:'Run',rmTimes:{Run:.22}};
 for(const layer of ['lower','upper']){
  transitionLayer(null,actor,layer,'RunBackward',1.2);
  assert.equal(actor[layer+'State'],'RunBackward');
  assert.ok(Math.abs(actor[layer].RunBackward.time-((1-.22/(2/3))*(2/3)))<1e-10);
  assert.equal(actor[layer].RunBackward.scale,1.2);
  assert.equal(actor[layer].RunBackward.fadeInMs,.12);
 }
 assert.ok(Math.abs(actor.rmTimes.RunBackward-lower.RunBackward.time)<1e-10);
 // The other direction must mirror as well instead of restarting frame 0.
 const before=lower.RunBackward.time=.31;
 actor.lowerState='RunBackward';
 transitionLayer(null,actor,'lower','Run',1.2);
 assert.ok(Math.abs(actor.lower.Run.time-((1-before/(2/3))*(2/3)))<1e-10);
});
