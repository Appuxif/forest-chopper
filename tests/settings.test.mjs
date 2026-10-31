import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeSettings,createSettings} from '../src/settings.js';

const defaults = {
  mouseSensitivity:1,showFps:false,spruceFoliageVisible:true,spruceFoliageShadows:true,spruceFoliageDensity:100,windEnabled:true,dayCycleEnabled:false,
  autoSprint:false,quality:'balanced',maxFps:60,shadowDistance:60,shadowRefreshSeconds:1,characterShadowsEnabled:true,characterShadowDistance:30,shadowContrast:70,grassDensity:25,
  grassDistance:50,grassMinSize:2.5,grassMaxSize:5.5,grassWidth:1,
  grassTurnMin:-30,grassTurnMax:30,fov:75,
  cameraHeight:2.3,cameraSide:.4,cameraDistance:1.7,cameraPitchLimit:80,
};

test('settings defaults and rejects invalid or corrupted saved values',()=>{
  assert.deepEqual(sanitizeSettings(null), defaults);
  assert.deepEqual(sanitizeSettings([]), defaults);
  assert.deepEqual(sanitizeSettings({mouseSensitivity:999,showFps:'true'}), defaults);
  assert.deepEqual(sanitizeSettings({mouseSensitivity:0,showFps:true}), {...defaults,showFps:true});
  assert.deepEqual(sanitizeSettings({mouseSensitivity:'NaN',showFps:1}), defaults);
  assert.deepEqual(sanitizeSettings({mouseSensitivity:'1.24',showFps:true}), {...defaults,mouseSensitivity:1.2,showFps:true});
});
test('sensitivity boundaries are inclusive and persistence stays independent of world state',()=>{
  assert.equal(sanitizeSettings({mouseSensitivity:.4}).mouseSensitivity,.4);
  assert.equal(sanitizeSettings({mouseSensitivity:2.5}).mouseSensitivity,2.5);
  assert.equal(sanitizeSettings({mouseSensitivity:2.6}).mouseSensitivity,1);
  assert.equal(sanitizeSettings({windEnabled:false}).windEnabled,false);
  assert.equal(sanitizeSettings({windEnabled:0}).windEnabled,true);
  assert.equal(sanitizeSettings({dayCycleEnabled:true}).dayCycleEnabled,true);
  assert.equal(sanitizeSettings({dayCycleEnabled:'true'}).dayCycleEnabled,false);
  assert.equal(sanitizeSettings({autoSprint:true}).autoSprint,true);
  assert.equal(sanitizeSettings({autoSprint:'true'}).autoSprint,false);
  assert.equal(sanitizeSettings({shadowRefreshSeconds:0}).shadowRefreshSeconds,0,
    'zero means every rendered frame and must survive persistence');
  assert.equal(sanitizeSettings({shadowRefreshSeconds:.5}).shadowRefreshSeconds,.5);
  assert.equal(sanitizeSettings({shadowRefreshSeconds:5}).shadowRefreshSeconds,5);
  assert.equal(sanitizeSettings({shadowRefreshSeconds:-.5}).shadowRefreshSeconds,1);
  assert.equal(sanitizeSettings({shadowRefreshSeconds:5.5}).shadowRefreshSeconds,1);
  assert.equal(sanitizeSettings({characterShadowFps:0}).characterShadowsEnabled,false,
    'old 0 FPS setting migrates to disabled shadows');
  assert.equal(sanitizeSettings({characterShadowFps:20}).characterShadowsEnabled,true);
  assert.equal(sanitizeSettings({characterShadowsEnabled:false}).characterShadowsEnabled,false);
  assert.equal(sanitizeSettings({characterShadowDistance:10}).characterShadowDistance,10);
  assert.equal(sanitizeSettings({characterShadowDistance:100}).characterShadowDistance,100);
  assert.equal(sanitizeSettings({characterShadowDistance:101}).characterShadowDistance,30);
  assert.equal(sanitizeSettings({characterShadowDistance:5}).characterShadowDistance,30);
  assert.equal(sanitizeSettings({shadowContrast:0}).shadowContrast,0);
  assert.equal(sanitizeSettings({shadowContrast:100}).shadowContrast,100);
  assert.equal(sanitizeSettings({shadowContrast:101}).shadowContrast,70);
  assert.equal(sanitizeSettings({spruceFoliageVisible:false}).spruceFoliageVisible,false);
  assert.equal(sanitizeSettings({spruceFoliageShadows:false}).spruceFoliageShadows,false);
  assert.equal(sanitizeSettings({spruceFoliageShadows:0}).spruceFoliageShadows,true);
  const old=sanitizeSettings({spruceFoliageOpaque:true,spruceFoliageMaterial:'basic',spruceFoliageTrimmed:false});
  assert.equal('spruceFoliageOpaque' in old,false);
  assert.equal('spruceFoliageMaterial' in old,false);
  assert.equal('spruceFoliageTrimmed' in old,false);
  for(const pct of [0,25,50,75,100])
    assert.equal(sanitizeSettings({spruceFoliageDensity:pct}).spruceFoliageDensity,pct);
  for(const invalid of [-5,101,22,35.5,'50',null])
    assert.equal(sanitizeSettings({spruceFoliageDensity:invalid}).spruceFoliageDensity,100);
  assert.equal(sanitizeSettings({fov:65}).fov,65);
  assert.equal(sanitizeSettings({fov:95}).fov,95);
  assert.equal(sanitizeSettings({fov:62}).fov,75);
  assert.equal(sanitizeSettings({fov:1000}).fov,75);
  assert.equal(sanitizeSettings({fov:82}).fov,80);
  assert.deepEqual(Object.keys(sanitizeSettings({seed:123,logs:[1]})),Object.keys(defaults));
});

