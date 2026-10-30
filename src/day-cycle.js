// Optional local-only atmosphere. No shared multiplayer clock or save changes.
// Colors and light intensities change slowly; terrain and interactable objects stay readable.
export const DAY_CYCLE_MS = 8 * 60 * 1000;
const PHASES = Object.freeze([
  {at:0,    sky:0xa4c8be, ambient:2.1, sun:2.3, sunlight:0xffe4a6},
  {at:.23,  sky:0xc18d80, ambient:1.85,sun:1.5, sunlight:0xffba86},
  {at:.43,  sky:0x38485d, ambient:.945,sun:.455, sunlight:0xb5ceef},
  {at:.57,  sky:0x38485d, ambient:.945,sun:.455, sunlight:0xb5ceef},
  {at:.77,  sky:0xa3acb9, ambient:1.78,sun:1.4, sunlight:0xffcda0},
  {at:1,    sky:0xa4c8be, ambient:2.1, sun:2.3, sunlight:0xffe4a6},
]);

// Pure scalar interpolation helps keep the brightness floor explicit in tests.
export function dayPhaseValues(phase) {
  const f = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  const index = Math.min(PHASES.length-2,
    Math.max(0,PHASES.findIndex((p,i)=>i<PHASES.length-1 && f>=p.at && f<PHASES[i+1].at)));
  const a=PHASES[index], b=PHASES[index+1];
  const t=(f-a.at)/(b.at-a.at);
  const blend=(start,end)=>start+(end-start)*t;
  return {a:index,b:index+1,t,
    ambient:blend(a.ambient,b.ambient),
    sun:blend(a.sun,b.sun),
  };
}

export function createDayCycle(ctx, {
  motionQuery = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)') : {matches:false},
  intervalMs = 300,
} = {}) {
  const {THREE,scene,hemisphere,sun,settings} = ctx;
  const colors=PHASES.map(p=>({
    sky:new THREE.Color(p.sky),sun:new THREE.Color(p.sunlight),
  }));
  const original={
    sky:scene.background.clone(),
    fog:scene.fog?.color.clone() ?? null,
    sunColor:sun.color.clone(),
    ambient:hemisphere.intensity,
    sun:ctx.atmosphere?.sunIntensity ?? sun.intensity,
  };
  let startedAt=null,lastSample=-Infinity,active=false;
  function restore(){
    if(active){
      scene.background.copy(original.sky);
      if(original.fog&&scene.fog)scene.fog.color.copy(original.fog);
      sun.color.copy(original.sunColor);
      hemisphere.intensity=original.ambient;
      if(ctx.atmosphere?.setSunIntensity)ctx.atmosphere.setSunIntensity(original.sun);
      else sun.intensity=original.sun;
    }
    ctx.atmosphere?.restore();
    active=false;
    startedAt=null;
    lastSample=-Infinity;
  }
  function applyPhase(phase){
    const {a,b,t,ambient,sun:sunIntensity}=dayPhaseValues(phase);
    scene.background.copy(colors[a].sky).lerp(colors[b].sky,t);
    if(scene.fog)scene.fog.color.copy(scene.background);
    sun.color.copy(colors[a].sun).lerp(colors[b].sun,t);
    hemisphere.intensity=ambient;
    if(ctx.atmosphere?.setSunIntensity)ctx.atmosphere.setSunIntensity(sunIntensity);
    else sun.intensity=sunIntensity;
    ctx.atmosphere?.setPhase(phase);
    active=true;
  }
  function tick(now){
    if(!settings.dayCycleEnabled || motionQuery?.matches){
      if(active)restore();
      return;
    }
    if(!Number.isFinite(now))return;
    if(startedAt===null)startedAt=now;
    if(now-lastSample<intervalMs)return;
    lastSample=now;
    applyPhase((now-startedAt)/DAY_CYCLE_MS);
  }
  return {tick,restore,applyPhase,get active(){return active;}};
}
