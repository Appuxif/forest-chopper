import test from 'node:test';
import assert from 'node:assert/strict';
import {
  movementInput,locomotionMode,targetLegsYaw,worldMoveDirection,
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
