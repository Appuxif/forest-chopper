import test from 'node:test';
import assert from 'node:assert/strict';
import {createDayCycle,dayPhaseValues,DAY_CYCLE_MS} from '../src/day-cycle.js';

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

function fixture(){
  const scene={background:new Color(0xa4c8be),fog:{color:new Color(0xa4c8be)}};
  const hemisphere={intensity:2.1},sun={intensity:2.3,color:new Color(0xffe4a6)};
  const settings={dayCycleEnabled:false};
  const motionQuery={matches:false};
  const ctx={THREE:{Color},scene,hemisphere,sun,settings};
  return {...ctx,motionQuery,cycle:createDayCycle(ctx,{motionQuery})};
}
function snapshot(f){
  return {sky:f.scene.background.rgb(),fog:f.scene.fog.color.rgb(),
    sunColor:f.sun.color.rgb(),sun:f.sun.intensity,ambient:f.hemisphere.intensity};
}

test('phase interpolation is continuous, cyclic and keeps a readable light floor',()=>{
  assert.equal(DAY_CYCLE_MS,480000);
  for(const point of [0,.1,.22,.23,.3,.43,.5,.57,.7,.77,.95,.9999,1,2,-.5,NaN]){
    const v=dayPhaseValues(point);
    assert.ok(v.ambient>=1.35 && v.ambient<=2.1);
    assert.ok(v.sun>=.65 && v.sun<=2.3);
    assert.ok(v.t>=0&&v.t<=1);
  }
  assert.deepEqual(dayPhaseValues(0),dayPhaseValues(1));
  assert.deepEqual(dayPhaseValues(.5),dayPhaseValues(1.5));
  assert.equal(dayPhaseValues(.5).sun,.65);
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
  assert.ok(night.ambient>=1.35&&night.sun>=.65);
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
  assert.deepEqual(snapshot(f),original,'new enabled session starts at daytime');
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
  assert.deepEqual(snapshot(f),original);
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
