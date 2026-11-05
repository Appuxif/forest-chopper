import test from 'node:test';
import assert from 'node:assert/strict';
import {
 targetYaw,inAttackSector,
} from '../src/attack-sector.js';
import {
 createCharacterOrientation,shortestYawDelta,
} from '../src/character-orientation.js';
import {
 weaponProfile,activeWeaponAttack,
} from '../src/weapon-profiles.js';

const deg=n=>n*Math.PI/180;
const close=(a,b,eps=1e-9)=>
 assert.ok(Math.abs(a-b)<=eps,'Expected '+a+' ≈ '+b);
const point=(angle,r=1.5)=>
 ({x:-Math.sin(deg(angle))*r,z:-Math.cos(deg(angle))*r});
const origin={x:0,z:0};

test('target yaw uses game forward (-Z), handles wrap and degenerate coordinates',()=>{
 close(targetYaw(0,0,0,-1),0);
 close(targetYaw(0,0,-1,0),Math.PI/2);
 close(targetYaw(0,0,1,0),-Math.PI/2);
 close(Math.abs(targetYaw(0,0,0,1)),Math.PI);
 assert.equal(targetYaw(0,0,0,0),null);
 assert.equal(targetYaw(0,0,Infinity,1),null);
});

test('weapon cones reject trees behind hips, even if the chest or camera faces backward',()=>{
 const profile=weaponProfile('axe'),pose={legsYaw:0,torsoYaw:0};
 assert.ok(inAttackSector(profile,pose,origin,point(0)));
 assert.ok(inAttackSector(profile,pose,origin,point(45)));
 assert.ok(!inAttackSector(profile,pose,origin,point(70)),
  'unturned torso cannot reach outside its 60-degree weapon arc');
 assert.ok(!inAttackSector(profile,pose,origin,point(180)));
 assert.ok(!inAttackSector(profile,pose,origin,point(90)),
  'a target exactly at the side is not in front of the hips');
 pose.torsoYaw=deg(45);
 assert.ok(inAttackSector(profile,pose,origin,point(70)),
  'body turning can bring an otherwise unreachable target into the cone');
 assert.ok(!inAttackSector(profile,pose,origin,point(105)),
  'a twisted chest cannot attack behind the feet');
 pose.torsoYaw=deg(180);
 assert.ok(!inAttackSector(profile,pose,origin,point(180)),
  'facing the camera cannot override the forward-hemisphere safety rule');
});

test('regular and crescent axes share the same usable sector and 2m reach',()=>{
 const regular=weaponProfile('axe'),crescent=weaponProfile('axe_crescent');
 assert.equal(regular.sectorHalfAngleDeg,crescent.sectorHalfAngleDeg);
 assert.equal(regular.turnRateRadPerSecond,crescent.turnRateRadPerSecond);
 assert.equal(regular.range,crescent.range);
 assert.equal(regular.range,2);
 const facing={legsYaw:0,torsoYaw:deg(-30)};
 for(const target of [point(0),point(-70),point(170)]){
  assert.equal(inAttackSector(regular,facing,origin,target),
   inAttackSector(crescent,facing,origin,target));
 }
});

test('sector checks use horizontal coordinates so near-ground targets remain hittable',()=>{
 const profile=weaponProfile('axe'),pose={legsYaw:0,torsoYaw:deg(-20)};
 assert.ok(inAttackSector(profile,pose,origin,{x:0,y:-3,z:-1.5}));
 assert.ok(inAttackSector(profile,pose,origin,{x:0,y:9,z:-1.5}));
 assert.ok(!inAttackSector(profile,pose,origin,{x:0,y:-3,z:1.5}));
});

test('cone handles ±180 wrapping, changes of player origin and invalid values',()=>{
 const profile=weaponProfile('axe');
 const pose={legsYaw:deg(179),torsoYaw:deg(-179)};
 assert.ok(inAttackSector(profile,pose,origin,point(-179)));
 assert.ok(!inAttackSector(profile,pose,origin,point(-10)));
 assert.ok(inAttackSector(profile,{legsYaw:0,torsoYaw:0},
  {x:10,z:10},{x:10,z:9}));
 assert.equal(inAttackSector(profile,pose,origin,origin),false);
 assert.equal(inAttackSector(profile,{legsYaw:NaN,torsoYaw:0},origin,point(0)),false);
 assert.equal(inAttackSector(profile,pose,origin,{x:Infinity,z:0}),false);
});

