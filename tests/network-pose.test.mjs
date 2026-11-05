import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {outgoingPose,incomingPose,blendRemotePose,NETWORK_MOTIONS} from '../src/network-pose.js';
const deg=x=>x*Math.PI/180;
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,a+' ≠ '+b);

test('ORI-07: pose rides the existing move packet with no bone transforms',()=>{
 const packet=outgoingPose({
  legsYaw:deg(30),torsoYaw:deg(65),torsoPitch:deg(-10),
  headYaw:deg(8),headPitch:deg(-15),
 },'RunBackward');
 assert.deepEqual(Object.keys(packet),
  ['yaw','torsoYaw','torsoPitch','headYaw','headPitch','motion']);
 assert.equal(packet.motion,'RunBackward');
 const read=incomingPose(packet);
 close(read.legsYaw,deg(30));
 close(read.torsoYaw,deg(65));
 close(read.torsoPitch,deg(-10));
 close(read.headYaw,deg(8));
 close(read.headPitch,deg(-15));
});

test('ORI-07: old peers, bots and legacy save format map yaw to torso and legs',()=>{
 const pose=incomingPose({yaw:deg(-120)});
 close(pose.legsYaw,deg(-120));
 close(pose.torsoYaw,pose.legsYaw);
 assert.equal(pose.torsoPitch,0);
 assert.equal(pose.headYaw,0);
 assert.equal(pose.headPitch,0);
 assert.equal(pose.motion,null);
});

test('ORI-07: shortest arc interpolation across ±π never spins backward',()=>{
 const a=incomingPose({yaw:deg(179),torsoYaw:deg(170),torsoPitch:0,headYaw:0,headPitch:0});
 const b=incomingPose({yaw:deg(-179),torsoYaw:deg(-170),torsoPitch:deg(-30),headYaw:deg(30),headPitch:0});
 const m=blendRemotePose(a,b,.05);
 close(Math.abs(m.legsYaw),Math.PI);
 close(Math.abs(m.torsoYaw),Math.PI);
 close(m.torsoPitch,deg(-15));
 close(m.headYaw,deg(15));
 const end=blendRemotePose(m,b,1);
 close(end.legsYaw,b.legsYaw);
 close(end.torsoYaw,b.torsoYaw);
});

test('ORI-07: malformed older network pose remains finite, invalid motion ignored',()=>{
 const pose=incomingPose({yaw:NaN,torsoYaw:Infinity,headYaw:1000,motion:'__proto__'});
 assert.ok(Object.values(pose).filter(v=>typeof v==='number').every(Number.isFinite));
 assert.equal(pose.motion,null);
 const outgoing=outgoingPose({legsYaw:Infinity,torsoYaw:NaN,headYaw:Infinity},'Attack');
 assert.equal(outgoing.motion,'Idle');
 assert.deepEqual([...NETWORK_MOTIONS].filter(x=>x==='Chop2'),[]);
});

test('ORI-07: source messages remain at 10Hz and remote bones receive additive look after mixer',()=>{
 const player=readFileSync(new URL('../src/player.js',import.meta.url),'utf8');
 const multiplayer=readFileSync(new URL('../src/multiplayer.js',import.meta.url),'utf8');
 assert.match(player,/now-ctx\.lastMoveSent>100/);
 assert.match(player,/outgoingPose\(ctx\.characterOrientation,motion\)/);
 assert.match(player,/blendRemotePose\(avatar\.pose\?\?avatar\.poseTarget,avatar\.poseTarget,dt\)/);
 assert.match(player,/avatar\.actor\.proceduralLook\?\.apply\(avatar\.pose\)/);
 assert.match(multiplayer,/poseTarget:incomingPose\(p\)/);
 assert.match(multiplayer,/a\.poseTarget=incomingPose\(d\)/);
 assert.match(multiplayer,/playRemoteChop\(d\.by\)/);
 assert.doesNotMatch(multiplayer,/for\(const a of ctx\.avatars\.values\(\)\)\{if\(Math\.hypot\(a\.group\.position/);
});



test('ORI-07: head yaw supports maximum configurable 100 degrees',()=>{
 const headYaw=deg(100);
 const pose=outgoingPose({
  legsYaw:0,torsoYaw:0,torsoPitch:0,headYaw,headPitch:0,
 },'Idle');
 close(pose.headYaw,headYaw);
 close(incomingPose(pose).headYaw,headYaw);
 assert.ok(incomingPose({yaw:0,headYaw:deg(140)}).headYaw<=headYaw);
});
