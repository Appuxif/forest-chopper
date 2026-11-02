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
  const hemisphere={intensity:2.1},sun={intensity:2.3,color:new Color(0xffe4a6)};
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
    assert.ok(v.ambient>=.49 && v.ambient<=2.1);
    assert.ok(v.sun>=.30 && v.sun<=2.3);
    assert.ok(v.t>=0&&v.t<=1);
  }
  assert.deepEqual(dayPhaseValues(0),dayPhaseValues(1));
  assert.deepEqual(dayPhaseValues(.5),dayPhaseValues(1.5));
  assert.equal(dayPhaseValues(.5).sun,.30);
  assert.equal(dayPhaseValues(.5).ambient,.49);
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
  assert.equal(night.ambient,.49);
  assert.ok(Math.abs(night.sun-.30)<1e-10);
  assert.deepEqual(night.sky,night.fog,'sky and fog must match to avoid horizon seam');
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
    assert.ok(distance<.08,'sky jump at '+i+' = '+distance);
    assert.ok(Math.abs(y.ambient-x.ambient)<.08);
    assert.ok(Math.abs(y.sun-x.sun)<.09);
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
  let originalAmbient=2.1;
  f.hemisphere.intensity=originalAmbient*contrast;
  const atmosphere={
    get ambientIntensity(){return originalAmbient},
    get sunIntensity(){return 2.3},
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
  assert.ok(Math.abs(f.hemisphere.intensity-.49*contrast)<1e-10);
  f.settings.dayCycleEnabled=false;
  cycle.tick(101+DAY_CYCLE_MS*.5);
  assert.equal(atmosphere.ambientIntensity,2.1);
  assert.ok(Math.abs(f.hemisphere.intensity-2.1*contrast)<1e-10,
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
 assert.deepEqual(nightVisionLighting(2.1,2.3,true),{ambient:2.1,sun:2.3});
 const night=nightVisionLighting(.49,.3,true);
 assert.ok(night.ambient>1.4);
 assert.ok(night.sun>.3);
 assert.deepEqual(nightVisionLighting(.49,.3,false),{ambient:.49,sun:.3});
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
