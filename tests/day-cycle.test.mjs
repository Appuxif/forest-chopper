import test from 'node:test';
import assert from 'node:assert/strict';
import {createDayCycle,dayPhaseValues,DAY_CYCLE_MS,
  normalizeDayPhase,extrapolateDayPhase,nightVisionLighting} from '../src/day-cycle.js';

class Color {
  constructor(hex=0){
    this.r=((hex>>16)&255)/255;
    this.g=((hex>>8)&255)/255;
    this.b=(hex&255)/255;
  }
  clone(){const c=new Color();return c.copy(this)}
  copy(src){this.r=src.r;this.g=src.g;this.b=src.b;return this}
  lerp(other,t){
    this.r+=(other.r-this.r)*t;
    this.g+=(other.g-this.g)*t;
    this.b+=(other.b-this.b)*t;
    return this;
  }
  rgb(){return [this.r,this.g,this.b]}
}

function fixture(vitals=null){
  const scene={background:new Color(0xa4c8be),fog:{color:new Color(0xa4c8be)}};
  const hemisphere={intensity:1.2},sun={intensity:2,color:new Color(0xffe4a6)};
  const settings={dayCycleEnabled:false};
  const motionQuery={matches:false};
  const ctx={THREE:{Color},scene,hemisphere,sun,settings,vitals};
  return {...ctx,motionQuery,cycle:createDayCycle(ctx,{motionQuery})};
}
function snapshot(f){
  return {sky:f.scene.background.rgb(),fog:f.scene.fog.color.rgb(),
    sunColor:f.sun.color.rgb(),sun:f.sun.intensity,ambient:f.hemisphere.intensity};
}

test('phase interpolation is continuous, cyclic and keeps a readable light floor',()=>{
  assert.equal(DAY_CYCLE_MS,960000);
  for(const point of [0,.1,.22,.23,.3,.43,.5,.57,.7,.77,.95,.9999,1,2,-.5,NaN]){
    const v=dayPhaseValues(point);
    assert.ok(v.ambient>=-1e-10 && v.ambient<=1.2);
    assert.ok(v.sun>=.2-1e-10 && v.sun<=2);
    assert.ok(v.t>=0&&v.t<=1);
  }
  assert.deepEqual(dayPhaseValues(0),dayPhaseValues(1));
  assert.deepEqual(dayPhaseValues(.5),dayPhaseValues(1.5));
  assert.ok(Math.abs(dayPhaseValues(.5).sun-.2)<1e-10);
  assert.ok(Math.abs(dayPhaseValues(.5).ambient-0)<1e-10);
  const midpointSky=fixture();
  midpointSky.cycle.applyPhase(.5);
  assert.deepEqual(midpointSky.scene.background.rgb(),new Color(0x010203).rgb());
  assert.deepEqual(midpointSky.scene.fog.color.rgb(),new Color(0x000000).rgb());
  assert.ok(dayPhaseValues(.23).sun>dayPhaseValues(.5).sun);
});

test('opt-in visual cycle throttles color changes and fully restores baseline on disable',()=>{
  const f=fixture();
  const original=snapshot(f);
  f.cycle.tick(0);
  assert.equal(f.cycle.active,false);
  assert.deepEqual(snapshot(f),original,'default settings cannot change lighting');
  f.settings.dayCycleEnabled=true;
  f.cycle.tick(1000);
  assert.equal(f.cycle.active,true);
  assert.deepEqual(snapshot(f),original,'at phase 0 original lighting matches exactly');
  f.cycle.tick(1000+DAY_CYCLE_MS*.5);
  const night=snapshot(f);
  assert.notDeepEqual(night,original);
  assert.ok(Math.abs(night.ambient-0)<1e-10);
  assert.ok(Math.abs(night.sun-.2)<1e-10);
  assert.notDeepEqual(night.sky,night.fog,'night fog is black while sky is near-black');
  f.cycle.tick(1000+DAY_CYCLE_MS*.5+100);
  assert.deepEqual(snapshot(f),night,'throttled call must not change render state');
  f.settings.dayCycleEnabled=false;
  f.cycle.tick(1000+DAY_CYCLE_MS*.5+101);
  assert.deepEqual(snapshot(f),original,'turning option off restores exact color/intensity');
  assert.equal(f.cycle.active,false);
  f.cycle.restore();
  assert.deepEqual(snapshot(f),original,'restore is idempotent');
  f.settings.dayCycleEnabled=true;
  f.cycle.tick(999999);
  assert.deepEqual(snapshot(f),night,'re-enabling resumes the previously saved night phase');
});

