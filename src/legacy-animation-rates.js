// Preserve the classic lumberjack's original 24 FPS action playback speeds.
// These authored rates predate the new humanoid's meter-per-cycle normalization.
// Never reuse the humanoid root-motion speed formula for this character.
export function classicLocalRate(motion,sprint=false,forward=1){
 if(motion==='Idle')return 1;
 if(motion==='StrafeLeft'||motion==='StrafeRight')return sprint?5:4;
 if(motion==='Run')return forward<0?-2.35:2.35;
 return forward<0?-2.25:2.25;
}

// Remote classic lumberjacks historically use a constant positive playback
// rate, based on the observed replicated motion (not remote input direction).
export function classicRemoteRate(motion){
 if(motion==='Run')return 2.35;
 if(motion==='Walk')return 2.25;
 if(motion==='StrafeLeft'||motion==='StrafeRight')return 4;
 return 1;
}
