import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 createCharacterOrientation,shortestYawDelta,approachYaw,
 LEG_TURN_RATE_MOVING,LEG_TURN_RATE_IDLE,
} from '../src/character-orientation.js';
import {movementInput,locomotionMode,targetLegsYaw}
  from '../src/locomotion-input.js';

const close=(actual,expected,tol=1e-10)=>
  assert.ok(Math.abs(actual-expected)<=tol,`Expected ${actual} ≈ ${expected}`);

test('orientation model separates camera, legs, torso and head state',()=>{
  const pose=createCharacterOrientation({cameraYaw:1.2,cameraPitch:-.3});
  assert.equal(pose.cameraYaw,1.2);
  assert.equal(pose.legsYaw,1.2);
  assert.equal(pose.torsoYaw,1.2);
  assert.equal(pose.cameraPitch,-.3);
  pose.cameraYaw=-2;
  pose.legsYaw=1;
  pose.torsoYaw=.3;
  pose.torsoPitch=-.25;
  pose.headYaw=.9;
  pose.headPitch=.2;
  assert.equal(pose.cameraYaw,-2);
  assert.equal(pose.legsYaw,1);
  assert.equal(pose.torsoYaw,.3);
  assert.equal(pose.torsoPitch,-.25);
  assert.equal(pose.headYaw,.9);
  assert.equal(pose.headPitch,.2);
});

test('stage-one compatibility mirrors camera yaw and clears procedural offsets',()=>{
  const pose=createCharacterOrientation();
  pose.cameraYaw=2.8;pose.cameraPitch=-.6;
  pose.legsYaw=0;pose.torsoYaw=-1;pose.torsoPitch=.2;
  pose.headYaw=.7;pose.headPitch=.3;
  assert.equal(pose.alignToCamera(),pose);
  assert.equal(pose.legsYaw,2.8);
  assert.equal(pose.torsoYaw,2.8);
  assert.equal(pose.torsoPitch,0);
  assert.equal(pose.headYaw,0);
  assert.equal(pose.headPitch,0);
  assert.equal(pose.cameraPitch,-.6,'camera pitch remains unchanged');
});

test('shortest yaw delta and maximum turn handle wrap-around',()=>{
  const degrees=x=>x*Math.PI/180;
  close(shortestYawDelta(degrees(179),degrees(-179)),degrees(2));
  close(shortestYawDelta(degrees(-179),degrees(179)),degrees(-2));
  close(shortestYawDelta(1.25,1.25),0);
  close(approachYaw(degrees(170),degrees(-170),degrees(5)),degrees(175));
  close(approachYaw(degrees(170),degrees(-170),degrees(30)),degrees(190));
  close(approachYaw(degrees(170),degrees(-170),0),degrees(170));
  assert.throws(()=>approachYaw(0,1,-1),RangeError);
});