test('camera distances, side and pitch limits validate their bounds',()=>{
  const values=sanitizeSettings({cameraHeight:3.5,cameraSide:-1.5,cameraDistance:6,cameraPitchLimit:80});
  assert.equal(values.cameraHeight,3.5);
  assert.equal(values.cameraSide,-1.5);
  assert.equal(values.cameraDistance,6);
  assert.equal(values.cameraPitchLimit,80);
  assert.deepEqual(sanitizeSettings({cameraHeight:99,cameraSide:-100,cameraDistance:0,cameraPitchLimit:120}),defaults);
});

test('FOV is restored, applied live and reset without affecting world saves',()=>{
  const elements=new Map();
  function element(id){
    if(!elements.has(id))elements.set(id,{value:'',checked:false,textContent:'',style:{},
      setAttribute(){},querySelector:element});
    return elements.get(id);
  }
  const doc={
    createElement:tag=>({tag,hidden:false,setAttribute(){},querySelector:element}),
    head:{append(){}},body:{append(){}},
  };
  const updates=[],writes=[];
  const storage={
    getItem(){return JSON.stringify({mouseSensitivity:1,showFps:false,windEnabled:true,fov:85})},
    setItem(k,v){writes.push([k,JSON.parse(v)])},
  };
  const settings=createSettings(doc,storage,fov=>updates.push(fov));
  assert.equal(settings.fov,85);
  const foliage=element('#fc-spruce-foliage-visible');
  const foliageShadows=element('#fc-spruce-foliage-shadows');
  assert.equal(foliage.checked,true);
  assert.equal(foliageShadows.checked,true);
  const foliageDensity=element('#fc-spruce-foliage-density');
  assert.equal(foliageDensity.value,'100');
  foliageDensity.value='25';foliageDensity.oninput();
  assert.equal(settings.spruceFoliageDensity,25);
  assert.equal(element('#fc-spruce-foliage-density-value').textContent,'25');
  assert.equal(writes.at(-1)[1].spruceFoliageDensity,25);
  foliage.checked=false;foliage.onchange();
  assert.equal(settings.spruceFoliageVisible,false);
  assert.equal(writes.at(-1)[1].spruceFoliageVisible,false);
  foliageShadows.checked=false;foliageShadows.onchange();
  assert.equal(settings.spruceFoliageShadows,false);
  assert.deepEqual(updates,[85]);
  const refresh=element('#fc-shadow-refresh');
  assert.equal(refresh.value,'1');
  refresh.value='0';refresh.oninput();
  assert.equal(settings.shadowRefreshSeconds,0);
  assert.equal(element('#fc-shadow-refresh-value').textContent,'каждый кадр');
  assert.equal(writes.at(-1)[1].shadowRefreshSeconds,0);
  refresh.value='0.5';refresh.oninput();
  assert.equal(element('#fc-shadow-refresh-value').textContent,'0.5 с');
  const radius=element('#fc-character-shadow-distance');
  assert.equal(radius.value,'30');
  radius.value='100';radius.oninput();
  assert.equal(settings.characterShadowDistance,100);
  assert.equal(element('#fc-character-shadow-distance-value').textContent,'100');
  assert.equal(writes.at(-1)[1].characterShadowDistance,100);
  const contrast=element('#fc-shadow-contrast');
  assert.equal(contrast.value,'70');
  contrast.value='95';contrast.oninput();
  assert.equal(settings.shadowContrast,95);
  assert.equal(element('#fc-shadow-contrast-value').textContent,'95');
  assert.equal(writes.at(-1)[1].shadowContrast,95);
  const cameraSide=element('#fc-camera-side');
  assert.equal(cameraSide.value,'0.4');
  cameraSide.value='-0.75';
  cameraSide.oninput({target:cameraSide});
  assert.equal(settings.cameraSide,-.75);
  assert.equal(element('#fc-camera-side-value').textContent,'-0.75');
  assert.equal(writes.at(-1)[1].cameraSide,-.75);
  const cameraHeight=element('#fc-camera-height');
  cameraHeight.value='2.2';cameraHeight.oninput({target:cameraHeight});
  assert.equal(settings.cameraHeight,2.2);
  const cameraDistance=element('#fc-camera-distance');
  cameraDistance.value='4.1';cameraDistance.oninput({target:cameraDistance});
  assert.equal(settings.cameraDistance,4.1);
  const cameraPitch=element('#fc-camera-pitch-limit');
  cameraPitch.value='30';cameraPitch.oninput({target:cameraPitch});
  assert.equal(settings.cameraPitchLimit,30);
  const input=element('#fc-fov');
  assert.equal(input.value,'85');
  input.value='95';
  input.oninput();
  assert.equal(settings.fov,95);
  assert.deepEqual(updates,[85,95]);
  assert.equal(element('#fc-fov-value').textContent,'95');
  assert.equal(writes.at(-1)[1].fov,95);
  assert.equal(writes.at(-1)[1].seed,undefined);
  element('#fc-reset-settings').onclick();
  assert.equal(settings.characterShadowDistance,30);
  assert.equal(settings.shadowContrast,70);
  assert.equal(settings.fov,75);
  assert.equal(settings.spruceFoliageVisible,true);
  assert.equal(settings.spruceFoliageShadows,true);
  assert.equal(settings.spruceFoliageDensity,100);
  assert.equal(settings.cameraHeight,2.3);
  assert.equal(settings.cameraSide,.4);
  assert.equal(settings.cameraDistance,1.7);
  assert.equal(settings.cameraPitchLimit,80);
  assert.deepEqual(updates,[85,95,75]);
  assert.equal(writes.at(-1)[1].fov,75);
  const day=element('#fc-day-cycle');
  day.checked=true;
  day.onchange();
  assert.equal(settings.dayCycleEnabled,true);
  assert.equal(writes.at(-1)[1].dayCycleEnabled,true);
  element('#fc-reset-settings').onclick();
  assert.equal(settings.dayCycleEnabled,false);
  const sprint=element('#fc-auto-sprint');
  sprint.checked=true;
  sprint.onchange();
  assert.equal(settings.autoSprint,true);
  assert.equal(writes.at(-1)[1].autoSprint,true);
  element('#fc-reset-settings').onclick();
  assert.equal(settings.autoSprint,false);
});

