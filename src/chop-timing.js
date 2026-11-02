// Chop2 is authored at 24 FPS. Blender frame 1 is glTF animation time 0,
// therefore the contact pose at Blender frame 18 is 17/24s into the clip.
export const CHOP_CONTACT_FRAME=18;
export const CHOP_SOURCE_FPS=24;
export const CHOP_CONTACT_CLIP_TIME=(CHOP_CONTACT_FRAME-1)/CHOP_SOURCE_FPS;

export function chopContactReached(action,startedAt,now,playbackSpeed){
 // AnimationAction.time is sampled after mixer.update(dt), so collision,
 // chips and audio follow the actual pose even on a dropped render frame.
 if(Number.isFinite(action?.time))return action.time+1e-5>=CHOP_CONTACT_CLIP_TIME;
 // A missing/unloadable GLB must not make the game unplayable.
 return Number.isFinite(now)&&Number.isFinite(startedAt)&&
   (now-startedAt)*Math.max(.01,playbackSpeed)>=CHOP_CONTACT_CLIP_TIME*1000;
}
