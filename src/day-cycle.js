import {nightBlend,blendLighting} from './lighting-profile.js?v=20261102-deep-night1';
// Optional offline day/night lighting; multiplayer uses an authoritative
// server clock, extrapolated locally between periodic synchronizations.
export const DAY_CYCLE_MS = 16 * 60 * 1000;
export function normalizeDayPhase(phase){
  return Number.isFinite(phase)?((phase%1)+1)%1:0;
}
export function extrapolateDayPhase(phase,elapsedMs,cycleMs=DAY_CYCLE_MS){
  if(!Number.isFinite(elapsedMs)||!Number.isFinite(cycleMs)||cycleMs<=0)
    return normalizeDayPhase(phase);
  return normalizeDayPhase(phase+Math.max(0,elapsedMs)/cycleMs);
}
const PHASES = Object.freeze([
  {at:0,    sky:0xa4c8be, ambient:1.2, sun:2, sunlight:0xffe4a6},
  {at:.23,  sky:0xc18d80, ambient:1.85,sun:1.5, sunlight:0xffba86},
  {at:.375, sky:0x010203, ambient:0,sun:.2, sunlight:0xb5ceef},
  {at:.625, sky:0x010203, ambient:0,sun:.2, sunlight:0xb5ceef},
  {at:.77,  sky:0xa3acb9, ambient:1.78,sun:1.4, sunlight:0xffcda0},
  {at:1,    sky:0xa4c8be, ambient:1.2, sun:2, sunlight:0xffe4a6},
]);

// Night vision changes local lighting only; daylight stays unchanged.
// Preserve the night sky colour and the moon so the effect isn't a fake daytime.
export function nightVisionLighting(ambient,sun,enabled=false,night=0){
  // Night vision must depend on actual time, not on the user's daytime
  // ambient slider (which may legitimately be very dim).
  const weight=Math.max(0,Math.min(1,night));
  return enabled?{ambient:ambient+weight*1.25,sun:sun+weight*.35}:{ambient,sun};
}

// Pure scalar interpolation helps keep the brightness floor explicit in tests.
export function dayPhaseValues(phase) {
  const f = normalizeDayPhase(phase);
  const index = Math.min(PHASES.length-2,
    Math.max(0,PHASES.findIndex((p,i)=>i<PHASES.length-1 && f>=p.at && f<PHASES[i+1].at)));
  const a=PHASES[index], b=PHASES[index+1];
  const t=(f-a.at)/(b.at-a.at);
  const blend=(start,end)=>start+(end-start)*t;
  return {a:index,b:index+1,t,
    ambient:blendLighting(1.2,0,nightBlend(f)),
    sun:blendLighting(2,.2,nightBlend(f)),
  };
}

