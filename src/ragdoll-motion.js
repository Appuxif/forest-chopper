// The game controller uses animation Root Motion, so button state cannot tell
// us how fast the player actually moved. Record world-space displacement.
export const MAX_RAGDOLL_HORIZONTAL_SPEED=12;
export const MAX_RAGDOLL_VERTICAL_SPEED=40;
export const MAX_RAGDOLL_TURN_RATE=4;
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const clamp=(v,max)=>Math.max(-max,Math.min(max,finite(v)));
export function captureRagdollMomentum(ctx,{bed=false}={}){
 if(bed)return {x:0,y:0,z:0,angularY:0};
 const motion=ctx.motionVelocity??{};
 const vx=finite(motion.x),vz=finite(motion.z);
 const scale=Math.min(1,MAX_RAGDOLL_HORIZONTAL_SPEED/Math.max(1e-6,Math.hypot(vx,vz)));
 return {x:vx*scale,y:clamp(ctx.verticalSpeed,MAX_RAGDOLL_VERTICAL_SPEED),
   z:vz*scale,angularY:clamp(motion.angularY,MAX_RAGDOLL_TURN_RATE)};
}
// On a landing the kinematic controller has already clamped feet to the
// collision surface. Starting ragdoll with its *previous* impact speed would
// drive capsules through the floor and make Rapier eject them vertically.
// Midair/manual ragdoll still inherits the full real vertical velocity.
export function ragdollActivationMotion(ctx,{bed=false}={}){
 const velocity=captureRagdollMomentum(ctx,{bed});
 if(ctx.onGround)velocity.y=0;
 return velocity;
}
export function createPlayerMotionTracker(){
 let previous=null,last={x:0,z:0,angularY:0};
 function reset(x,z,yaw){
  previous={x,z,yaw};last={x:0,z:0,angularY:0};
  return {...last};
 }
 function sample(x,z,yaw,dt){
  if(!Number.isFinite(dt)||dt<=0 || !Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(yaw))
   return {...last};
  if(!previous)return reset(x,z,yaw);
  const angle=Math.atan2(Math.sin(yaw-previous.yaw),Math.cos(yaw-previous.yaw));
  const result={x:(x-previous.x)/dt,z:(z-previous.z)/dt,angularY:angle/dt};
  previous={x,z,yaw};last=result;
  return {...result};
 }
 return {sample,reset};
}
export function applyRagdollMomentum(parts,motion){
 // A rotating rigid body has v(point) = v(hips) + omega × (point - hips).
 // Using one linear velocity for every limb would fight the constraints when
 // the player activates ragdoll while turning sharply.
 const origin=parts[0]?.center??{x:0,z:0};
 for(const part of parts){
  const x=(part.center?.x??origin.x)-origin.x;
  const z=(part.center?.z??origin.z)-origin.z;
  part.body.setLinvel({x:motion.x-motion.angularY*z,y:motion.y,
    z:motion.z+motion.angularY*x},true);
  part.body.setAngvel({x:0,y:motion.angularY,z:0},true);
 }
}
