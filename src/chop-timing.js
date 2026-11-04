// Classic lumberjack: 24 FPS, Blender frame 1 exported at GLB time 0.
// The existing contact point is frame 18 -> 17/24 seconds.
export const CHOP_CONTACT_FRAME=18;
export const CHOP_SOURCE_FPS=24;
export const CHOP_CONTACT_CLIP_TIME=(CHOP_CONTACT_FRAME-1)/CHOP_SOURCE_FPS;

// Modular male/female: 30 FPS, with frame 1 exported at GLB time 1/30.
// The 25th frame of both game/body_*.glb Chop clips is at 25/30 seconds.
export const HUMANOID_CHOP_CONTACT_FRAME=25;
export const HUMANOID_CHOP_SOURCE_FPS=30;
export const HUMANOID_CHOP_CONTACT_CLIP_TIME=HUMANOID_CHOP_CONTACT_FRAME/HUMANOID_CHOP_SOURCE_FPS;

export function chopContactClipTime(model='legacy'){
 return model==='male'||model==='female'?
   HUMANOID_CHOP_CONTACT_CLIP_TIME:CHOP_CONTACT_CLIP_TIME;
}

export function chopContactReached(action,startedAt,now,playbackSpeed,model='legacy'){
 const contactTime=chopContactClipTime(model);
 // AnimationAction.time is sampled after mixer.update(dt), so target lookup,
 // tree damage, chips and sound follow the actual pose, even on a dropped frame.
 if(Number.isFinite(action?.time))return action.time+1e-5>=contactTime;
 // A missing/unloadable GLB must not make the game unplayable.
 return Number.isFinite(now)&&Number.isFinite(startedAt)&&
   (now-startedAt)*Math.max(.01,playbackSpeed)>=contactTime*1000;
}
