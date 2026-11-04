import test from 'node:test';
import assert from 'node:assert/strict';
import {
  movementInput,locomotionMode,targetLegsYaw,worldMoveDirection,
  createMovementSteering,RUN_DIRECTION_TURN_RATE,WALK_DIRECTION_TURN_RATE,
  joystickSprintActive,JOYSTICK_SPRINT_ENTER,JOYSTICK_SPRINT_EXIT,
  MOVE_DEADZONE,STRAFE_BLEND_START,STRAFE_BLEND_END,
} from '../src/locomotion-input.js';

const near=(actual,expected,epsilon=1e-9)=>
  assert.ok(Math.abs(actual-expected)<epsilon,`${actual} should equal ${expected}`);
const input=(keys,extra={})=>movementInput({keys, ...extra});

test('keyboard W, S, A, D and diagonal input produce one normalized vector',()=>{
  const w=input({KeyW:true}),s=input({KeyS:true}),a=input({KeyA:true}),d=input({KeyD:true});
  assert.deepEqual([w.forward,w.side,w.strength],[1,0,1]);
  assert.deepEqual([s.forward,s.side,s.strength],[-1,0,1]);
  assert.deepEqual([a.forward,a.side,a.strength],[0,-1,1]);
  assert.deepEqual([d.forward,d.side,d.strength],[0,1,1]);
  const diagonal=input({KeyW:true,KeyD:true});
  near(diagonal.forward,Math.SQRT1_2);
  near(diagonal.side,Math.SQRT1_2);
  near(diagonal.strength,1);
  near(diagonal.angle,Math.PI/4);
  assert.equal(locomotionMode(diagonal),'forward');
  assert.equal(locomotionMode(input({KeyS:true,KeyD:true})),'backward');
  assert.equal(locomotionMode(s),'backward');
  assert.equal(locomotionMode(a),'strafe');
});

test('analog stick preserves movement magnitude, resolves diagonal and deadzone',()=>{
  assert.equal(input({}, {joyX:MOVE_DEADZONE/2}).strength,0);
  const half=input({}, {joyX:.5});
  near(half.side,1);
  near(half.strength,(.5-MOVE_DEADZONE)/(1-MOVE_DEADZONE));
  const diagonal=input({}, {joyX:.3,joyY:-.4});
  near(diagonal.strength,(.5-MOVE_DEADZONE)/(1-MOVE_DEADZONE));
  near(diagonal.forward,.8);
  near(diagonal.side,.6);
  near(diagonal.angle,Math.atan2(.6,.8));
  const full=input({}, {joyX:1,joyY:-1});
  near(full.strength,1);
  near(Math.hypot(full.forward,full.side),1);
  const disabled=input({KeyW:true},{joyX:1,disabled:true});
  assert.deepEqual([disabled.forward,disabled.side,disabled.strength],[0,0,0]);
});

test('keyboard and joystick combine, opposite directions cancel',()=>{
  assert.equal(input({KeyW:true},{joyY:1}).strength,0);
  assert.equal(input({KeyD:true},{joyX:-1}).strength,0);
  assert.deepEqual(
    [input({ArrowUp:true,ArrowRight:true}).forward>0,
      input({ArrowUp:true,ArrowRight:true}).side>0],[true,true]);
  near(input({KeyW:true},{joyY:-.5}).strength,1);
});

test('gait thresholds and hysteresis keep stable strafe switching',()=>{
  const at=degrees=>movementInput({joyX:Math.sin(degrees*Math.PI/180),joyY:-Math.cos(degrees*Math.PI/180)});
  near(at(55).strafeWeight,0,1e-8);
  near(at(70).strafeWeight,1,1e-8);
  near(STRAFE_BLEND_START,55*Math.PI/180);
  near(STRAFE_BLEND_END,70*Math.PI/180);
  assert.equal(locomotionMode(at(54),'strafe'),'forward');
  assert.equal(locomotionMode(at(60),'forward'),'forward');
  assert.equal(locomotionMode(at(60),'strafe'),'strafe');
  assert.equal(locomotionMode(at(71),'forward'),'strafe');
  assert.equal(locomotionMode(at(54),'strafe'),'forward');
  assert.equal(locomotionMode(at(60)),'forward');
  assert.equal(locomotionMode(at(65)),'strafe');
  const reverse=movementInput({joyX:Math.sin(65*Math.PI/180),joyY:Math.cos(65*Math.PI/180)});
  assert.equal(locomotionMode(reverse,'forward'),'backward');
  assert.equal(locomotionMode(reverse,'strafe'),'strafe');
});

test('target legs yaw accounts for diagonals and keeps backwards facing front',()=>{
  const degrees=x=>x*Math.PI/180;
  const w=input({KeyW:true}),wd=input({KeyW:true,KeyD:true}),
    sd=input({KeyS:true,KeyD:true}),s=input({KeyS:true}),d=input({KeyD:true});
  near(targetLegsYaw(1,w),1);
  near(targetLegsYaw(0,wd),degrees(-45));
  near(targetLegsYaw(0,sd),degrees(45));
  near(targetLegsYaw(0,s),0);
  near(targetLegsYaw(0,d),0);
  // In ORI-02 these are targets only. ORI-03 will apply them to the rig.
});