export function createDayCycle(ctx, {
  motionQuery = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)') : {matches:false},
  intervalMs = 300,
} = {}) {
  const {THREE,scene,hemisphere,sun,settings} = ctx;
  const terrain=ctx.terrain;
  const darkFog=new THREE.Color(0x000000);
  const colors=PHASES.map(p=>({
    sky:new THREE.Color(p.sky),sun:new THREE.Color(p.sunlight),
  }));
  const original={
    sky:scene.background.clone(),
    fog:scene.fog?.color.clone() ?? null,
    sunColor:sun.color.clone(),
    ambient:ctx.atmosphere?.ambientIntensity ?? hemisphere.intensity,
    sun:ctx.atmosphere?.sunIntensity ?? sun.intensity,
  };
  let startedAt=null,lastSample=-Infinity,active=false;
  let offlineBase=0,displayPhase=0;
  let serverPhase=null,serverSampleAt=0;
  let debugOverride=false;
  let frozenPhase=null;
  function restore(){
    if(active){
      scene.background.copy(original.sky);
      if(original.fog&&scene.fog)scene.fog.color.copy(original.fog);
      sun.color.copy(original.sunColor);
      if(ctx.atmosphere?.setAmbientIntensity)ctx.atmosphere.setAmbientIntensity(original.ambient);
      else hemisphere.intensity=original.ambient;
      if(ctx.atmosphere?.setSunIntensity)ctx.atmosphere.setSunIntensity(original.sun);
      else sun.intensity=original.sun;
    }
    ctx.atmosphere?.restore();
    terrain?.setNightBlend?.(0,settings.nightViewDistance??30);
    active=false;
    // Pausing an offline day preserves its current phase if the lighting
    // option is disabled; online clock remains server-controlled.
    if(serverPhase===null)offlineBase=displayPhase;
    startedAt=null;
    lastSample=-Infinity;
  }
  function applyPhase(phase){
    const {a,b,t}=dayPhaseValues(phase);
    const night=nightBlend(phase);
    const ambient=blendLighting(settings.dayAmbient??1.2,settings.nightAmbient??0,night);
    const sunIntensity=blendLighting(settings.daySun??2,settings.nightMoon??.2,night);
    terrain?.setNightBlend?.(night,settings.nightViewDistance??30);
    scene.background.copy(colors[a].sky).lerp(colors[b].sky,t);
    // Fog becomes near-black at midnight without altering the night sky palette.
    if(scene.fog){
      scene.fog.color.copy(scene.background);
      scene.fog.color.lerp(darkFog,night);
    }
    sun.color.copy(colors[a].sun).lerp(colors[b].sun,t);
    const vision=nightVisionLighting(ambient,sunIntensity,ctx.vitals?.hasNightVision===true,night);
    if(ctx.atmosphere?.setAmbientIntensity)ctx.atmosphere.setAmbientIntensity(vision.ambient);
    else hemisphere.intensity=vision.ambient;
    if(ctx.atmosphere?.setSunIntensity)ctx.atmosphere.setSunIntensity(vision.sun);
    else sun.intensity=vision.sun;
    ctx.atmosphere?.setPhase(phase);
    displayPhase=normalizeDayPhase(phase);
    active=true;
  }
  function setOfflinePhase(phase){
    if(!Number.isFinite(phase)||phase<0||phase>=1)return false;
    offlineBase=phase;
    if(frozenPhase!==null)frozenPhase=phase;
    startedAt=null;
    lastSample=-Infinity;
    if(serverPhase===null)displayPhase=phase;
    return true;
  }
  function resetOffline(){setOfflinePhase(0);}
  // Freeze only the local clock. Every consumer of phaseAt() (lighting,
  // audio, sky) sees the same time; on resume, the clock continues here.
  function setFrozen(enabled,now=performance.now()){
    if(enabled){
      if(serverPhase!==null||!Number.isFinite(now))return false;
      if(frozenPhase===null){
        frozenPhase=phaseAt(now);
        offlineBase=frozenPhase;
        startedAt=null;
        displayPhase=frozenPhase;
        lastSample=-Infinity;
      }
      return true;
    }
    if(frozenPhase!==null){
      offlineBase=frozenPhase;
      frozenPhase=null;
      startedAt=Number.isFinite(now)?now:null;
      lastSample=-Infinity;
    }
    return true;
  }
  // Explicit debug-only override: the day-cycle receives a compact render context,
  // not the full game ctx. Do not read debugCheats from that context.
  function setDebugOverride(enabled){
    debugOverride=enabled===true;
    lastSample=-Infinity;
    return debugOverride;
  }
  function syncServerPhase(phase,now=performance.now()){
    if(!Number.isFinite(phase)||phase<0||phase>=1||!Number.isFinite(now))
      return false;
    if(serverPhase!==null){
      const predicted=extrapolateDayPhase(serverPhase,now-serverSampleAt);
      // Small network jitter/drift is corrected gently; a large discrepancy
      // (or switching worlds) accepts the authoritative server immediately.
      const error=((phase-predicted+1.5)%1)-.5;
      if(Math.abs(error)<.02)phase=normalizeDayPhase(predicted+error*.35);
    }
    // Local debug freeze is never allowed to control server time.
    frozenPhase=null;
    serverPhase=phase;
    serverSampleAt=now;
    lastSample=-Infinity;
    return true;
  }
  function leaveServer(){
    if(serverPhase===null)return; // No connection: never reset local clock.
    serverPhase=null;
    startedAt=null;
    lastSample=-Infinity;
    displayPhase=offlineBase;
    if(active)restore();
  }
  function phaseAt(now){
    if(serverPhase!==null)return extrapolateDayPhase(serverPhase,now-serverSampleAt);
    if(frozenPhase!==null)return frozenPhase;
    if(startedAt===null)return offlineBase;
    return extrapolateDayPhase(offlineBase,now-startedAt);
  }
  function tick(now){
    const online=serverPhase!==null;
    if((!online&&!settings.dayCycleEnabled&&!debugOverride)||(motionQuery?.matches&&!debugOverride)){
      if(active)restore();
      if(!online){
        // The cycle may be disabled, but daytime light sliders still work.
        // Keep the sky at noon without running the daylight clock.
        const ambient=settings.dayAmbient??1.2;
        const sunlight=settings.daySun??2;
        if(ctx.atmosphere?.setAmbientIntensity)ctx.atmosphere.setAmbientIntensity(ambient);
        else hemisphere.intensity=ambient;
        if(ctx.atmosphere?.setSunIntensity)ctx.atmosphere.setSunIntensity(sunlight);
        else sun.intensity=sunlight;
        terrain?.setNightBlend?.(0,settings.nightViewDistance??30);
      }
      return;
    }
    if(!Number.isFinite(now))return;
    if(!online&&startedAt===null)startedAt=now;
    if(now-lastSample<intervalMs)return;
    lastSample=now;
    applyPhase(phaseAt(now));
  }
  return {tick,restore,applyPhase,setOfflinePhase,resetOffline,setDebugOverride,setFrozen,
    syncServerPhase,leaveServer,phaseAt,
    get frozen(){return frozenPhase!==null;},
    get offlinePhase(){return serverPhase===null&&active?displayPhase:offlineBase;},
    get online(){return serverPhase!==null;},
    get phase(){return displayPhase;},
    get active(){return active;}};

}
