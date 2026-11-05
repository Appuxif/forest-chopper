// Compact ORI-07 pose replication piggybacks on existing ~10Hz move frames.
// The legacy yaw field remains the legs-facing angle, so peers that don't
// support ORI-07 still render movement. No bones or new network tick.
import {shortestYawDelta} from './character-orientation.js';

export const NETWORK_MOTIONS=Object.freeze([
 'Idle','Walk','WalkBackward','Run','RunBackward','StrafeLeft','StrafeRight','Jump',
]);
const MOTIONS=new Set(NETWORK_MOTIONS);
const PI=Math.PI;
const MAX_HEAD_YAW=100*PI/180;
const finite=(x,fallback=0)=>typeof x==='number'&&Number.isFinite(x)?x:fallback;
const bounded=(x,limit,fallback=0)=>Math.max(-limit,Math.min(limit,finite(x,fallback)));
const wrap=x=>Math.atan2(Math.sin(x),Math.cos(x));
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));

export function outgoingPose(orientation,motion){
 const yaw=wrap(finite(orientation.legsYaw));
 const torsoYaw=wrap(finite(orientation.torsoYaw,yaw));
 return {
  yaw,torsoYaw,
  torsoPitch:bounded(orientation.torsoPitch,PI/2),
  headYaw:bounded(orientation.headYaw,MAX_HEAD_YAW),
  headPitch:bounded(orientation.headPitch,PI/2),
  motion:MOTIONS.has(motion)?motion:'Idle',
 };
}

export function incomingPose(data){
 const yaw=wrap(finite(data?.yaw));
 // No ORI-07 fields in old peer/bot packets: head and chest follow legs.
 const torsoYaw=wrap(finite(data?.torsoYaw,yaw));
 return {
  legsYaw:yaw,
  torsoYaw,
  torsoPitch:bounded(data?.torsoPitch,PI/2),
  headYaw:bounded(data?.headYaw,MAX_HEAD_YAW),
  headPitch:bounded(data?.headPitch,PI/2),
  motion:MOTIONS.has(data?.motion)?data.motion:null,
 };
}

export function blendRemotePose(current,target,dt,turnSpeed=10){
 const factor=clamp(Math.max(0,dt)*turnSpeed,0,1);
 const yaw=(a,b)=>wrap(a+shortestYawDelta(a,b)*factor);
 return {
  legsYaw:yaw(current.legsYaw,target.legsYaw),
  torsoYaw:yaw(current.torsoYaw,target.torsoYaw),
  torsoPitch:current.torsoPitch+(target.torsoPitch-current.torsoPitch)*factor,
  headYaw:current.headYaw+(target.headYaw-current.headYaw)*factor,
  headPitch:current.headPitch+(target.headPitch-current.headPitch)*factor,
  motion:target.motion,
 };
}
