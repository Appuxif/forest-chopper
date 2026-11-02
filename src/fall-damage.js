// Falling is tracked relative to the actual landing support, not sea level.
// The peak persists if a kinematic fall switches to a physical ragdoll.
export const FALL_RAGDOLL_HEIGHT=3;
export const FALL_FATAL_HEIGHT=5;
const EPSILON=1e-6;
export function fallDamageForHeight(height){
 if(!Number.isFinite(height)||height+EPSILON<FALL_RAGDOLL_HEIGHT)return 0;
 if(height+EPSILON>=FALL_FATAL_HEIGHT)return 5;
 if(height+EPSILON>=4)return 3;
 return 2;
}
export function createFallTracker(){
 let peak=null,pending=null,physicalContact=false,resolved=false;
 function observe(beforeY,afterY,grounded,impactSpeed=0){
  if(resolved){
   // If the player stands up in midair after an already-damaging fall,
   // suppress its rebound landing too. Unlock only once safely grounded.
   if(grounded)reset();
   return null;
  }
  if(peak===null && !grounded)peak=beforeY;
  if(peak!==null)peak=Math.max(peak,beforeY,afterY);
  if(!grounded)return null;
  const drop=peak===null?0:Math.max(0,peak-afterY);
  peak=null;physicalContact=false;
  const damage=fallDamageForHeight(drop);
  if(!damage)return null;
  resolved=true; // Physics bounce belongs to the *same* landing event.
  pending={height:drop,damage,speed:Math.max(0,-impactSpeed)};
  return pending;
 }
 function observeRagdoll(feetY,support,verticalSpeed){
  if(resolved)return null;
  if(peak===null)peak=feetY;
  peak=Math.max(peak,feetY);
  // A short margin accounts for limb capsules hitting before the pelvis.
  const touching=feetY<=support+.25;
  if(touching&&!physicalContact){
   physicalContact=true;
   const result=observe(peak,support,true,verticalSpeed);
   resolved=true; // Even a harmless first contact ends this ragdoll fall.
   return result;
  }
  if(!touching)physicalContact=false;
  return null;
 }
 function take(){const result=pending;pending=null;return result;}
 function reset(){peak=null;pending=null;physicalContact=false;resolved=false;}
 return {observe,observeRagdoll,take,reset,get peak(){return peak}};
}

// One delivery path for animation, vitals and death. Server is authoritative
// in multiplayer: there, fall_impact arrives only after server validation.
export function applyFallImpact(ctx,impact,{authoritative=false,alreadyRagdoll=false}={}){
 if(!impact||ctx.deathSystem?.active)return false;
 const online=ctx.isOnline?.()===true;
 if(online&&!authoritative)return false;
 if(!online){
  ctx.fallImpactSpeed=impact.speed;
  try{ctx.vitals?.damage?.(impact.damage);}
  finally{ctx.fallImpactSpeed=0;}
  if(ctx.deathSystem?.active)return true;
 }
 ctx.notify?.(`💥 Падение с ${impact.height.toFixed(1)} м · −${impact.damage} ♥`,
   'warning','fall-damage');
 if(!alreadyRagdoll&&!ctx.ragdoll?.active)
  void ctx.ragdollControls?.ragdoll?.({impactSpeed:impact.speed});
 return true;
}