test('reduce-motion dynamically disables animation and restores all original resources',()=>{
  const f=fixture();
  const original=snapshot(f);
  const colorObjects=[f.scene.background,f.scene.fog.color,f.sun.color];
  f.settings.dayCycleEnabled=true;
  f.cycle.tick(250);
  f.cycle.tick(250+DAY_CYCLE_MS*.5);
  assert.notDeepEqual(snapshot(f),original);
  f.motionQuery.matches=true;
  f.cycle.tick(250+DAY_CYCLE_MS*.5+1);
  assert.equal(f.cycle.active,false);
  assert.deepEqual(snapshot(f),original);
  f.cycle.tick(250+DAY_CYCLE_MS*.5+DAY_CYCLE_MS);
  assert.deepEqual(snapshot(f),original);
  f.motionQuery.matches=false;
  f.cycle.tick(888888);
  assert.equal(f.cycle.active,true);
  assert.notDeepEqual(snapshot(f),original,'re-enabling resumes the paused phase');
  assert.equal(f.scene.background,colorObjects[0]);
  assert.equal(f.scene.fog.color,colorObjects[1]);
  assert.equal(f.sun.color,colorObjects[2]);
});

test('color palette changes smoothly through dusk and dawn without abrupt jumps',()=>{
  const f=fixture();
  f.settings.dayCycleEnabled=true;
  const snapshots=[];
  for(let phase=0;phase<1;phase+=.005){
    f.cycle.applyPhase(phase);
    snapshots.push(snapshot(f));
  }
  for(let i=1;i<snapshots.length;i++){
    const x=snapshots[i-1],y=snapshots[i];
    const distance=Math.hypot(...x.sky.map((v,j)=>v-y.sky[j]));
    assert.ok(distance<.12,'sky jump at '+i+' = '+distance);
    assert.ok(Math.abs(y.ambient-x.ambient)<.15);
    assert.ok(Math.abs(y.sun-x.sun)<.15);
  }
  f.cycle.restore();
});

test('atmosphere follows phases and resets to noon when day cycle is disabled',()=>{
  const values=[];
  const f=fixture();
  // A stand-in for the optional rendering layer; verifies the cycle drives it.
  const scene=f.scene;
  const ctx={THREE:f.THREE,scene,hemisphere:f.hemisphere,sun:f.sun,
    settings:f.settings,atmosphere:{setPhase(value){values.push(value)},restore(){values.push('reset')}}};
  const cycle=createDayCycle(ctx,{motionQuery:f.motionQuery});
  f.settings.dayCycleEnabled=true;
  cycle.tick(100);
  cycle.tick(100+DAY_CYCLE_MS*.5);
  assert.ok(Math.abs(values.at(-1)-.5)<1e-9);
  f.settings.dayCycleEnabled=false;
  cycle.tick(100+DAY_CYCLE_MS*.5+1);
  assert.equal(values.at(-1),'reset');
});


test('shadow contrast is not applied twice when toggling the day cycle',()=>{
  const f=fixture();
  const contrast=.545; // default 70% contrast reduces ambient contribution
  let originalAmbient=1.2;
  f.hemisphere.intensity=originalAmbient*contrast;
  const atmosphere={
    get ambientIntensity(){return originalAmbient},
    get sunIntensity(){return 2},
    setAmbientIntensity(value){originalAmbient=value;f.hemisphere.intensity=value*contrast},
    setSunIntensity(value){f.sun.intensity=value},
    setPhase(){},restore(){},
  };
  const ctx={THREE:f.THREE,scene:f.scene,hemisphere:f.hemisphere,sun:f.sun,
    settings:f.settings,atmosphere};
  const cycle=createDayCycle(ctx,{motionQuery:f.motionQuery});
  f.settings.dayCycleEnabled=true;
  cycle.tick(100);
  cycle.tick(100+DAY_CYCLE_MS*.5);
  assert.ok(Math.abs(f.hemisphere.intensity-0*contrast)<1e-10);
  f.settings.dayCycleEnabled=false;
  cycle.tick(101+DAY_CYCLE_MS*.5);
  assert.equal(atmosphere.ambientIntensity,1.2);
  assert.ok(Math.abs(f.hemisphere.intensity-1.2*contrast)<1e-10,
    'restoring the cycle must never compound the shadow contrast factor');
});

