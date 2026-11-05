import {DEFAULT_WEAPON_ID,weaponProfile} from './weapon-profiles.js';

// Compatibility exports for callers that still refer to the sole axe.
// The contact point now comes from its weapon profile, not a second table.
const AXE_PROFILE=weaponProfile(DEFAULT_WEAPON_ID);
export const CHOP_CONTACT_FRAME=AXE_PROFILE.contact.frame;
export const CHOP_SOURCE_FPS=AXE_PROFILE.contact.fps;
export const CHOP_CONTACT_CLIP_TIME=CHOP_CONTACT_FRAME/CHOP_SOURCE_FPS;

function resolveProfile(profile){
 if(typeof profile==='string')return weaponProfile(profile)??AXE_PROFILE;
 return profile??AXE_PROFILE;
}

export function chopContactClipTime(profile=AXE_PROFILE){
 const {frame,fps}=resolveProfile(profile).contact;
 return frame/fps;
}

export function chopContactReached(action,startedAt,now,playbackSpeed,profile=AXE_PROFILE){
 const threshold=chopContactClipTime(profile);
 // The actual animation mixer controls frame-accurate contact.
 if(Number.isFinite(action?.time))
  return action.time+1e-5>=threshold;
 // If the action is unavailable, use the historical wall-clock fallback.
 return Number.isFinite(now)&&Number.isFinite(startedAt)&&
   (now-startedAt)*Math.max(.01,playbackSpeed)>=threshold*1000;
}
