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