test('world-space direction is continuous, independent of gait choice',()=>{
  const wd=input({KeyW:true,KeyD:true});
  const v=worldMoveDirection(0,wd);
  near(v.x,Math.SQRT1_2);near(v.z,-Math.SQRT1_2);
  const turned=worldMoveDirection(Math.PI/2,input({KeyW:true}));
  near(turned.x,-1);near(turned.z,0);
  const sd=worldMoveDirection(0,input({KeyS:true,KeyD:true}));
  near(sd.x,Math.SQRT1_2);near(sd.z,Math.SQRT1_2);
  near(Math.hypot(sd.x,sd.z),1);
});

test('diagonal leg facing and authored backward gait match the world movement direction',()=>{
 const camera=0;
 for(const keys of [
  {KeyW:true,KeyD:true}, {KeyW:true,KeyA:true},
  {KeyS:true,KeyD:true}, {KeyS:true,KeyA:true},
 ]){
  const intent=input(keys);
  const yaw=targetLegsYaw(camera,intent);
  const movement=worldMoveDirection(camera,intent);
  // Forward gait advances along character front; backward gait reverses it.
  const gaitSign=intent.forward<0?-1:1;
  near(-Math.sin(yaw)*gaitSign,movement.x);
  near(-Math.cos(yaw)*gaitSign,movement.z);
 }
 // Pure strafing retains camera-facing hips and uses the side-step clips.
 const strafe=input({KeyD:true});
 const yaw=targetLegsYaw(camera,strafe);
 near(yaw,camera);
 near(worldMoveDirection(yaw,strafe).x,1);
});

test('walking sideways remains strafe, sprinting sideways becomes Run with 90-degree leg rotation',()=>{
 for(const [key,sign] of [['KeyA',-1],['KeyD',1]]){
  const intent=input({[key]:true});
  assert.equal(locomotionMode(intent,'idle',false),'strafe');
  near(targetLegsYaw(0,intent,{mode:'strafe',sprinting:false}),0);
  const sprintMode=locomotionMode(intent,'strafe',true);
  assert.equal(sprintMode,'forward');
  const yaw=targetLegsYaw(0,intent,{mode:sprintMode,sprinting:true});
  near(yaw,-sign*Math.PI/2);
  const move=worldMoveDirection(0,intent);
  near(-Math.sin(yaw),move.x);
  near(-Math.cos(yaw),move.z);
 }
});

test('mobile analog joystick runs in full continuous angles including 90-degree sideways',()=>{
 for(const degrees of [0,20,45,60,75,90]){
  const rad=degrees*Math.PI/180;
  const intent=movementInput({joyX:Math.sin(rad),joyY:-Math.cos(rad)});
  assert.equal(locomotionMode(intent,'forward',true),'forward');
  const yaw=targetLegsYaw(.6,intent,{mode:'forward',sprinting:true});
  near(yaw,.6-rad);
  const move=worldMoveDirection(.6,intent);
  near(-Math.sin(yaw),move.x);
  near(-Math.cos(yaw),move.z);
 }
});

test('sprinting backward diagonals preserve a backwards gait and no 180-degree snap',()=>{
 const intent=input({KeyS:true,KeyD:true});
 assert.equal(locomotionMode(intent,'idle',true),'backward');
 const yaw=targetLegsYaw(0,intent,{mode:'backward',sprinting:true});
 near(yaw,Math.PI/4);
 const move=worldMoveDirection(0,intent);
 near(Math.sin(yaw),move.x);
 near(Math.cos(yaw),move.z);
 const pureSide=input({KeyD:true});
 assert.equal(locomotionMode(pureSide,'backward',true),'backward',
  'releasing S must not force a sudden forward-facing 180-degree turn');
 near(targetLegsYaw(0,pureSide,{mode:'backward',sprinting:true}),Math.PI/2);
 assert.equal(locomotionMode(pureSide,'backward',false),'strafe');
});

test('mobile stick full push starts sprint with hysteresis; low deflection stays walking',()=>{
 near(JOYSTICK_SPRINT_ENTER,.82);
 near(JOYSTICK_SPRINT_EXIT,.70);
 assert.equal(joystickSprintActive(0,0),false);
 assert.equal(joystickSprintActive(.6,0),false);
 assert.equal(joystickSprintActive(0,-.83),true);
 assert.equal(joystickSprintActive(.75,0,true),true);
 assert.equal(joystickSprintActive(.75,0,false),false);
 assert.equal(joystickSprintActive(0,-.69,true),false);
 assert.equal(joystickSprintActive(.6,.6),true);
 const analog=movementInput({joyX:.84,joyY:0});
 assert.equal(locomotionMode(analog,'idle',joystickSprintActive(.84,0)),'forward');
 near(targetLegsYaw(0,analog,{mode:'forward',sprinting:true}),-Math.PI/2);
});