test('offline phase can be restored from a browser snapshot and keeps advancing',()=>{
  const f=fixture();
  f.settings.dayCycleEnabled=true;
  assert.equal(f.cycle.setOfflinePhase(.75),true);
  f.cycle.tick(100);
  assert.ok(Math.abs(f.cycle.phase-.75)<1e-9);
  f.cycle.tick(100+DAY_CYCLE_MS*.125);
  assert.ok(Math.abs(f.cycle.offlinePhase-.875)<1e-9);
  const saved=f.cycle.offlinePhase;
  const reloaded=fixture();
  reloaded.settings.dayCycleEnabled=true;
  assert.equal(reloaded.cycle.setOfflinePhase(saved),true);
  reloaded.cycle.tick(300);
  assert.ok(Math.abs(reloaded.cycle.phase-saved)<1e-9);
  reloaded.cycle.tick(300+DAY_CYCLE_MS*.25);
  assert.ok(Math.abs(reloaded.cycle.phase-.125)<1e-9);
  assert.equal(reloaded.cycle.setOfflinePhase(-1),false);
  assert.equal(reloaded.cycle.setOfflinePhase(Infinity),false);
  reloaded.cycle.resetOffline();
  reloaded.cycle.tick(500000);
  assert.equal(reloaded.cycle.phase,0);
});

test('online clock extrapolates between server packets and corrects wrapped phase',()=>{
  const f=fixture();
  assert.equal(extrapolateDayPhase(.95,DAY_CYCLE_MS*.1),.050000000000000044);
  assert.equal(normalizeDayPhase(-.25),.75);
  assert.equal(f.cycle.syncServerPhase(.95,1000),true);
  assert.equal(f.cycle.online,true);
  f.cycle.tick(1000);
  assert.ok(Math.abs(f.cycle.phase-.95)<1e-9,
    'server clock overrides offline visual toggle');
  f.cycle.tick(1000+DAY_CYCLE_MS*.1);
  assert.ok(Math.abs(f.cycle.phase-.05)<1e-9);
  // A new authoritative sample corrects drift without jumping a full day.
  assert.equal(f.cycle.syncServerPhase(.052,1000+DAY_CYCLE_MS*.1),true);
  const now=f.cycle.phaseAt(1000+DAY_CYCLE_MS*.1);
  assert.ok(now>.05&&now<.053);
  assert.equal(f.cycle.syncServerPhase(1.2,3000),false);
  assert.equal(f.cycle.syncServerPhase(NaN,3000),false);
  f.cycle.leaveServer();
  assert.equal(f.cycle.online,false);
  assert.equal(f.cycle.offlinePhase,0);
  f.cycle.tick(500000);
  assert.equal(f.cycle.active,false);
});

test('server sync cannot replace the locally saved offline clock',()=>{
  const f=fixture();
  f.settings.dayCycleEnabled=true;
  f.cycle.setOfflinePhase(.33);
  f.cycle.tick(0);
  f.cycle.syncServerPhase(.8,100);
  f.cycle.tick(100);
  assert.ok(Math.abs(f.cycle.phase-.8)<1e-9);
  f.cycle.leaveServer();
  f.cycle.tick(1000);
  assert.ok(Math.abs(f.cycle.phase-.33)<1e-9);
});

test('closing a failed connection does not reset an active offline clock',()=>{
  const f=fixture();
  f.settings.dayCycleEnabled=true;
  f.cycle.tick(1);
  f.cycle.tick(1+DAY_CYCLE_MS*.3);
  assert.ok(Math.abs(f.cycle.offlinePhase-.3)<1e-9);
  const before=snapshot(f);
  f.cycle.leaveServer();
  assert.equal(f.cycle.online,false);
  assert.ok(Math.abs(f.cycle.offlinePhase-.3)<1e-9);
  assert.deepEqual(snapshot(f),before);
});

