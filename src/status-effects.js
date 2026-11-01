// Shared status semantics: wall-clock expiry survives offline saves and refresh.
// A repeat dose refreshes duration (no unbounded stacking).
export const STATUS_DEFINITIONS=Object.freeze({
  stamina_regen:{duration:30,multiplier:2},
});
export function sanitizeEffects(raw,now=Date.now()/1000){
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>Object.keys(STATUS_DEFINITIONS).length)return null;
  const result=[],seen=new Set();
  for(const effect of raw){
    if(!effect||!Object.hasOwn(STATUS_DEFINITIONS,effect.id)||
      seen.has(effect.id)||!Number.isFinite(effect.expires_at)||
      effect.expires_at<0||effect.expires_at>now+STATUS_DEFINITIONS[effect.id].duration+1)return null;
    seen.add(effect.id);
    if(effect.expires_at>now)result.push({id:effect.id,expires_at:effect.expires_at});
  }
  return result;
}
export const applyTimedEffect=(effects,id,now=Date.now()/1000)=>{
  if(!Object.hasOwn(STATUS_DEFINITIONS,id))return false;
  const expires_at=now+STATUS_DEFINITIONS[id].duration;
  const prior=effects.find(e=>e.id===id);
  if(prior)prior.expires_at=expires_at;
  else effects.push({id,expires_at});
  return true;
};
export const staminaRegenMultiplier=(effects,now=Date.now()/1000)=>
  effects.some(e=>e.id==='stamina_regen'&&e.expires_at>now)
    ?STATUS_DEFINITIONS.stamina_regen.multiplier:1;