test('sprint smoothly turns real movement from W toward W+A without losing speed',()=>{
 const steering=createMovementSteering();
 const straight=input({KeyW:true});
 const diagonal=input({KeyW:true,KeyA:true});
 const start=steering.update(straight,0,1/60,{sprinting:true});
 near(start.angle,0);
 near(start.strength,1);
 const first=steering.update(diagonal,0,1/60,{sprinting:true});
 const step=RUN_DIRECTION_TURN_RATE/60;
 near(first.angle,-step);
 near(first.strength,1);
 assert.ok(Math.abs(first.angle)<Math.PI/4);
 const startDirection=worldMoveDirection(0,start);
 const turnDirection=worldMoveDirection(0,first);
 assert.ok(turnDirection.x<startDirection.x && turnDirection.x>-.1);
 near(Math.hypot(turnDirection.x,turnDirection.z),1);
 let last=first;
 for(let i=0;i<25;i++)last=steering.update(diagonal,0,1/60,{sprinting:true});
 near(last.angle,-Math.PI/4);
 near(last.strength,1);
 near(worldMoveDirection(0,last).x,-Math.SQRT1_2);
});

test('walking turns more responsively than sprint; both turn rates are configurable',()=>{
 const straight=input({KeyW:true}),side=input({KeyW:true,KeyD:true});
 const walk=createMovementSteering(),run=createMovementSteering();
 walk.update(straight,0,1/60,{sprinting:false});
 run.update(straight,0,1/60,{sprinting:true});
 const w=walk.update(side,0,1/60,{sprinting:false});
 const r=run.update(side,0,1/60,{sprinting:true});
 near(w.angle,WALK_DIRECTION_TURN_RATE/60);
 near(r.angle,RUN_DIRECTION_TURN_RATE/60);
 assert.ok(w.angle>r.angle,'walking must react faster than sprint');
});

test('world-space turn inertia works with analog input and camera rotation',()=>{
 const steering=createMovementSteering();
 const forward=movementInput({joyY:-1});
 const right=movementInput({joyX:1});
 steering.update(forward,0,1/60,{sprinting:true});
 const turn=steering.update(right,0,1/60,{sprinting:true});
 near(turn.angle,RUN_DIRECTION_TURN_RATE/60);
 const rotated=steering.update(right,Math.PI/2,1/60,{sprinting:true});
 const worldAngle=rotated.angle-Math.PI/2;
 near(Math.atan2(Math.sin(worldAngle),Math.cos(worldAngle)),
   -RUN_DIRECTION_TURN_RATE/60+RUN_DIRECTION_TURN_RATE/60);
 // After rotating the camera, the world-space heading may advance by
 // only one more turn-rate step, never jump with the full camera rotation.
 const before=worldMoveDirection(0,turn);
 const after=worldMoveDirection(Math.PI/2,rotated);
 const beforeYaw=Math.atan2(-before.x,-before.z);
 const afterYaw=Math.atan2(-after.x,-after.z);
 near(Math.atan2(Math.sin(afterYaw-beforeYaw),Math.cos(afterYaw-beforeYaw)),
   RUN_DIRECTION_TURN_RATE/60);
});

test('input release, respawn and debug mode reset turn inertia',()=>{
 const steering=createMovementSteering();
 const straight=input({KeyW:true}),diagonal=input({KeyW:true,KeyD:true});
 steering.update(straight,0,.01,{sprinting:true});
 steering.update(diagonal,0,.01,{sprinting:true});
 assert.ok(steering.heading!==null);
 steering.update(input({}),0,.01,{sprinting:true});
 assert.equal(steering.heading,null);
 near(steering.update(diagonal,0,.01,{sprinting:true}).angle,Math.PI/4);
 steering.update(straight,0,.01,{sprinting:true,disabled:true});
 assert.equal(steering.heading,null);
 near(steering.update(straight,.5,.01,{sprinting:true}).angle,0);
 steering.reset();
 assert.equal(steering.heading,null);
});

test('opposite W to S input immediately reverses without a sideways 180-degree arc',()=>{
 const steering=createMovementSteering();
 const forward=input({KeyW:true}),back=input({KeyS:true});
 steering.update(forward,0,1/60,{sprinting:true});
 const reversed=steering.update(back,0,1/60,{sprinting:true});
 near(Math.abs(reversed.angle),Math.PI);
 near(reversed.forward,-1);
 near(reversed.side,0);
 assert.equal(locomotionMode(reversed,'forward',true),'backward');
});

test('direction smoothing has bounded error at different render frame rates',()=>{
 const w=input({KeyW:true}),wd=input({KeyW:true,KeyD:true});
 const samples=[];
 for(const fps of [30,60,120,144]){
  const steer=createMovementSteering();
  steer.update(w,0,0,{sprinting:true});
  let t=0;
  while(t<.2-1e-9){
   const dt=Math.min(1/fps,.2-t);
   t+=dt;
   steer.update(wd,0,dt,{sprinting:true});
  }
  const state=steer.update(wd,0,0,{sprinting:true});
  samples.push(state.angle);
 }
 for(const angle of samples)near(angle,RUN_DIRECTION_TURN_RATE*.2,1e-8);
});
