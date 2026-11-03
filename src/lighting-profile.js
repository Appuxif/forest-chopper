// Shared visual-only time profile. 16 game hours, deep night at 6..10.
// Smooth ramps 4..6 (dusk) and 10..12 (dawn), never abrupt LOD jumps.
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
export function nightBlend(phase){
 const hour=(((phase%1)+1)%1)*16;
 if(hour<4||hour>=12)return 0;
 if(hour<6)return smooth((hour-4)/2);
 if(hour<=10)return 1;
 return 1-smooth((hour-10)/2);
}
export function blendLighting(day,night,blend){return day+(night-day)*clamp(blend);}
export function fireLighting(settings,kind,blend){
 const prefix=kind==='torch'?'torch':'campfire';
 const dayIntensity=settings[prefix+'DayIntensity']??(prefix==='torch'?1.1:1.3);
 const nightIntensity=settings[prefix+'NightIntensity']??30;
 const dayRadius=settings[prefix+'DayRadius']??(prefix==='torch'?6:7);
 const nightRadius=settings[prefix+'NightRadius']??30;
 return {
  intensity:blendLighting(dayIntensity,nightIntensity,blend),
  radius:blendLighting(dayRadius,nightRadius,blend),
  shadowVisibilityDistance:settings[prefix+'ShadowVisibilityDistance']??30,
  visibilityDistance:settings[prefix+'VisibilityDistance']??100,
  activationDistance:settings[prefix+'ActivationDistance']
    ??settings[prefix+'VisibilityDistance']??100,
  decay:settings[prefix+'Decay']??2,
  height:settings[prefix+'LightHeight']??(prefix==='torch'?2.23:1.5),
 };
}
