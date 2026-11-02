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
