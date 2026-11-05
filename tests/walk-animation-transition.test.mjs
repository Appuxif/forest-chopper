import test from 'node:test';
import assert from 'node:assert/strict';
import {transitionLayer,matchingLocomotionPhase,canTransitionUpperBody} from '../src/animations.js';
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


test('upper-body walking resumes from the leg phase after Chop2, never from frame zero',()=>{
 for(const model of ['legacy','male','female']){
  for(const name of ['Walk','WalkBackward','Run','RunBackward','StrafeLeft','StrafeRight']){
   const duration=name==='Run'||name==='RunBackward'?2/3:1;
   const lower={[name]:action(duration*.63,duration)};
   const upper={[name]:action(0,duration),Chop2:action(1.1,46/30)};
   const actor={
    model,lower,upper,lowerState:name,upperState:'Chop2',
    chopEnd:500,rmTimes:{[name]:lower[name].time},
   };
   assert.equal(canTransitionUpperBody(actor,499),false);
   assert.equal(canTransitionUpperBody(actor,501),true);
   transitionLayer(null,actor,'upper',name,1.15);
   assert.equal(actor.upperState,name);
   assert.ok(Math.abs(upper[name].time-lower[name].time)<1e-12,
    model+' '+name+' upper/lower stride phase differs');
   assert.equal(upper[name].resets,1);
   assert.equal(upper.Chop2.fadeOutMs,.18);
   assert.equal(upper[name].fadeInMs,.18);
   assert.equal(upper[name].scale,1.15);
   // During subsequent animation frames the active clip isn't reset.
   upper[name].time+=.07;
   lower[name].time+=.07;
   transitionLayer(null,actor,'upper',name,1.15);
   assert.equal(upper[name].resets,1);
   assert.ok(Math.abs(upper[name].time-lower[name].time)<1e-12);
  }
 }
});

test('switching direction during an attack resumes the current lower-body motion',()=>{
 const actor={
  lower:{WalkBackward:action(.79),Walk:action(.2)},
  upper:{WalkBackward:action(0),Walk:action(.15),Chop2:action(.99,46/30)},
  lowerState:'WalkBackward',upperState:'Chop2',chopEnd:750,rmTimes:{},
 };
 assert.equal(canTransitionUpperBody(actor,700),false);
 assert.equal(actor.upperState,'Chop2');
 transitionLayer(null,actor,'upper','WalkBackward',2);
 assert.equal(actor.upper.WalkBackward.time,.79);
 assert.equal(actor.upper.WalkBackward.scale,2);
});

test('normalized phase sync handles different clip durations and looped lower time',()=>{
 const lower=action(1.5,1),upper=action(0,2.5);
 assert.ok(Math.abs(matchingLocomotionPhase(lower,upper)-1.25)<1e-12);
 lower.time=.9;
 assert.ok(Math.abs(matchingLocomotionPhase(lower,upper)-2.25)<1e-12);
 lower.time=-.2;
 assert.ok(Math.abs(matchingLocomotionPhase(lower,upper)-2)<1e-12);
 lower.time=NaN;
 assert.equal(matchingLocomotionPhase(lower,upper),null);
 lower.time=0.25;
 lower.duration=0;
 assert.equal(matchingLocomotionPhase(lower,upper),null);
 assert.equal(matchingLocomotionPhase(null,upper),null);
});

test('upper-body walk entering on an already-moving actor uses legs as phase authority',()=>{
 const actor=humanoid();
 actor.lower.Walk.time=.48;
 actor.upperState='Idle';
 actor.upper.Idle.time=.9;
 actor.upper.Walk.time=0;
 transitionLayer(null,actor,'upper','Walk',1.5);
 assert.equal(actor.upper.Walk.time,.48);
 assert.equal(actor.upper.Walk.scale,1.5);
 assert.equal(actor.upper.Idle.fadeOutMs,.12);
});