test('night vision brightens darkness without changing daytime lighting or the sky',()=>{
 assert.deepEqual(nightVisionLighting(1.2,2,true),{ambient:1.2,sun:2});
 const night=nightVisionLighting(0,0,true,1);
 assert.ok(night.ambient>1.1,'night vision remains brighter than dark night');
 assert.ok(night.sun>0);
 assert.deepEqual(nightVisionLighting(0,0,false,1),{ambient:0,sun:0});
 const state={hasNightVision:false};
 const f=fixture(state);
 f.settings.dayCycleEnabled=true;
 f.cycle.applyPhase(.5);
 const original=snapshot(f);
 state.hasNightVision=true;
 f.cycle.applyPhase(.5);
 const boosted=snapshot(f);
 assert.ok(boosted.ambient>original.ambient,'real local ambient brightness changes');
 assert.ok(boosted.sun>original.sun,'moonlight becomes more useful');
 assert.deepEqual(boosted.sky,original.sky,'sky stays night-dark');
 assert.deepEqual(boosted.fog,original.fog,'world fog keeps night colour');
 state.hasNightVision=false;
 f.cycle.applyPhase(.5);
 assert.equal(f.hemisphere.intensity,original.ambient,'night vision ends without leaking brightness');
 f.cycle.restore();
});

test('debug time override applies actual night lighting even with visual cycle disabled',()=>{
 const f=fixture();
 const daylight=snapshot(f);
 assert.equal(f.settings.dayCycleEnabled,false);
 assert.equal(f.cycle.setOfflinePhase(.5),true);
 f.cycle.tick(200);
 assert.deepEqual(snapshot(f),daylight,'normal disabled cycle leaves lighting alone');
 assert.equal(f.cycle.setDebugOverride(true),true);
 f.cycle.tick(200);
 assert.equal(f.cycle.active,true);
 assert.ok(f.hemisphere.intensity<daylight.ambient*.5);
 assert.ok(f.sun.intensity<daylight.sun*.5);
 assert.notDeepEqual(f.scene.background.rgb(),daylight.sky);
 assert.notDeepEqual(f.scene.background.rgb(),f.scene.fog.color.rgb());
 // An explicit change from night to day must apply immediately (same timestamp).
 f.cycle.setOfflinePhase(0);
 f.cycle.tick(200);
 assert.deepEqual(snapshot(f),daylight);
 // The requested phase must continue to drive the light on future frames.
 f.cycle.setOfflinePhase(.5);
 f.cycle.tick(200);
 f.cycle.tick(800);
 assert.ok(f.sun.intensity<daylight.sun*.5);
 // Enabling debug visual time is independent of OS reduced-motion preference.
 f.motionQuery.matches=true;
 f.cycle.tick(1100);
 assert.equal(f.cycle.active,true);
 f.cycle.setDebugOverride(false);
 f.cycle.tick(1101);
 assert.equal(f.cycle.active,false);
 assert.deepEqual(snapshot(f),daylight);
});


test('light settings drive daylight and moonlight independently and night terrain restores',()=> {
 const f=fixture();
 let lastTerrain=null;
 const ctx={THREE:f.THREE,scene:f.scene,hemisphere:f.hemisphere,sun:f.sun,
   settings:{dayCycleEnabled:true,dayAmbient:1.3,daySun:1.5,nightAmbient:.015,nightMoon:0,nightViewDistance:80},
   terrain:{setNightBlend:(blend,far)=>{lastTerrain={blend,far};}}};
 const cycle=createDayCycle(ctx,{motionQuery:f.motionQuery});
 cycle.tick(0);
 assert.ok(Math.abs(f.hemisphere.intensity-1.3)<1e-9);
 assert.ok(Math.abs(f.sun.intensity-1.5)<1e-9);
 cycle.setOfflinePhase(.5);cycle.tick(1000);
 assert.ok(Math.abs(f.hemisphere.intensity-.015)<1e-9);
 assert.equal(f.sun.intensity,0);
 assert.deepEqual(lastTerrain,{blend:1,far:80});
 ctx.settings.dayCycleEnabled=false;cycle.tick(1500);
 assert.deepEqual(lastTerrain,{blend:0,far:80});
 assert.equal(cycle.active,false);
});