test('body turns toward camera smoothly during an axe swing at weapon profile rate',()=>{
 const profile=weaponProfile('axe');
 const pose=createCharacterOrientation({cameraYaw:deg(90)});
 pose.legsYaw=0;pose.torsoYaw=0;
 pose.steerUpper(.10,{attack:profile});
 close(pose.torsoYaw,profile.turnRateRadPerSecond*.10);
 assert.ok(pose.torsoYaw<deg(60),'must not jump to the aim target in one frame');
 for(let i=0;i<20;i++)pose.steerUpper(.1,{attack:profile});
 close(pose.torsoYaw,deg(60));
 close(shortestYawDelta(pose.torsoYaw,pose.cameraYaw),deg(30));
 assert.ok(inAttackSector(profile,pose,origin,point(80)),
  'after aiming the swinging chest can hit a side-facing target');
 pose.steerUpper(.1,{attack:null});
 assert.ok(pose.torsoYaw<deg(60),'after the swing chest smoothly returns to normal look');
});

test('attack steering respects user torso limits and run-only reduction',()=>{
 const profile=weaponProfile('axe');
 const pose=createCharacterOrientation({cameraYaw:deg(-100),cameraPitch:-.8});
 pose.legsYaw=0;pose.torsoYaw=0;
 const settings={lookTorsoYaw:30,lookRunYawReduction:5};
 pose.steerUpper(.5,{attack:profile,settings,running:true});
 close(pose.torsoYaw,deg(-6));
 assert.ok(pose.torsoPitch<0,'low target still bends torso toward the ground');
 assert.ok(pose.headPitch<0,'neck pitch is not suppressed by attack steering');
 pose.steerUpper(.5,{settings,attack:profile,running:false});
 close(pose.torsoYaw,deg(-30));
});

test('attack controller does not rotate legs and handles ±pi without snapping',()=>{
 const profile=weaponProfile('axe');
 const pose=createCharacterOrientation({cameraYaw:deg(-179)});
 pose.legsYaw=deg(179);pose.torsoYaw=deg(179);
 pose.steerUpper(.005,{attack:profile});
 assert.equal(pose.legsYaw,deg(179));
 const delta=shortestYawDelta(deg(179),pose.torsoYaw);
 assert.ok(delta>0&&delta<=profile.turnRateRadPerSecond*.005+1e-9);
 pose.steerUpper(1,{locked:true,attack:profile});
 close(pose.torsoYaw,pose.cameraYaw);
 close(pose.headYaw,0);
});

test('only an active authored Chop clip applies the swing steering profile',()=>{
 const axe=weaponProfile('axe'),crescent=weaponProfile('axe_crescent');
 const actor={activeAttackProfile:crescent,upperState:'Chop2',chopEnd:900};
 assert.equal(activeWeaponAttack(actor,899),crescent);
 assert.equal(activeWeaponAttack(actor,900),null);
 actor.upperState='Walk';
 assert.equal(activeWeaponAttack(actor,400),null);
 actor.upperState='Chop2';actor.activeAttackProfile=axe;
 assert.equal(activeWeaponAttack(actor,100),axe);
 actor.activeAttackProfile=null;
 assert.equal(activeWeaponAttack(actor,100),null);
});

