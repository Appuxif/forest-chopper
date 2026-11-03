// Point-light cube shadows cost up to six scene renders per source.
// The budget limits live cubemap refreshes only, not the number of lights
// allowed to sample previously rendered shadow maps.
export const FIRE_SHADOW_LIMIT=2;
export const MAX_FIRE_SHADOW_SOURCES=4;
export const STARTER_FIRE_ID='starter';
export function selectFireShadowSources(candidates,limit=FIRE_SHADOW_LIMIT,maxRange=30){
 const count=Number.isInteger(limit)?Math.max(0,Math.min(MAX_FIRE_SHADOW_SOURCES,limit)):FIRE_SHADOW_LIMIT;
 return new Set(candidates
   .filter(source=>source.lit!==false&&source.visible!==false&&
     Number.isFinite(source.distance)&&source.distance>=0&&
     source.distance<=Math.min(maxRange,source.radius+2))
   .sort((a,b)=>a.distance-b.distance||String(a.id).localeCompare(String(b.id)))
   .slice(0,count)
   .map(source=>source.id));
}
// Fire shadows are available throughout the day/night cycle. Only selected
// nearby lights refresh each frame; the other sources reuse cached cubemaps.
export function fireShadowPolicy({settings={},selected=true,visible=true,distance=0,radius=30,maxRange=30}={}){
 const visibleShadows=settings?.fireShadows!==false &&
   settings?.performancePreset!=='low' && visible &&
   distance<=Math.min(maxRange,radius+2);
 return {castShadow:visibleShadows,autoUpdate:visibleShadows&&selected};
}
export function applyFireShadowPolicy(light,policy){
 if(!light)return;
 if(light.castShadow!==policy.castShadow){
  light.castShadow=policy.castShadow;
  if(light.shadow)light.shadow.needsUpdate=policy.castShadow;
 }
 if(light.shadow){
  // With autoUpdate the renderer refreshes the point-light depth cubemap
  // on *every rendered frame*. Off means no costly shadow passes at all.
  light.shadow.autoUpdate=policy.autoUpdate;
  if(!policy.castShadow)light.shadow.needsUpdate=false;
 }
}
