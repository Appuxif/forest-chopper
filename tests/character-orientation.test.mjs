import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 createCharacterOrientation,shortestYawDelta,approachYaw,
 LEG_TURN_RATE_MOVING,LEG_TURN_RATE_IDLE,IDLE_FREE_LOOK_YAW,
 MAX_TORSO_YAW,MAX_HEAD_YAW,MAX_TORSO_DOWN,MAX_TORSO_UP,
 MAX_HEAD_DOWN,MAX_HEAD_UP,
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
 pose.steerUpper(1/60);
 close(pose.torsoYaw,-LEG_TURN_RATE_MOVING/120); // partial chest correction
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

test('pure strafe maintains camera-facing hips; idle free-look keeps feet planted',()=>{
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
 const settledFacing=pose.legsYaw;
 pose.steerLegs(1);
 close(pose.legsYaw,settledFacing);
 pose.cameraYaw=1.2; // ~105° from planted feet, below the 120° threshold
 pose.setMovementIntent(idle,'idle',targetLegsYaw(pose.cameraYaw,idle));
 pose.steerLegs(1/60);
 close(pose.legsYaw,settledFacing,
  1e-10); // ~105° is still within the 120° free-look zone
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

test('ORI-04 spine and neck share camera yaw while feet retain their direction',()=>{
 const pose=createCharacterOrientation({cameraYaw:0,cameraPitch:0});
 const degrees=v=>v*Math.PI/180;
 pose.legsYaw=-degrees(45);
 pose.steerUpper(1);
 close(shortestYawDelta(pose.legsYaw,pose.torsoYaw),degrees(22.5));
 close(pose.headYaw,degrees(22.5));
 close(shortestYawDelta(pose.legsYaw,pose.torsoYaw)+pose.headYaw,degrees(45));
 close(pose.cameraYaw,0);
 close(pose.legsYaw,-degrees(45));
});

test('ORI-04 low target bends spine, neck completes the downward angle',()=>{
 const pose=createCharacterOrientation({cameraPitch:-Math.PI/3});
 pose.steerUpper(1);
 close(pose.torsoPitch,-Math.PI/3*.62);
 close(pose.headPitch,-Math.PI/3*.38);
 close(pose.torsoPitch+pose.headPitch,pose.cameraPitch);
 assert.ok(pose.torsoPitch<-.5,'chest must bend toward a ground-level target');
 pose.cameraPitch=-Math.PI/2;
 pose.steerUpper(1);
 close(pose.torsoPitch,-MAX_TORSO_DOWN);
 close(pose.headPitch,-MAX_HEAD_DOWN);
});

test('ORI-04 limits upward look and extreme yaw to anatomical sectors',()=>{
 const pose=createCharacterOrientation({cameraPitch:Math.PI/2,cameraYaw:Math.PI});
 pose.legsYaw=0;pose.torsoYaw=0; // camera spins behind planted feet
 pose.steerUpper(1);
 close(pose.torsoPitch,MAX_TORSO_UP);
 close(pose.headPitch,MAX_HEAD_UP);
 close(Math.abs(shortestYawDelta(pose.legsYaw,pose.torsoYaw)),MAX_TORSO_YAW);
 close(Math.abs(pose.headYaw),MAX_HEAD_YAW);
 assert.ok(IDLE_FREE_LOOK_YAW>MAX_HEAD_YAW);
});

test('ORI-04 look follows moving camera with bounded joint speeds',()=>{
 const pose=createCharacterOrientation();
 const step=.016;
 pose.cameraYaw=Math.PI/2;
 pose.cameraPitch=-Math.PI/3;
 pose.steerUpper(step);
 assert.ok(pose.torsoPitch<0&&pose.torsoPitch>=-6*step-1e-9);
 assert.ok(pose.headPitch<0&&pose.headPitch>=-14*step-1e-9);
 assert.ok(Math.abs(pose.headYaw)<=MAX_HEAD_YAW);
 pose.cameraYaw=-Math.PI/2;
 pose.cameraPitch=Math.PI/3;
 pose.steerUpper(step);
 assert.ok(Number.isFinite(pose.torsoYaw));
 assert.ok(Number.isFinite(pose.headYaw));
});

test('ORI-04 idle allows free head look before legs slowly catch up',()=>{
 const pose=createCharacterOrientation();
 const idle=movementInput({});
 pose.cameraYaw=1; // below 65° free-look threshold
 pose.setMovementIntent(idle,'idle',targetLegsYaw(1,idle));
 pose.steerLegs(.25);pose.steerUpper(.25);
 close(pose.legsYaw,0);
 assert.ok(pose.headYaw>0);
 pose.cameraYaw=Math.PI;
 pose.setMovementIntent(idle,'idle',targetLegsYaw(Math.PI,idle));
 pose.steerLegs(.05);
 close(pose.legsYaw,LEG_TURN_RATE_IDLE*.05);
});

test('ORI-04 reset preserves camera pose and clears procedural offsets',()=>{
 const pose=createCharacterOrientation({cameraYaw:.7,cameraPitch:-.8});
 pose.steerUpper(.3);
 assert.ok(pose.torsoPitch<0);
 pose.alignToCamera();
 close(pose.legsYaw,.7);
 close(pose.torsoYaw,.7);
 close(pose.headYaw,0);
 close(pose.headPitch,0);
 close(pose.torsoPitch,0);
 close(pose.cameraPitch,-.8);
});


test('160-degree free look twists chest 80 and head another 80 without moving feet',()=>{
 const pose=createCharacterOrientation();
 const settings={lookTorsoYaw:80,lookHeadYaw:80,lookFreeYaw:160};
 pose.cameraYaw=160*Math.PI/180;
 pose.steerLegs(1,{settings});
 pose.steerUpper(1,{settings});
 close(pose.legsYaw,0);
 close(pose.torsoYaw,80*Math.PI/180);
 close(pose.headYaw,80*Math.PI/180);
 close(shortestYawDelta(pose.legsYaw,pose.torsoYaw)+pose.headYaw,
  pose.cameraYaw);
 pose.cameraYaw=170*Math.PI/180;
 pose.steerLegs(.05,{settings});
 close(pose.legsYaw,LEG_TURN_RATE_IDLE*.05);
});

test('sliders change chest/neck limits and the free-look threshold at runtime',()=>{
 const pose=createCharacterOrientation();
 const settings={lookTorsoYaw:40,lookHeadYaw:35,lookFreeYaw:75};
 pose.cameraYaw=Math.PI/2;
 pose.steerLegs(0,{settings});
 pose.steerUpper(1,{settings});
 close(pose.torsoYaw,40*Math.PI/180);
 close(pose.headYaw,35*Math.PI/180);
 close(pose.legsYaw,0);
 pose.steerLegs(1,{settings});
 assert.ok(pose.legsYaw>0);
 settings.lookTorsoYaw=80;
 settings.lookHeadYaw=80;
 settings.lookFreeYaw=160;
 pose.cameraYaw=0;pose.alignToCamera();pose.cameraYaw=160*Math.PI/180;
 pose.steerLegs(1,{settings});pose.steerUpper(1,{settings});
 close(pose.legsYaw,0);
 close(pose.headYaw,80*Math.PI/180);
});

test('pose sliders independently limit pitch and turning speed',()=>{
 const pose=createCharacterOrientation({cameraYaw:1,cameraPitch:-Math.PI/2});
 pose.legsYaw=0;pose.torsoYaw=0;
 const settings={
  lookTorsoYaw:80,lookHeadYaw:80,
  lookTorsoDown:10,lookTorsoUp:10,lookHeadDown:20,lookHeadUp:15,
  lookTorsoTurnSpeed:1,lookHeadTurnSpeed:2,
 };
 pose.steerUpper(.05,{settings});
 assert.ok(Math.abs(pose.torsoYaw)<=.05+1e-9);
 assert.ok(Math.abs(pose.headYaw)<=.1+1e-9);
 pose.steerUpper(3,{settings});
 close(pose.torsoPitch,-10*Math.PI/180);
 close(pose.headPitch,-20*Math.PI/180);
 settings.lookTorsoDown=80;settings.lookHeadDown=90;
 pose.steerUpper(3,{settings});
 close(pose.torsoPitch,-Math.PI/2*.62);
 close(pose.headPitch,-Math.PI/2*.38);
});


test('running divides both lateral torso/head yaw limits by the selected factor',()=>{
 const deg=Math.PI/180;
 const pose=createCharacterOrientation({cameraYaw:Math.PI});
 pose.legsYaw=0;
 const settings={lookTorsoYaw:60,lookHeadYaw:60,lookRunYawReduction:5};
 pose.steerUpper(1,{settings,running:true});
 close(shortestYawDelta(pose.legsYaw,pose.torsoYaw),12*deg);
 close(pose.headYaw,12*deg);
 // Back to walking or idle: both use full limits again.
 pose.steerUpper(1,{settings,running:false});
 close(shortestYawDelta(pose.legsYaw,pose.torsoYaw),60*deg);
 close(pose.headYaw,60*deg);
 // 1x is exactly the original behavior even while running.
 pose.steerUpper(1,{settings:{...settings,lookRunYawReduction:1},running:true});
 close(shortestYawDelta(pose.legsYaw,pose.torsoYaw),60*deg);
 close(pose.headYaw,60*deg);
});

test('changing to running immediately enforces reduced yaw without affecting pitch',()=>{
 const deg=Math.PI/180;
 const pose=createCharacterOrientation({cameraYaw:Math.PI,cameraPitch:-.6});
 pose.legsYaw=0;
 const settings={lookRunYawReduction:10};
 pose.steerUpper(1,{settings,running:false});
 close(shortestYawDelta(pose.legsYaw,pose.torsoYaw),60*deg);
 close(pose.headYaw,60*deg);
 const chestPitch=pose.torsoPitch,headPitch=pose.headPitch;
 pose.steerUpper(.016,{settings,running:true});
 assert.ok(Math.abs(shortestYawDelta(pose.legsYaw,pose.torsoYaw))<=6*deg+1e-10);
 assert.ok(Math.abs(pose.headYaw)<=6*deg+1e-10);
 close(pose.torsoPitch,chestPitch);
 close(pose.headPitch,headPitch);
});

test('run-only look reduction is wired to both Run and RunBackward in gameplay',()=>{
 const player=readFileSync(new URL('../src/player.js',import.meta.url),'utf8');
 assert.match(player,/const runningMotionNow=motion==='Run'\|\|motion==='RunBackward'/);
 assert.match(player,/running:runningMotionNow/);
 assert.match(player,/const swingAttack=activeWeaponAttack\(ctx\.ownAvatar,now\)/);
 assert.match(player,/ctx\.characterOrientation\.steerLegs\(dt,/);
 assert.match(player,/ctx\.characterOrientation\.steerUpper\(dt,/);
 assert.equal((player.match(/attack:swingAttack/g)??[]).length,2,
  'the same swing profile must steer both hips and torso');
});