test('saved ±40° camera setup migrates to ±80° exactly once',()=>{
  const values=new Map([['forest-chopper:settings:v1',
    JSON.stringify({cameraPitchLimit:40,cameraHeight:2.3,cameraSide:.4,cameraDistance:1.7})]]);
  const storage={
    getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,value),
  };
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{
      value:'',checked:false,textContent:'',style:{},setAttribute(){},querySelector:element,
    });
    return elements.get(id);
  };
  const doc={
    createElement:()=>({hidden:false,setAttribute(){},querySelector:element}),
    head:{append(){}},body:{append(){}},
  };
  const first=createSettings(doc,storage);
  assert.equal(first.cameraPitchLimit,80);
  assert.equal(first.cameraHeight,2.3);
  assert.equal(JSON.parse(values.get('forest-chopper:settings:v1')).cameraPitchLimit,80);
  const slider=element('#fc-camera-pitch-limit');
  slider.value='40';slider.oninput({target:slider});
  assert.equal(first.cameraPitchLimit,40);
  assert.equal(createSettings(doc,storage).cameraPitchLimit,40,
    'new user selection of ±40° is preserved after migration');
});

test('grass defaults, saved ranges, clamps and reset use new preset only for regular grass',()=>{
  assert.deepEqual(sanitizeSettings(null),defaults);
  const adjusted=sanitizeSettings({grassDensity:39,grassDistance:100,grassMinSize:6,
    grassMaxSize:3,grassWidth:.25,grassTurnMin:-90,grassTurnMax:90});
  assert.deepEqual([adjusted.grassDensity,adjusted.grassDistance,adjusted.grassMinSize,
    adjusted.grassMaxSize,adjusted.grassWidth,adjusted.grassTurnMin,adjusted.grassTurnMax],
    [39,100,3,6,.25,-90,90]);
  const invalid=sanitizeSettings({grassDensity:51,grassDistance:10,
    grassMinSize:0,grassMaxSize:9,grassWidth:10,grassTurnMin:1,grassTurnMax:-1});
  for(const key of ['grassDensity','grassDistance','grassMinSize','grassMaxSize',
    'grassWidth','grassTurnMin','grassTurnMax'])assert.equal(invalid[key],defaults[key]);
});
