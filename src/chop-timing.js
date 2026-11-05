// One 30 FPS contact contract for all three independently authored
// 53-bone models. Blender key 25 exports at 25/30 seconds in the GLB.
export const CHOP_CONTACT_FRAME=25;
export const CHOP_SOURCE_FPS=30;
export const CHOP_CONTACT_CLIP_TIME=CHOP_CONTACT_FRAME/CHOP_SOURCE_FPS;

export function chopContactClipTime(){
 return CHOP_CONTACT_CLIP_TIME;
}

export function chopContactReached(action,startedAt,now,playbackSpeed){
 // Contact is evaluated against the actual animation mixer time. Using a
 // fixed timeout alone would miss delayed frames or incorrectly hit early.
 if(Number.isFinite(action?.time))
  return action.time+1e-5>=CHOP_CONTACT_CLIP_TIME;
 // If the animation asset is unavailable, allow normal gameplay to continue.
 return Number.isFinite(now)&&Number.isFinite(startedAt)&&
   (now-startedAt)*Math.max(.01,playbackSpeed)>=CHOP_CONTACT_CLIP_TIME*1000;
}