test('main uses camera angles for view and legs yaw for mesh while legacy names remain',()=>{
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const player=readFileSync(new URL('../src/player.js',import.meta.url),'utf8');
  assert.match(main,/createCharacterOrientation\(\)/);
  assert.match(main,/get yaw\(\)\{return characterOrientation\.cameraYaw/);
  assert.match(main,/get pitch\(\)\{return characterOrientation\.cameraPitch/);
  assert.match(player,/ctx\.characterOrientation\.steerLegs\(dt,/);
  assert.match(player,/ctx\.ownAvatar\.group\.rotation\.y=ctx\.legsYaw/);
  assert.match(player,/ctx\.camera\.rotation\.set\(ctx\.cameraPitch,ctx\.cameraYaw,0\)/);
  assert.match(player,/yaw:ctx\.legsYaw/);
});

test('ORI-03 steers diagonals within per-frame turn-rate limits',()=>{
 const pose=createCharacterOrientation();
 const right=movementInput({keys:{KeyW:true,KeyD:true}});
 pose.setMovementIntent(right,locomotionMode(right),targetLegsYaw(0,right));
 pose.steerLegs(1/60);
 close(pose.legsYaw,-LEG_TURN_RATE_MOVING/60);
 close(pose.torsoYaw,pose.legsYaw);
 pose.steerLegs(1/2);
 close(pose.legsYaw,-Math.PI/4);
 // Body/legs can be independent from camera; future ORI-04 will compensate
 // spine/head so their apparent forward look follows the crosshair again.
 close(pose.cameraYaw,0);
});

test('backwards running keeps hips forward and angles toward backwards diagonal',()=>{
 const pose=createCharacterOrientation({cameraYaw:.7});
 const backward=movementInput({keys:{KeyS:true}});
 pose.setMovementIntent(backward,locomotionMode(backward),
  targetLegsYaw(pose.cameraYaw,backward));
 pose.steerLegs(1/60);
 close(pose.legsYaw,.7); // no 180-degree turn for S
 const diagonal=movementInput({keys:{KeyS:true,KeyD:true}});
 pose.setMovementIntent(diagonal,locomotionMode(diagonal),
  targetLegsYaw(pose.cameraYaw,diagonal));
 pose.steerLegs(.3);
 close(pose.legsYaw,.7+Math.PI/4);
 const backwardLeft=movementInput({keys:{KeyS:true,KeyA:true}});
 pose.setMovementIntent(backwardLeft,locomotionMode(backwardLeft),
  targetLegsYaw(pose.cameraYaw,backwardLeft));
 pose.steerLegs(.3);
 close(pose.legsYaw,.7-Math.PI/4);
});

test('pure strafe maintains camera-facing hips and settles smoothly after release',()=>{
 const pose=createCharacterOrientation({cameraYaw:0});
 const diagonal=movementInput({keys:{KeyW:true,KeyD:true}});
 pose.setMovementIntent(diagonal,'forward',targetLegsYaw(0,diagonal));
 pose.steerLegs(1);
 close(pose.legsYaw,-Math.PI/4);
 const side=movementInput({keys:{KeyD:true}});
 pose.setMovementIntent(side,'strafe',targetLegsYaw(0,side));
 pose.steerLegs(1/60);
 close(pose.legsYaw,-Math.PI/4+LEG_TURN_RATE_MOVING/60);
 const idle=movementInput({});
 pose.setMovementIntent(idle,'idle',targetLegsYaw(0,idle));
 pose.steerLegs(1);
 close(pose.legsYaw,0);
 pose.cameraYaw=Math.PI/2;
 pose.setMovementIntent(idle,'idle',targetLegsYaw(pose.cameraYaw,idle));
 pose.steerLegs(1/60);
 close(pose.legsYaw,LEG_TURN_RATE_IDLE/60);
});

test('turning across ±180 degrees takes the shorter path and cannot jump frames',()=>{
 const pose=createCharacterOrientation({cameraYaw:179*Math.PI/180});
 pose.legsYaw=179*Math.PI/180;
 pose.legsTargetYaw=-179*Math.PI/180;
 pose.moveStrength=1;
 pose.steerLegs(1/600);
 close(shortestYawDelta(179*Math.PI/180,pose.legsYaw),
  LEG_TURN_RATE_MOVING/600);
 pose.steerLegs(.1);
 close(shortestYawDelta(pose.legsYaw,pose.legsTargetYaw),0);
});

test('ragdoll and legacy models may reset facing without residual procedural yaw',()=>{
 const pose=createCharacterOrientation();
 pose.legsYaw=1;pose.cameraYaw=-2;
 pose.setMovementIntent({angle:.7,strength:1,strafeWeight:0},'forward',3);
 pose.steerLegs(1/60,{locked:true});
 close(pose.legsYaw,-2);
 close(pose.torsoYaw,-2);
 close(pose.headYaw,0);
 pose.steerLegs(.05,{locked:false});
 close(shortestYawDelta(-2,pose.legsYaw),-LEG_TURN_RATE_MOVING*.05);
});

test('ORI-03 takes authored Root Motion travel and reprojects it onto input',()=>{
 const player=readFileSync(new URL('../src/player.js',import.meta.url),'utf8');
 const animations=readFileSync(new URL('../src/animations.js',import.meta.url),'utf8');
 const offline=readFileSync(new URL('../src/offline-save.js',import.meta.url),'utf8');
 const ragdoll=readFileSync(new URL('../src/ragdoll-controls.js',import.meta.url),'utf8');
 assert.match(player,/ctx\.ownAvatar\.rootTravelDistance\?\?/);
 assert.match(player,/dx=moveDirection\.x\*distance/);
 assert.match(player,/dz=moveDirection\.z\*distance/);
 assert.match(animations,/actor\.rootTravelDistance\+=weightedHorizontalRootTravel\(step,weight\)/);
 assert.match(offline,/ctx\.characterOrientation\?\.alignToCamera\?\.\(\)/);
 assert.match(ragdoll,/ctx\.characterOrientation\?\.alignToCamera\?\.\(\)/);
});

test('player implements the sprint-based gait for both keyboard and joystick',()=>{
 const player=readFileSync(new URL('../src/player.js',import.meta.url),'utf8');
 assert.match(player,/joystickRunning=joystickSprintActive\(ctx\.joyX,ctx\.joyY,joystickRunning\)/);
 assert.match(player,/shouldSprint\(ctx\.keys,ctx\.settings\.autoSprint,moving\)\|\|joystickRunning/);
 assert.match(player,/locomotionMode\(moveIntent,lastMoveMode,lateralRun\)/);
 assert.match(player,/targetLegsYaw\(ctx\.cameraYaw,moveIntent,\{mode,sprinting:lateralRun\}\)/);
 assert.match(player,/const movementSteering=createMovementSteering\(\)/);
 assert.match(player,/const moveIntent=movementSteering\.update\(intent,ctx\.cameraYaw,dt,/);
});