test('standing at maximum sideways free-look turns the hips during Chop so the tree enters the cone',()=>{
 const profile=weaponProfile('axe');
 const pose=createCharacterOrientation({cameraYaw:deg(120)});
 pose.legsYaw=0;pose.torsoYaw=0;
 // Before attacking, ordinary idle free look has already twisted the
 // spine to its configured ±60° limit. There is no remaining torso twist.
 pose.setMovementIntent({angle:0,strength:0,strafeWeight:0},'idle',pose.legsYaw);
 pose.steerLegs(1,{settings:{lookFreeYaw:120}});
 pose.steerUpper(1);
 close(pose.legsYaw,0);
 close(pose.torsoYaw,deg(60));

 const target=point(120);
 assert.equal(inAttackSector(profile,pose,origin,target),false,
  'a fully sideways target must initially be outside the weapon cone');
 // A 25/30 contact at playback 1.6 is about 0.52 sec after clicking.
 // The hips should pivot just enough to free the torso for further aim.
 const initialLegs=pose.legsYaw;
 const initialChest=pose.torsoYaw;
 for(let i=0;i<32;i++){
  pose.steerLegs(1/60,{attack:profile});
  pose.steerUpper(1/60,{attack:profile});
 }
 assert.ok(pose.legsYaw>deg(45),'hip facing needs visible smooth rotation');
 assert.ok(pose.legsYaw<=deg(60)+1e-8,'hips should not overshoot desired facing');
 assert.ok(pose.torsoYaw>initialChest+deg(30),
  'the torso must noticeably continue rotating, rather than staying capped at 60°');
 assert.ok(inAttackSector(profile,pose,origin,target),
  'sideways tree must be inside the attack sector by the contact frame');
 assert.ok(pose.legsYaw-initialLegs<=profile.turnRateRadPerSecond*32/60+1e-8);
});

test('no attack pivot beyond camera yaw when reaching sideways target across ±pi',()=>{
 const profile=weaponProfile('axe');
 const pose=createCharacterOrientation({cameraYaw:deg(-179)});
 pose.legsYaw=deg(179);pose.torsoYaw=deg(179);
 pose.moveStrength=0;
 pose.steerLegs(.01,{attack:profile});
 assert.ok(Math.abs(shortestYawDelta(deg(179),pose.legsYaw))<deg(3),
  'shortest arc must be taken; no 358° pivot');
});

test('hip pivot remains unnecessary when the camera already fits torso twist',()=>{
 const profile=weaponProfile('axe');
 const pose=createCharacterOrientation({cameraYaw:deg(40)});
 pose.legsYaw=0;pose.torsoYaw=deg(20);
 pose.moveStrength=0;
 pose.steerLegs(.4,{attack:profile});
 close(pose.legsYaw,0);
 pose.steerUpper(.4,{attack:profile});
 close(pose.torsoYaw,deg(40));
 assert.ok(inAttackSector(profile,pose,origin,point(40)));
});

test('hip pivot obeys reduced torso twist when swinging during a sprint',()=>{
 const profile=weaponProfile('axe');
 const pose=createCharacterOrientation({cameraYaw:deg(110)});
 pose.legsYaw=0;pose.torsoYaw=0;
 pose.moveStrength=1;
 pose.legsTargetYaw=deg(-90);
 const settings={lookTorsoYaw:60,lookRunYawReduction:10};
 pose.steerLegs(.1,{settings,attack:profile,running:true});
 close(pose.legsYaw,.1*profile.turnRateRadPerSecond);
 pose.steerUpper(.1,{settings,attack:profile,running:true});
 assert.ok(Math.abs(shortestYawDelta(pose.legsYaw,pose.torsoYaw))<=deg(6)+1e-8);
 pose.steerLegs(.1,{settings,attack:null,running:true});
 assert.ok(pose.legsYaw<.1*profile.turnRateRadPerSecond,
  'when the attack stops, ordinary movement steering resumes');
});

test('attack pivot never snaps around when custom user torso limit is zero',()=>{
 const profile=weaponProfile('axe');
 const pose=createCharacterOrientation({cameraYaw:deg(-130)});
 pose.legsYaw=0;pose.torsoYaw=0;
 pose.steerLegs(1/60,{settings:{lookTorsoYaw:0},attack:profile});
 close(pose.legsYaw,-profile.turnRateRadPerSecond/60);
 pose.steerUpper(1/60,{settings:{lookTorsoYaw:0},attack:profile});
 close(pose.torsoYaw,pose.legsYaw);
});
