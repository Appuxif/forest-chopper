// Animation duration comes from the exported GLB, i.e. (lastFrame - firstFrame) / FPS.
// Convert the animator's traveled distance per cycle into the playback rate
// needed for the game's desired world-space movement speed.
export const MIN_ROOT_TRAVEL=0.025;

export function rootMotionSpeed(info){
 if(!info||!Number.isFinite(info.duration)||info.duration<=0)return 0;
 const travel=info.travel;
 const distance=Math.hypot(travel?.x??0,travel?.z??0);
 return Number.isFinite(distance)&&distance>=MIN_ROOT_TRAVEL?distance/info.duration:0;
}

export function playbackRateForSpeed(info,metersPerSecond){
 const authoredSpeed=rootMotionSpeed(info);
 if(!authoredSpeed||!Number.isFinite(metersPerSecond))return 1;
 return metersPerSecond/authoredSpeed;
}

// Reverse-authored walk has identical poses in reverse order. Preserve the
// stance when switching W <-> S instead of resetting the opposite Action
// to its first frame halfway through a step.
export function mirroredWalkPhaseTime(time,sourceDuration,targetDuration){
 if(!Number.isFinite(time)||!Number.isFinite(sourceDuration)||sourceDuration<=0||
    !Number.isFinite(targetDuration)||targetDuration<=0)return 0;
 const phase=((time/sourceDuration)%1+1)%1;
 return ((1-phase)%1)*targetDuration;
}

// Prefer the genuine backward-walking clip when available. Legacy models
// still play their forward Walk Action backwards, exactly as before.
export function walkingMotion(actor,backward){
 return backward&&actor?.lower?.WalkBackward?'WalkBackward':'Walk';
}

// Sample actual GLB Root displacement, including the segment that crosses a
// looping action's end/start. The walk clips have identical first/last poses
// but accumulate nonzero travel; dropping that seam step causes a hitch.
export function rootMotionSampleDelta(info,from,to,backward=false){
 // Three.Interpolant.evaluate() returns its REUSED resultBuffer, not a copy.
 // Capture the first sample before evaluating the second, otherwise every
 // regular frame appears stationary and only the loop seam moves the actor.
 const first=info.sampler.evaluate(from);
 const x=first[0],y=first[1],z=first[2];
 const end=info.sampler.evaluate(to);
 const seam=!backward&&to<from?1:backward&&to>from?-1:0;
 return [
  end[0]-x+seam*(info.travel.x??0),
  end[1]-y+seam*(info.travel.y??0),
  end[2]-z+seam*(info.travel.z??0),
 ];
}


// Authored strafe Root Motion is now 0.60 m per 0.867 s (previously 0.40 m).
// At 1.2 / 1.8 m/s, both strafe cycles play 20% more slowly than before,
// while each stride reaches farther. Actual displacement stays in sync with
// foot animation because the rate is derived from the clip's Root travel.
export const STRAFE_SPEED=1.2;
export const STRAFE_SPRINT_SPEED=1.8;
export const WALK_SPEED=2.0; // 20% slower walking cycle than the old 2.5 m/s
export function humanoidTargetSpeed(motion,sprint){
 if(motion==='StrafeLeft'||motion==='StrafeRight'){
  return sprint?STRAFE_SPRINT_SPEED:STRAFE_SPEED;
 }
 // IMPORTANT: running is unchanged. Its playback rate is still fixed to
 // 1.2 in player.js, not recomputed from this target.
 return sprint?4.6:WALK_SPEED;
}


// Authored backward Walk and dedicated left/right strafes always run forward
// in clip time. Only legacy-style backward Walk and backward Run reverse time.
export function playbackDirectionForMotion(motion,backward){
 return backward&&(motion==='Walk'||motion==='Run')?-1:1;
}