test('offline debug freeze holds exact phase, illumination and resumes without a time jump',()=>{
 const f=fixture();
 f.settings.dayCycleEnabled=true;
 f.cycle.tick(1000);
 const frozenAt=1000+DAY_CYCLE_MS*.5;
 assert.equal(f.cycle.setFrozen(true,frozenAt),true);
 assert.equal(f.cycle.frozen,true);
 assert.ok(Math.abs(f.cycle.phaseAt(frozenAt)-.5)<1e-10);
 f.cycle.tick(frozenAt);
 const midnight=snapshot(f);
 f.cycle.tick(frozenAt+DAY_CYCLE_MS*3);
 assert.deepEqual(snapshot(f),midnight);
 assert.ok(Math.abs(f.cycle.phaseAt(frozenAt+DAY_CYCLE_MS*3)-.5)<1e-10);
 assert.equal(f.cycle.setFrozen(false,frozenAt+DAY_CYCLE_MS*3),true);
 assert.equal(f.cycle.frozen,false);
 assert.ok(Math.abs(f.cycle.phaseAt(frozenAt+DAY_CYCLE_MS*3)-.5)<1e-10);
 assert.ok(Math.abs(f.cycle.phaseAt(frozenAt+DAY_CYCLE_MS*3+DAY_CYCLE_MS*.25)-.75)<1e-10);
});

test('debug slider can choose a new time while frozen, then unfreezing resumes from it',()=>{
 const f=fixture();
 f.settings.dayCycleEnabled=false;
 const start=3000;
 assert.equal(f.cycle.setFrozen(true,start),true);
 f.cycle.setDebugOverride(true);
 assert.equal(f.cycle.setOfflinePhase(8/16),true);
 f.cycle.tick(start);
 const night=snapshot(f);
 f.cycle.tick(start+DAY_CYCLE_MS*4);
 assert.deepEqual(snapshot(f),night);
 assert.equal(f.cycle.setOfflinePhase(3/16),true);
 f.cycle.tick(start+DAY_CYCLE_MS*4+1000);
 assert.ok(Math.abs(f.cycle.phase-3/16)<1e-10);
 assert.equal(f.cycle.setFrozen(false,start+DAY_CYCLE_MS*4+1000),true);
 assert.ok(Math.abs(f.cycle.phaseAt(start+DAY_CYCLE_MS*4+1000+DAY_CYCLE_MS/16)-4/16)<1e-10);
 f.cycle.setDebugOverride(false);
 f.cycle.tick(start+DAY_CYCLE_MS*4+DAY_CYCLE_MS/16+1100);
 assert.equal(f.cycle.active,false);
});

test('server time can never be frozen and server synchronization cancels local freeze',()=>{
 const f=fixture();
 f.settings.dayCycleEnabled=true;
 f.cycle.tick(0);
 f.cycle.setFrozen(true,100);
 f.cycle.syncServerPhase(.8,200);
 assert.equal(f.cycle.frozen,false);
 assert.equal(f.cycle.setFrozen(true,250),false);
 assert.ok(Math.abs(f.cycle.phaseAt(1200)-(.8+1000/DAY_CYCLE_MS))<1e-10);
 f.cycle.leaveServer();
 assert.equal(f.cycle.setFrozen(true,2000),true);
 assert.equal(f.cycle.frozen,true);
});


test('daylight sliders work live even if the timed day/night cycle is disabled',()=>{
 const f=fixture();
 f.settings.dayAmbient=.8;
 f.settings.daySun=5;
 f.cycle.tick(100);
 assert.equal(f.cycle.active,false);
 assert.equal(f.hemisphere.intensity,.8);
 assert.equal(f.sun.intensity,5);
 f.settings.dayAmbient=1.2;
 f.settings.daySun=2;
 f.cycle.tick(200);
 assert.equal(f.hemisphere.intensity,1.2);
 assert.equal(f.sun.intensity,2);
});
