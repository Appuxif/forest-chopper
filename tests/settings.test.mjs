import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sanitizeSettings,createSettings,lightingFieldMarkup,lookRangeMarkup,settingsExportJSON,LIGHTING_FIELDS,LIGHTING_FLAGS} from '../src/settings.js';
import {PERFORMANCE_DEFAULTS,PERFORMANCE_PRESETS,PERFORMANCE_LIGHTING_PRESETS} from '../src/performance-presets.js';
import {DEFAULT_AUDIO,SOUND_CONTROLS} from '../src/sound-rules.js';
import {CHARACTER_LOOK_FIELDS} from '../src/character-orientation.js';

const defaults={...PERFORMANCE_DEFAULTS,performancePreset:'high',
 mouseSensitivity:1,showFps:false,dayCycleEnabled:false,autoSprint:false,showTouchControls:true,
 fov:75,cameraHeight:2.3,cameraSide:.4,cameraDistance:1.7,cameraPitchLimit:80,
 ...Object.fromEntries(Object.entries(CHARACTER_LOOK_FIELDS).map(([key,val])=>[key,val[3]])),
 audio:DEFAULT_AUDIO,
 ...Object.fromEntries(Object.entries(LIGHTING_FIELDS).map(([key,val])=>[key,val[3]])),
 ...LIGHTING_FLAGS,...PERFORMANCE_LIGHTING_PRESETS.high,
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
  assert.equal(sanitizeSettings({showTouchControls:false}).showTouchControls,false);
  assert.equal(sanitizeSettings({showTouchControls:'false'}).showTouchControls,true);
  assert.equal(sanitizeSettings({autoSprint:true}).autoSprint,true);
  assert.equal(sanitizeSettings({autoSprint:'true'}).autoSprint,false);
  assert.equal(sanitizeSettings({shadowRefreshSeconds:0}).shadowRefreshSeconds,0,
    'zero means every rendered frame and must survive persistence');
  assert.equal(sanitizeSettings({shadowRefreshSeconds:.5}).shadowRefreshSeconds,.5);
  assert.equal(sanitizeSettings({shadowRefreshSeconds:5}).shadowRefreshSeconds,5);
  assert.equal(sanitizeSettings({shadowRefreshSeconds:-.5}).shadowRefreshSeconds,20);
  assert.equal(sanitizeSettings({shadowRefreshSeconds:5.5}).shadowRefreshSeconds,5.5);
  assert.equal(sanitizeSettings({shadowRefreshSeconds:20}).shadowRefreshSeconds,20);
  assert.equal(sanitizeSettings({shadowRefreshSeconds:20.5}).shadowRefreshSeconds,20);
  assert.equal(sanitizeSettings({characterShadowFps:0}).characterShadowsEnabled,false,
    'old 0 FPS setting migrates to disabled shadows');
  assert.equal(sanitizeSettings({characterShadowFps:20}).characterShadowsEnabled,true);
  assert.equal(sanitizeSettings({characterShadowsEnabled:false}).characterShadowsEnabled,false);
  assert.equal(sanitizeSettings({characterShadowDistance:10}).characterShadowDistance,10);
  assert.equal(sanitizeSettings({characterShadowDistance:100}).characterShadowDistance,100);
  assert.equal(sanitizeSettings({characterShadowDistance:101}).characterShadowDistance,62);
  assert.equal(sanitizeSettings({characterShadowDistance:5}).characterShadowDistance,62);
  assert.equal(sanitizeSettings({shadowContrast:0}).shadowContrast,0);
  assert.equal(sanitizeSettings({shadowContrast:100}).shadowContrast,100);
  assert.equal(sanitizeSettings({shadowContrast:101}).shadowContrast,100);
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
  assert.deepEqual(Object.keys(sanitizeSettings({seed:123,logs:[1]})).sort(),Object.keys(defaults).sort());
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
  assert.equal(refresh.value,'20');
  refresh.value='0';refresh.oninput();
  assert.equal(settings.shadowRefreshSeconds,0);
  assert.equal(element('#fc-shadow-refresh-value').textContent,'каждый кадр');
  assert.equal(writes.at(-1)[1].shadowRefreshSeconds,0);
  refresh.value='0.5';refresh.oninput();
  assert.equal(element('#fc-shadow-refresh-value').textContent,'0.5 с');
  const radius=element('#fc-character-shadow-distance');
  assert.equal(radius.value,'62');
  radius.value='100';radius.oninput();
  assert.equal(settings.characterShadowDistance,100);
  assert.equal(element('#fc-character-shadow-distance-value').textContent,'100');
  assert.equal(writes.at(-1)[1].characterShadowDistance,100);
  const contrast=element('#fc-shadow-contrast');
  assert.equal(contrast.value,'100');
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
  assert.equal(settings.characterShadowDistance,62);
  assert.equal(settings.shadowContrast,100);
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
  const lod=sanitizeSettings({grassFullDensityDistance:0,grassFarDensityPercent:0,grassFarWidthBonus:100});
  assert.equal(lod.grassFullDensityDistance,0);
  assert.equal(lod.grassFarDensityPercent,0);
  assert.equal(lod.grassFarWidthBonus,100);
  const lodMax=sanitizeSettings({grassFullDensityDistance:30,grassFarDensityPercent:100,grassFarWidthBonus:0});
  assert.equal(lodMax.grassFullDensityDistance,30);
  assert.equal(lodMax.grassFarDensityPercent,100);
  assert.equal(lodMax.grassFarWidthBonus,0);
  const bad=sanitizeSettings({grassFullDensityDistance:-1,grassFarDensityPercent:101,grassFarWidthBonus:-1});
  for(const key of ['grassFullDensityDistance','grassFarDensityPercent','grassFarWidthBonus'])
    assert.equal(bad[key],defaults[key]);
});


test('all graphics presets are internally consistent and custom fields validate',()=>{
  for(const [name,preset] of Object.entries(PERFORMANCE_PRESETS)){
    const value=sanitizeSettings({...preset,performancePreset:name});
    for(const key of Object.keys(preset))
      assert.equal(value[key],preset[key],name+' value '+key);
    assert.equal(value.performancePreset,name);
  }
  assert.equal(sanitizeSettings({renderScale:500}).renderScale,95);
  assert.equal(sanitizeSettings({renderScale:65}).renderScale,65);
  assert.equal(sanitizeSettings({terrainSegments:32}).terrainSegments,32);
  assert.equal(sanitizeSettings({lakeForestMode:'bad'}).lakeForestMode,'shore');
  assert.equal(sanitizeSettings({farTreeDensity:-5}).farTreeDensity,50);
  assert.equal(sanitizeSettings({grassTriangles:2}).grassTriangles,6);
  assert.equal(sanitizeSettings({shadowMapSize:2048}).shadowMapSize,2048);
 assert.equal(sanitizeSettings({shadowMapSize:4096}).shadowMapSize,4096);
});

test('preset selection applies all graphics properties; manual graphics changes select custom, controls do not',()=>{
  const nodes=new Map();
  function element(id){
    if(!nodes.has(id))nodes.set(id,{
      value:'',checked:false,textContent:'',style:{},
      type:id==='#fc-render-scale'?'range':'',
      setAttribute(){},querySelector:element,
    });
    return nodes.get(id);
  }
  const doc={
    createElement:()=>({hidden:false,textContent:'',style:{},setAttribute(){},querySelector:element}),
    head:{append(){}},body:{append(){}},
  };
  const writes=[],updates=[];
  const storage={getItem:()=>null,setItem:(k,v)=>writes.push(JSON.parse(v))};
  const settings=createSettings(doc,storage,null,null,null,st=>updates.push(st.performancePreset));
  const profile=element('#fc-quality');
  profile.value='low';profile.onchange();
  assert.equal(settings.performancePreset,'low');
  assert.equal(settings.treeShadowsEnabled,false);
  assert.equal(settings.grassTriangles,1);
  assert.equal(settings.renderScale,65);
  assert.equal(settings.maxFps,30);
  assert.equal(settings.lakeForestMode,'off');
  assert.equal(writes.at(-1).performancePreset,'low');
  const sensitivity=element('#fc-sensitivity');
  sensitivity.value='1.6';sensitivity.oninput();
  assert.equal(settings.performancePreset,'low');
  const camera=element('#fc-camera-height');
  camera.value='2.6';camera.oninput({target:camera});
  assert.equal(settings.performancePreset,'low');
  const scale=element('#fc-render-scale');
  scale.value='75';scale.oninput();
  assert.equal(settings.performancePreset,'custom');
  assert.equal(settings.renderScale,75);
  assert.equal(writes.at(-1).performancePreset,'custom');
  assert.equal(settings.setShowFps(true),true);
  assert.equal(writes.at(-1).showFps,true);
  assert.equal(settings.setShowFps(false),false);
  assert.equal(writes.at(-1).showFps,false);
  // Debug profiling samples the same FPS/CPU/GPU HUD without changing
  // the saved Show FPS preference or displaying another overlay.
  const beforeProfilerWrites=writes.length;
  settings.setProfilerSampling(true);
  assert.equal(settings.profilerSampling,true);
  assert.equal(settings.showFps,false);
  settings.tick(1000);
  settings.tick(2000);
  settings.tickPhysics(1000);
  settings.tickPhysics(2000);
  settings.recordCpuFrame(4,1000);
  settings.recordCpuFrame(6,2000);
  settings.setGpuFrameTime(7.5,true);
  assert.match(settings.fpsReport,/Render FPS 1/);
  assert.match(settings.fpsReport,/Physics FPS 1/);
  assert.match(settings.fpsReport,/CPU Frame Time 5\.00 ms/);
  assert.match(settings.fpsReport,/GPU Frame Time 7\.50 ms/);
  settings.setProfilerSampling(false);
  assert.equal(settings.profilerSampling,false);
  assert.equal(settings.showFps,false);
  assert.equal(writes.length,beforeProfilerWrites,'temporary profiler sampling must not persist settings');
  assert.equal(settings.setPerformancePreset('medium').preset,'medium');
  assert.equal(writes.at(-1).performancePreset,'medium');
  profile.value='ultra';profile.onchange();
  assert.equal(settings.performancePreset,'ultra');
  assert.equal(settings.maxFps,0);
  assert.equal(settings.treeShadowsEnabled,true);
  assert.equal(settings.lakeForestMode,'full');
  assert.equal(settings.shadowRefreshSeconds,0);
  assert.ok(updates.length>=3);
});


test('in-game settings leave the world sharp and undimmed; main-menu modal keeps its backdrop',()=>{
  const appended=[],styleNodes=[],elements=new Map();
  function element(id){
    if(!elements.has(id))elements.set(id,{
      value:'',checked:false,textContent:'',style:{},setAttribute(){},
      querySelector:element,focus(){},
    });
    return elements.get(id);
  }
  const doc={
    createElement:tag=>({tag,hidden:false,className:'',style:{},setAttribute(){},querySelector:element,remove(){}}),
    head:{append(node){styleNodes.push(node)}},
    body:{append(...nodes){appended.push(...nodes)}},
  };
  const settings=createSettings(doc,{getItem(){return null},setItem(){}});
  const styles=styleNodes.map(x=>x.textContent).join('');
  const backdrop=appended.find(x=>x.className==='fc-settings-backdrop');
  assert.ok(backdrop);
  assert.match(styles,/\.fc-settings-backdrop\{[^}]*background:transparent;backdrop-filter:none/);
  assert.match(styles,/\.fc-settings-backdrop-menu\{[^}]*backdrop-filter:blur\(3px\)/);
  assert.equal(backdrop.className,'fc-settings-backdrop');
  settings.open();
  assert.equal(backdrop.hidden,false);
  settings.close();
  assert.equal(backdrop.hidden,true);
  settings.setMenuMode(true);
  assert.equal(backdrop.className,'fc-settings-backdrop fc-settings-backdrop-menu');
  settings.setMenuMode(false);
  assert.equal(backdrop.className,'fc-settings-backdrop');
  settings.destroy();
});

test('sound tab has independent persisted sliders, playable previews and audio-only reset',()=>{
 const nodes=new Map(),writes=[],previews=[];
 function element(id){
  if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',style:{},
   dataset:{},setAttribute(){},querySelector:element});
  return nodes.get(id);
 }
 let panel=null;
 const doc={
  createElement:tag=>{
   const node={tag,hidden:false,setAttribute(){},querySelector:element,
    querySelectorAll(selector){
     if(selector==='[data-preview]')return ['fire','axe','water'].map(key=>element('#preview-'+key));
     if(selector==='[data-voice-preview]')return ['hurt_male_7','hurt_female_20','death_male_1','death_female_1','axe_chop_7','jump_female_24','jump_male_2'].map(key=>element('#voice-'+key));
     return [];
    },
   };
   if(tag==='section')panel=node;
   return node;
  },
  head:{append(){}},body:{append(){}}
 };
 const store=new Map();
 const storage={getItem:k=>store.get(k)??null,
  setItem(k,v){store.set(k,v);writes.push(JSON.parse(v))}};
 for(const key of ['fire','axe','water'])element('#preview-'+key).dataset.preview=key;
 for(const key of ['hurt_male_7','hurt_female_20','death_male_1','death_female_1','axe_chop_7','jump_female_24','jump_male_2'])element('#voice-'+key).dataset.voicePreview=key;
 const settings=createSettings(doc,storage,null,null,null,null,(key,exact)=>previews.push(exact?[key,exact]:key));
 assert.match(panel.innerHTML,/data-category="audio"/);
 assert.match(panel.innerHTML,/data-voice-preview="hurt_female_20"/);
 assert.match(panel.innerHTML,/data-voice-preview="jump_female_24"/);
 assert.match(panel.innerHTML,/data-voice-preview="jump_male_2"/);
 assert.match(panel.innerHTML,/data-voice-preview="hurt_female_20">▶ 20<\/button>/);
 assert.match(panel.innerHTML,/data-voice-preview="jump_female_24">▶ 24<\/button>/);
 assert.doesNotMatch(panel.innerHTML,/data-voice-preview="hurt_female_1"/);
 assert.doesNotMatch(panel.innerHTML,/data-voice-preview="hurt_female_37"/);
 assert.match(panel.innerHTML,/data-voice-preview="hurt_male_7"/);
 assert.match(panel.innerHTML,/data-voice-preview="axe_chop_7"/);
 assert.doesNotMatch(panel.innerHTML,/data-preview="owl"/);
 assert.match(panel.innerHTML,/data-voice-preview="death_male_1"/);
 for(const {key,label} of SOUND_CONTROLS){
  assert.match(panel.innerHTML,new RegExp(`id="fc-audio-${key}"`));
  assert.ok(panel.innerHTML.includes(label));
 }
 assert.equal(element('#fc-audio-fire').value,String(DEFAULT_AUDIO.fire));
 const fire=element('#fc-audio-fire');fire.value='17';fire.oninput();
 assert.equal(settings.audio.fire,17);
 assert.equal(element('#fc-audio-fire-value').textContent,'17');
 assert.equal(writes.at(-1).audio.fire,17);
 assert.equal(settings.performancePreset,'high','sound does not touch quality preset');
 const male=element('#fc-audio-hurtMale');male.value='0';male.oninput();
 const female=element('#fc-audio-hurtFemale');female.value='90';female.oninput();
 assert.equal(settings.audio.hurtMale,0);
 assert.equal(settings.audio.hurtFemale,90);
 element('#preview-water').onclick();
 element('#voice-hurt_female_20').onclick();
 element('#voice-jump_female_24').onclick();
 element('#voice-jump_male_2').onclick();
 element('#voice-death_male_1').onclick();
 element('#voice-axe_chop_7').onclick();
 assert.deepEqual(previews,['water',['hurt_female_20',true],['jump_female_24',true],['jump_male_2',true],['death_male_1',true],['axe_chop_7',true]]);
 const persisted=createSettings(doc,storage);
 assert.equal(persisted.audio.fire,17);
 assert.equal(persisted.audio.hurtFemale,90);
 element('#fc-audio-defaults').onclick();
 assert.deepEqual(persisted.audio,DEFAULT_AUDIO);
 assert.equal(writes.at(-1).audio.fire,DEFAULT_AUDIO.fire);
});


test('saved untouched pre-review audio volumes migrate once to new 40% defaults',()=>{
 const data=new Map([["forest-chopper:settings:v1",JSON.stringify({
  audio:{fire:60,water:38,forest:42,hurtFemale:78,axe:53,birds:12},
 })]]);
 const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 const nodes=new Map();
 const element=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',style:{},
   setAttribute(){},querySelector:element});
  return nodes.get(id);
 };
 const doc={createElement:()=>({hidden:false,textContent:'',style:{},
  setAttribute(){},querySelector:element}),head:{append(){}},body:{append(){}}};
 const settings=createSettings(doc,storage);
 assert.equal(settings.audio.fire,40);
 assert.equal(settings.audio.water,40);
 assert.equal(settings.audio.forest,40);
 assert.equal(settings.audio.hurtFemale,78);
 assert.equal(settings.audio.axe,53);
 assert.equal(settings.audio.birds,12);
 assert.equal(data.get('forest-chopper:audio-rework-defaults:v2'),'1');
 assert.equal(data.get('forest-chopper:voice-samples:v3'),'1');
 const fire=element('#fc-audio-fire');fire.value='71';fire.oninput();
 const settingsAgain=createSettings(doc,storage);
 assert.equal(settingsAgain.audio.fire,71,'custom user value survives future starts');
});


test('lighting sliders and visual toggles persist independently from graphics presets',()=>{
 const value=sanitizeSettings({
  dayAmbient:1.25,nightMoon:0,nightViewDistance:80,
  campfireDayRadius:1,campfireNightRadius:30,
  torchNightIntensity:10,torchLightHeight:2.8,
  flameShader:false,flameBillboard:false,fireShadows:false,
 });
 assert.equal(value.dayAmbient,1.25);
 assert.equal(value.nightMoon,0);
 assert.equal(value.nightViewDistance,80);
 assert.equal(value.campfireDayRadius,1);
 assert.equal(value.campfireNightRadius,30);
 assert.equal(value.torchNightIntensity,10);
 assert.equal(value.torchLightHeight,2.8);
 assert.equal(value.flameShader,false);
 assert.equal(value.flameBillboard,false);
 assert.equal(value.fireShadows,false);
 assert.equal(value.performancePreset,'high');
 assert.equal(sanitizeSettings({campfireNightRadius:31}).campfireNightRadius,7);
 assert.equal(sanitizeSettings({torchDayIntensity:'10'}).torchDayIntensity,5);
});


test('sun and fire brightness accept 100 while preserving low fractional defaults',()=>{
 for(const key of ['campfireDayIntensity','campfireNightIntensity',
   'torchDayIntensity','torchNightIntensity']){
  const max=sanitizeSettings({[key]:100});
  assert.equal(max[key],100, key+' maximum');
  assert.equal(sanitizeSettings({[key]:100.1})[key],PERFORMANCE_LIGHTING_PRESETS.high[key],
    key+' rejects values above 100');
  assert.equal(LIGHTING_FIELDS[key][1],100,key+' slider maximum');
 }
 assert.equal(LIGHTING_FIELDS.daySun[1],5);
 assert.equal(sanitizeSettings({daySun:5}).daySun,5);
 assert.equal(sanitizeSettings({daySun:5.05}).daySun,2);
 assert.equal(sanitizeSettings({daySun:2.35}).daySun,2.35);
 assert.equal(sanitizeSettings({campfireDayIntensity:1.3}).campfireDayIntensity,1.3);
 assert.equal(sanitizeSettings({torchNightIntensity:3.3}).torchNightIntensity,3.3);
});

test('old untouched lighting preferences migrate once without overwriting custom light settings',()=>{
 const values=new Map([['forest-chopper:settings:v1',JSON.stringify({
  shadowContrast:70,dayAmbient:2.1,daySun:2.3,
  nightAmbient:.35,nightMoon:.025,nightViewDistance:100,
  campfireNightIntensity:4,campfireNightRadius:20,
  torchNightIntensity:3.3,torchNightRadius:16,
  campfireDayIntensity:14,
 })]]);
 const nodes=new Map();
 function element(id){
  if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',style:{},
    setAttribute(){},querySelector:element});
  return nodes.get(id);
 }
 const created=[];
 const doc={createElement:tag=>{
   const node={tag,hidden:false,style:{},setAttribute(){},querySelector:element};
   created.push(node);return node;
 },head:{append(){}},body:{append(){}}};
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const cfg=createSettings(doc,storage);
 const after=JSON.parse(values.get('forest-chopper:settings:v1'));
 assert.equal(cfg.shadowContrast,100);
 assert.equal(cfg.dayAmbient,1.2);
 assert.equal(cfg.daySun,2);
 assert.equal(cfg.nightMoon,.2);
 assert.equal(cfg.nightAmbient,.35,'customized night ambient stays customized');
 assert.equal(cfg.campfireDayIntensity,14,'customized daytime fire intensity stays');
 assert.equal(cfg.campfireNightIntensity,30);
 assert.equal(cfg.campfireNightRadius,30);
 assert.equal(cfg.torchNightIntensity,30);
 assert.equal(cfg.torchNightRadius,30);
 assert.equal(cfg.nightViewDistance,30);
 assert.equal(after.daySun,2);
 assert.equal(after.nightMoon,.2);
 assert.ok(values.has('forest-chopper:night-moon-default:v1'));
 assert.ok(values.has('forest-chopper:night-visibility-30-default:v1'));
 assert.ok(values.has('forest-chopper:night-profile-defaults:v1'));
 assert.ok(created.some(node=>node.innerHTML?.includes('4096 × 4096 (4K)')));
 assert.equal(cfg.shadowMapSize,2048,'new High uses its chosen 2K far map');
});

test('lighting settings expose a live persistent shadow budget 0–4 and moon default 0.2',()=>{
 assert.equal(LIGHTING_FIELDS.nightMoon[3],.2);
 assert.deepEqual(LIGHTING_FIELDS.fireShadowLimit.slice(0,4),[0,4,1,2]);
 for(let count=0;count<=4;count++){
  assert.equal(sanitizeSettings({fireShadowLimit:count}).fireShadowLimit,count);
 }
 for(const invalid of [-1,5,'3',null,NaN]){
  assert.equal(sanitizeSettings({fireShadowLimit:invalid}).fireShadowLimit,4);
 }
 assert.equal(sanitizeSettings({fireShadowLimit:1.5}).fireShadowLimit,2,
  'the step-1 numeric slider rounds fractional input');
 assert.equal(sanitizeSettings(null).nightMoon,0);
 const values=new Map();
 const nodes=new Map();
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',style:{},
   setAttribute(){},querySelector:node});
  return nodes.get(id);
 };
 const doc={createElement:tag=>({tag,hidden:false,style:{},setAttribute(){},querySelector:node}),
  head:{append(){}},body:{append(){}}};
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const settings=createSettings(doc,storage);
 const control=node('#fc-light-fireShadowLimit');
 assert.equal(control.value,'4');
 assert.equal(settings.fireShadowLimit,4);
 control.value='4';control.oninput();
 assert.equal(settings.fireShadowLimit,4);
 assert.equal(node('#fc-light-fireShadowLimit-value').textContent,'4');
 assert.equal(JSON.parse(values.get('forest-chopper:settings:v1')).fireShadowLimit,4);
 control.value='0';control.oninput();
 assert.equal(settings.fireShadowLimit,0);
 assert.equal(JSON.parse(values.get('forest-chopper:settings:v1')).fireShadowLimit,0);
});


test('obsolete split shadow mode and static radius are absent from saved settings',()=>{
 const settings=sanitizeSettings({splitShadowMaps:true,fireStaticShadowRadius:99});
 assert.equal('splitShadowMaps' in settings,false);
 assert.equal('fireStaticShadowRadius' in settings,false);
 assert.equal('splitShadowMaps' in LIGHTING_FLAGS,false);
 assert.equal('fireStaticShadowRadius' in LIGHTING_FIELDS,false);
 const values=new Map(),nodes=new Map();
 const el=id=>{if(!nodes.has(id))nodes.set(id,{checked:false,value:'',style:{},
   textContent:'',setAttribute(){},querySelector:el});return nodes.get(id);};
 const doc={createElement:tag=>({tag,hidden:false,style:{},setAttribute(){},querySelector:el}),
  head:{append(){}},body:{append(){}}};
 const store={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const ui=createSettings(doc,store);
 assert.equal('splitShadowMaps' in ui,false);
 assert.equal('fireStaticShadowRadius' in ui,false);
 assert.equal(el('#fc-light-splitShadowMaps').onchange,undefined);
});

test('night range slider reaches 30m, defaults to 30m and keeps custom values',()=>{
 assert.deepEqual(LIGHTING_FIELDS.nightViewDistance.slice(0,4),[30,160,5,30]);
 assert.equal(sanitizeSettings(null).nightViewDistance,60);
 assert.equal(sanitizeSettings({nightViewDistance:30}).nightViewDistance,30);
 assert.equal(sanitizeSettings({nightViewDistance:150}).nightViewDistance,150);
 assert.equal(sanitizeSettings({nightViewDistance:29}).nightViewDistance,60);
 assert.equal(sanitizeSettings({nightViewDistance:161}).nightViewDistance,60);
 assert.equal(LIGHTING_FIELDS.campfireNightRadius[3],30);
 assert.equal(LIGHTING_FIELDS.torchNightRadius[3],30);
 const persisted=new Map([['forest-chopper:settings:v1',JSON.stringify({
  nightViewDistance:80,nightMoon:.4,dayAmbient:1,
 })]]);
 const el=id=>({id,style:{},setAttribute(){},querySelector:el});
 const doc={createElement:()=>({style:{},setAttribute(){},querySelector:el}),
  head:{append(){}},body:{append(){}}};
 const storage={getItem:key=>persisted.get(key)??null,
  setItem:(key,val)=>persisted.set(key,val)};
 const settings=createSettings(doc,storage);
 assert.equal(settings.nightViewDistance,80,'customized night visibility is preserved');
 assert.equal(settings.nightMoon,.4);
});

test('fire visibility and decay persist independently without an obsolete static radius',()=>{
 const defaults=sanitizeSettings(null);
 for(const kind of ['campfire','torch']){
  assert.equal(defaults[kind+'VisibilityDistance'],30);
  assert.equal(defaults[kind+'Decay'],1);
  assert.equal(sanitizeSettings({[kind+'VisibilityDistance']:250})[kind+'VisibilityDistance'],250);
  assert.equal(sanitizeSettings({[kind+'VisibilityDistance']:10})[kind+'VisibilityDistance'],10);
  assert.equal(sanitizeSettings({[kind+'Decay']:0})[kind+'Decay'],0);
  assert.equal(sanitizeSettings({[kind+'Decay']:.3})[kind+'Decay'],.3);
  assert.equal(sanitizeSettings({[kind+'Decay']:3})[kind+'Decay'],3);
  assert.equal(sanitizeSettings({[kind+'Decay']:4})[kind+'Decay'],1);
  assert.equal(sanitizeSettings({[kind+'VisibilityDistance']:255})[kind+'VisibilityDistance'],30);
 }
 const values=new Map();
 const nodes=new Map();
 const element=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',style:{},
   setAttribute(){},querySelector:element});
  return nodes.get(id);
 };
 const doc={createElement:()=>({hidden:false,style:{},setAttribute(){},querySelector:element}),
  head:{append(){}},body:{append(){}}};
 const storage={getItem:key=>values.get(key)??null,setItem:(key,v)=>values.set(key,v)};
 const cfg=createSettings(doc,storage);
 for(const [key,value] of [
  ['campfireVisibilityDistance',200],['torchVisibilityDistance',150],
  ['campfireDecay',.4],['torchDecay',0],
 ]){
  const input=element('#fc-light-'+key);
  assert.equal(typeof input.oninput,'function',key+' has a live slider');
  input.value=String(value);input.oninput();
  assert.equal(cfg[key],value,key+' is accessible at runtime');
  assert.equal(JSON.parse(values.get('forest-chopper:settings:v1'))[key],value);
 }
 assert.equal(cfg.campfireNightRadius,7,'shadow and lighting ranges are independent');
});

test('light illumination and activation distance have independent sliders for both kinds',()=>{
 for(const kind of ['campfire','torch']){
  const light=kind+'VisibilityDistance';
  const activation=kind+'ActivationDistance';
  const defaults=sanitizeSettings(null);
  assert.equal(defaults[light],30);
  assert.equal(defaults[activation],60);
  assert.equal(sanitizeSettings({[activation]:10})[activation],10);
  assert.equal(sanitizeSettings({[activation]:250})[activation],250);
  assert.equal(sanitizeSettings({[activation]:0})[activation],60);
  assert.equal(sanitizeSettings({[activation]:255})[activation],60);
  const first=sanitizeSettings({[light]:30,[activation]:200});
  assert.equal(first[light],30);
  assert.equal(first[activation],200);
  const second=sanitizeSettings({[light]:250,[activation]:20});
  assert.equal(second[light],250);
  assert.equal(second[activation],20);
 }
 const values=new Map();
 const elements=new Map();
 const element=id=>{
  if(!elements.has(id))elements.set(id,{
   value:'',checked:false,textContent:'',style:{},setAttribute(){},querySelector:element,
  });
  return elements.get(id);
 };
 const doc={createElement:()=>({style:{},setAttribute(){},querySelector:element}),
  head:{append(){}},body:{append(){}}};
 const storage={getItem:key=>values.get(key)??null,setItem:(key,val)=>values.set(key,val)};
 const settings=createSettings(doc,storage);
 for(const [kind,illumination,activation] of [
  ['campfire',35,225],['torch',220,15],
 ]){
  for(const [key,value] of [
   [kind+'VisibilityDistance',illumination],[kind+'ActivationDistance',activation],
  ]){
   const input=element('#fc-light-'+key);
   assert.equal(typeof input.oninput,'function',key);
   input.value=String(value);input.oninput();
   assert.equal(settings[key],value);
   assert.equal(JSON.parse(values.get('forest-chopper:settings:v1'))[key],value);
  }
  assert.equal(settings[kind+'VisibilityDistance'],illumination);
  assert.equal(settings[kind+'ActivationDistance'],activation);
 }
});

test('legacy light distance migrates into activation once, then remains independent',()=>{
 const values=new Map([['forest-chopper:settings:v1',JSON.stringify({
  campfireVisibilityDistance:175,torchVisibilityDistance:40,
 })]]);
 const elements=new Map();
 const element=id=>{
  if(!elements.has(id))elements.set(id,{
   value:'',checked:false,textContent:'',style:{},setAttribute(){},querySelector:element,
  });
  return elements.get(id);
 };
 const doc={createElement:()=>({style:{},setAttribute(){},querySelector:element}),
  head:{append(){}},body:{append(){}}};
 const storage={getItem:key=>values.get(key)??null,setItem:(key,val)=>values.set(key,val)};
 const settings=createSettings(doc,storage);
 assert.equal(settings.campfireVisibilityDistance,175);
 assert.equal(settings.campfireActivationDistance,175);
 assert.equal(settings.torchVisibilityDistance,40);
 assert.equal(settings.torchActivationDistance,40);
 assert.equal(values.get('forest-chopper:fire-activation-distance:v1'),'1');
 element('#fc-light-campfireVisibilityDistance').value='30';
 element('#fc-light-campfireVisibilityDistance').oninput();
 assert.equal(settings.campfireVisibilityDistance,30);
 assert.equal(settings.campfireActivationDistance,175);
 const repeated=createSettings(doc,storage);
 assert.equal(repeated.campfireVisibilityDistance,30);
 assert.equal(repeated.campfireActivationDistance,175);
 assert.equal(repeated.torchActivationDistance,40);
});

test('per-fire shadow visibility uses independent 1–100 m sliders and preserves shadow radii',()=>{
 const defaults=sanitizeSettings(null);
 for(const kind of ['campfire','torch']){
  const key=kind+'ShadowVisibilityDistance';
  assert.deepEqual(LIGHTING_FIELDS[key].slice(0,4),[1,100,1,30]);
  assert.equal(defaults[key],60);
  assert.equal(sanitizeSettings({[key]:1})[key],1);
  assert.equal(sanitizeSettings({[key]:100})[key],100);
  assert.equal(sanitizeSettings({[key]:101})[key],60);
  assert.equal(sanitizeSettings({[key]:0})[key],60);
 }
 const values=new Map();
 const nodes=new Map();
 const element=id=>{
  if(!nodes.has(id))nodes.set(id,{
   value:'',checked:false,textContent:'',style:{},setAttribute(){},querySelector:element,
  });
  return nodes.get(id);
 };
 const doc={createElement:()=>({style:{},setAttribute(){},querySelector:element}),
  head:{append(){}},body:{append(){}}};
 const storage={getItem:key=>values.get(key)??null,setItem:(key,val)=>values.set(key,val)};
 const settings=createSettings(doc,storage);
 for(const [key,val] of [
  ['campfireShadowVisibilityDistance',30],
  ['torchShadowVisibilityDistance',75],
 ]){
  const slider=element('#fc-light-'+key);
  assert.equal(typeof slider.oninput,'function');
  slider.value=String(val);slider.oninput();
  assert.equal(settings[key],val);
  assert.equal(JSON.parse(values.get('forest-chopper:settings:v1'))[key],val);
 }
 assert.equal(settings.campfireNightRadius,7,'caster range unaffected');
 assert.equal(settings.torchNightRadius,9,'caster range unaffected');
});

test('near sunlight cascade has 2K defaults, controls for distance and blend, no refresh slider',()=>{
 const defaults=sanitizeSettings(null);
 assert.equal(defaults.sunNearShadowMapSize,2048);
 assert.equal(defaults.sunNearShadowDistance,20);
 assert.equal(defaults.sunCascadeBlendDistance,10);
 assert.equal('sunNearShadowRefreshSeconds' in defaults,false,'near shadows always render every frame');
 assert.equal(sanitizeSettings({sunNearShadowMapSize:4096}).sunNearShadowMapSize,4096);
 assert.equal(sanitizeSettings({sunNearShadowMapSize:3072}).sunNearShadowMapSize,2048);
 assert.equal(sanitizeSettings({sunNearShadowDistance:45}).sunNearShadowDistance,45);
 assert.equal(sanitizeSettings({sunNearShadowRefreshSeconds:1}).sunNearShadowRefreshSeconds,undefined);
 const saved=new Map(),nodes=new Map();
 const element=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',style:{},
    setAttribute(){},querySelector:element});
  return nodes.get(id);
 };
 const doc={createElement:()=>({hidden:false,setAttribute(){},querySelector:element}),
  head:{append(){}},body:{append(){}}};
 const storage={getItem:key=>saved.get(key)??null,setItem:(key,val)=>saved.set(key,val)};
 const settings=createSettings(doc,storage);
 for(const [key,value] of [
  ['sunNearShadowMapSize',4096],['sunNearShadowDistance',25],
  ['sunCascadeBlendDistance',6],
 ]){
  const input=element('#fc-light-'+key);
  assert.equal(typeof input.oninput,'function','control is wired: '+key);
  input.value=String(value);input.oninput();
  assert.equal(settings[key],value);
  assert.equal(JSON.parse(saved.get('forest-chopper:settings:v1'))[key],value);
 }
 assert.equal(settings.shadowMapSize,2048,'far map has its own resolution');
 assert.equal(settings.shadowDistance,60,'far shadow radius stays independent');
});


test('shadow settings have their own tab beside lighting with all controls moved',()=>{
 const source=readFileSync(new URL('../src/settings.js',import.meta.url),'utf8');
 const begin=source.indexOf('panel.innerHTML =');
 const end=source.indexOf('const fps =',begin);
 const markup=source.slice(begin,end);
 const lightingTab='data-category="lighting" aria-selected="false"';
 const shadowTab='data-category="shadows" aria-selected="false"';
 assert.ok(markup.indexOf(lightingTab)<markup.indexOf(shadowTab));
 assert.equal(markup.match(/data-category="shadows" aria-label="Тени"/g)?.length,1);
 const lightStart=markup.indexOf('data-category="lighting" aria-label="Освещение"');
 const shadowStart=markup.indexOf('data-category="shadows" aria-label="Тени"');
 const worldStart=markup.indexOf('data-category="world" aria-label="Мир"');
 const lighting=markup.slice(lightStart,shadowStart);
 const shadows=markup.slice(shadowStart,worldStart);
 for(const field of [
  'sunNearShadowDistance','sunNearShadowMapSize','sunCascadeBlendDistance',
  'sunCascadeCasterOverlap','sunNearShadowSoftness','sunFarShadowSoftness',
  'shadow-distance','shadow-map-size','shadow-refresh',
  'tree-shadows','character-shadows','character-shadow-distance','shadow-contrast',
  'campfireDayRadius','campfireNightRadius','campfireShadowVisibilityDistance',
  'torchDayRadius','torchNightRadius','torchShadowVisibilityDistance',
  'fireShadowLimit','fireShadows','nightDisableMoonShadows',
 ]){
  assert.ok(shadows.includes(field),'shadows tab contains '+field);
  assert.equal(lighting.includes(field),false,'lighting tab omits shadow setting '+field);
 }
 for(const field of ['dayAmbient','daySun','nightAmbient','nightMoon',
  'campfireDayIntensity','torchNightIntensity','campfireVisibilityDistance',
  'torchActivationDistance','flameShader','flameBillboard']){
  assert.ok(lighting.includes(field),'lighting keeps '+field);
 }
 assert.equal(shadows.includes('sunNearShadowRefreshSeconds'),false);
 assert.equal(source.includes("if(!['graphics','grass','trees','controls','pose','camera','audio','lighting','shadows','world']"),true);
 assert.equal(source.includes('const nearDue=shadowsEnabled'),false,
  'shadow tab does not accidentally own render logic');
});


test('shadow overlap and softness persist as live settings without touching old save data',()=>{
 const defaults=sanitizeSettings(null);
 assert.equal(defaults.sunCascadeCasterOverlap,4);
 assert.equal(defaults.sunNearShadowSoftness,1);
 assert.equal(defaults.sunFarShadowSoftness,1);
 assert.equal(sanitizeSettings({sunCascadeCasterOverlap:30}).sunCascadeCasterOverlap,30);
 assert.equal(sanitizeSettings({sunCascadeCasterOverlap:41}).sunCascadeCasterOverlap,4);
 assert.equal(sanitizeSettings({sunNearShadowSoftness:0}).sunNearShadowSoftness,0);
 assert.equal(sanitizeSettings({sunFarShadowSoftness:0}).sunFarShadowSoftness,0);
 assert.equal(sanitizeSettings({sunNearShadowSoftness:2.5}).sunNearShadowSoftness,2.5);
 assert.equal(sanitizeSettings({sunFarShadowSoftness:4}).sunFarShadowSoftness,4);
 const saved=new Map(),nodes=new Map();
 const element=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',style:{},
    setAttribute(){},querySelector:element});
  return nodes.get(id);
 };
 const doc={createElement:()=>({hidden:false,setAttribute(){},querySelector:element}),
  head:{append(){}},body:{append(){}}};
 const storage={getItem:key=>saved.get(key)??null,setItem:(key,val)=>saved.set(key,val)};
 const settings=createSettings(doc,storage);
 for(const [key,value] of [
  ['sunCascadeCasterOverlap',26],['sunNearShadowSoftness',2],
  ['sunFarShadowSoftness',3.5],
 ]){
  const slider=element('#fc-light-'+key);
  assert.equal(typeof slider.oninput,'function');
  slider.value=String(value);
  slider.oninput();
  assert.equal(settings[key],value);
  assert.equal(JSON.parse(saved.get('forest-chopper:settings:v1'))[key],value);
 }
});


test('all illumination and fire-radius controls render as sliders; only near map size is a select',()=>{
 for(const key of Object.keys(LIGHTING_FIELDS)){
  const html=lightingFieldMarkup(key);
  assert.match(html,new RegExp('id="fc-light-'+key+'"'));
  assert.match(html,new RegExp('id="fc-light-'+key+'-value"'));
  if(key==='sunNearShadowMapSize'){
   assert.match(html,/<select /);
   assert.equal((html.match(/<option /g)??[]).length,3);
   assert.doesNotMatch(html,/type="range"/);
  }else{
   assert.match(html,/type="range"/,'field '+key+' must use the numeric slider');
   assert.doesNotMatch(html,/<select/,'field '+key+' must not show shadow-map size options');
   const [min,max,step]=LIGHTING_FIELDS[key];
   assert.ok(html.includes('min="'+min+'"')&&html.includes('max="'+max+'"'));
   assert.ok(html.includes('step="'+step+'"'));
  }
 }
 assert.match(lightingFieldMarkup('dayAmbient'),/max="3"/);
 assert.match(lightingFieldMarkup('campfireNightIntensity'),/max="100"/);
 assert.match(lightingFieldMarkup('torchDayRadius'),/max="30"/);
 assert.match(lightingFieldMarkup('sunNearShadowSoftness'),/min="0"/);
 assert.throws(()=>lightingFieldMarkup('not-a-setting'),/Unknown/);
});

test('portable JSON export captures every current setting, preset and all tree-model profiles',()=>{
 const original=sanitizeSettings({
  performancePreset:'custom',shadowDistance:290,dayAmbient:1.75,
  sunNearShadowSoftness:0,sunFarShadowSoftness:3.5,
  audio:{master:23},
 });
 const profiles={
  low:{spruce:{seed:11},birch:{seed:12}},
  balanced:{spruce:{seed:21},birch:{seed:22}},
  high:{spruce:{seed:31},birch:{seed:32}},
 };
 const output=settingsExportJSON(original,profiles,'2026-11-03T17:20:00.000Z');
 const exported=JSON.parse(output);
 assert.equal(exported.format,'forest-chopper-settings');
 assert.equal(exported.version,1);
 assert.equal(exported.exportedAt,'2026-11-03T17:20:00.000Z');
 assert.equal(exported.performancePreset,'custom');
 assert.deepEqual(exported.settings,original);
 assert.deepEqual(Object.keys(exported.settings).sort(),Object.keys(sanitizeSettings(null)).sort());
 assert.deepEqual(exported.treeModels,{version:1,profiles});
 assert.equal(exported.settings.sunNearShadowSoftness,0);
 assert.equal(exported.settings.shadowDistance,290);
 assert.equal('world' in exported,false);
 assert.equal('seed' in exported,false);
 assert.equal('inventory' in exported,false);
 original.dayAmbient=2.95;profiles.high.spruce.seed=99;
 assert.equal(exported.settings.dayAmbient,1.75);
 assert.equal(exported.treeModels.profiles.high.spruce.seed,31,'snapshot is independent');
 assert.ok(output.includes('\n  "settings": {'),'readable indented JSON');
});

test('reviewed High preset applies every submitted FPS-affecting graphics/light/shadow field',()=>{
 const reviewed={
  renderScale:95,treeShadowsEnabled:true,shadowMapSize:2048,
  spruceFoliageVisible:true,spruceFoliageShadows:true,
  treeTrianglesSpruce:10000,treeTrianglesBirch:6500,
  grassTriangles:6,grassInteraction:true,detailedTreeRadius:2,
  farForestDistance:160,viewDistance:280,
  lakeForestMode:'shore',lakeVisibility:true,lakeViewDistance:380,
  farTreeDensity:50,farSpruceTriangles:2000,farBirchTriangles:1200,
  terrainSegments:48,waterQuality:'high',decorDensity:50,antialias:false,
  spruceFoliageDensity:100,windEnabled:true,
  dayAmbient:1.2,daySun:2,nightAmbient:0,nightMoon:0,nightViewDistance:60,
  fireShadowLimit:4,sunNearShadowDistance:20,sunNearShadowMapSize:2048,
  sunCascadeBlendDistance:10,sunCascadeCasterOverlap:4,
  sunNearShadowSoftness:1,sunFarShadowSoftness:1,
  campfireDayIntensity:5,campfireNightIntensity:10,
  campfireDayRadius:7,campfireNightRadius:7,
  campfireShadowVisibilityDistance:60,campfireVisibilityDistance:30,
  campfireActivationDistance:60,campfireDecay:1,campfireLightHeight:1.5,
  torchDayIntensity:5,torchNightIntensity:8,
  torchDayRadius:3,torchNightRadius:9,
  torchShadowVisibilityDistance:60,torchVisibilityDistance:30,
  torchActivationDistance:60,torchDecay:1,torchLightHeight:2.8,
  flameShader:true,flameBillboard:false,fireShadows:true,nightDisableMoonShadows:true,
  quality:'high',maxFps:0,shadowDistance:60,shadowRefreshSeconds:20,
  characterShadowsEnabled:true,characterShadowDistance:62,shadowContrast:100,
  grassDensity:30,grassDistance:100,grassMinSize:2.5,grassMaxSize:5.5,
  grassWidth:1,grassFullDensityDistance:10,grassFarDensityPercent:0,
  grassFarWidthBonus:30,grassDensitySharpness:.000001,grassDensityCoefficient:0,grassDensityOffset:30,grassTurnMin:-30,grassTurnMax:30,
 };
 const combined={...PERFORMANCE_PRESETS.high,...PERFORMANCE_LIGHTING_PRESETS.high};
 assert.deepEqual(combined,reviewed,'high preset matches all requested render-impacting settings');
 for(const disallowed of ['mouseSensitivity','showFps','autoSprint','dayCycleEnabled',
   'fov','cameraHeight','cameraSide','cameraDistance','cameraPitchLimit']){
  assert.equal(disallowed in combined,false,disallowed+' is not an FPS preset field');
 }
 const active=sanitizeSettings({performancePreset:'high',...combined});
 for(const [key,value] of Object.entries(reviewed))
  assert.equal(active[key],value,'sanitized High preserves '+key);
 const clean=sanitizeSettings(null);
 for(const [key,value] of Object.entries(reviewed))
  assert.equal(clean[key],value,'default High starts with '+key);
});

test('selecting High after another preset refreshes lighting and retains controls',()=>{
 const nodes=new Map();
 const element=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',style:{},
    setAttribute(){},querySelector:element});
  return nodes.get(id);
 };
 const doc={createElement:()=>({hidden:false,textContent:'',style:{},
    setAttribute(){},querySelector:element}),
  head:{append(){}},body:{append(){}}};
 const saved=new Map();
 const storage={getItem:key=>saved.get(key)??null,
   setItem:(key,val)=>saved.set(key,val)};
 const cfg=createSettings(doc,storage);
 element('#fc-quality').value='ultra';element('#fc-quality').onchange();
 assert.equal(cfg.shadowDistance,250);
 assert.equal(cfg.sunNearShadowDistance,20,'another preset leaves light values intact');
 element('#fc-sensitivity').value='2.1';element('#fc-sensitivity').oninput();
 element('#fc-camera-height').value='3';element('#fc-camera-height').oninput({target:element('#fc-camera-height')});
 element('#fc-light-campfireNightIntensity').value='44';
 element('#fc-light-campfireNightIntensity').oninput();
 assert.equal(cfg.campfireNightIntensity,44);
 const result=cfg.setPerformancePreset('high');
 assert.equal(result.preset,'high');
 assert.equal(cfg.quality,'high');
 assert.equal(cfg.maxFps,0);
 assert.equal(cfg.shadowDistance,60);
 assert.equal(cfg.sunNearShadowDistance,20);
 assert.equal(cfg.campfireNightIntensity,10);
 assert.equal(cfg.flameBillboard,false);
 assert.equal(cfg.mouseSensitivity,2.1,'sensitivity is not overwritten by graphics preset');
 assert.equal(cfg.cameraHeight,3,'camera is not overwritten by graphics preset');
 assert.equal(JSON.parse(saved.get('forest-chopper:settings:v1')).performancePreset,'high');
});

test('initial High moon darkness and 60m night view survive legacy migrations',()=>{
 const saved=new Map();
 const nodes=new Map();
 const element=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',style:{},
    setAttribute(){},querySelector:element});
  return nodes.get(id);
 };
 const doc={createElement:()=>({hidden:false,style:{},setAttribute(){},querySelector:element}),
  head:{append(){}},body:{append(){}}};
 const storage={getItem:key=>saved.get(key)??null,
  setItem:(key,val)=>saved.set(key,val)};
 const first=createSettings(doc,storage);
 first.setPerformancePreset('high');
 assert.equal(first.nightMoon,0);
 assert.equal(first.nightViewDistance,60);
 const second=createSettings(doc,storage);
 assert.equal(second.nightMoon,0,'old moon migration must not override new High moon=0');
 assert.equal(second.nightViewDistance,60,'old 30m migration must not override High night view=60');
});


test('grass LOD controls save live floats, mark custom preset, and restore values',()=>{
  const nodes=new Map(),saved=[];
  const floatInputs=new Set(['#fc-grass-density-sharpness',
    '#fc-grass-density-coefficient','#fc-grass-density-offset']);
  const element=id=>{
    if(!nodes.has(id))nodes.set(id,{
      value:'',type:floatInputs.has(id)?'number':'range',
      checked:false,textContent:'',style:{},setAttribute(){},querySelector:element,
    });
    return nodes.get(id);
  };
  const doc={
    createElement:()=>({hidden:false,textContent:'',style:{},setAttribute(){},querySelector:element}),
    head:{append(){}},body:{append(){}},
  };
  let lastSaved=null;
  const storage={
    getItem:()=>lastSaved,
    setItem(k,v){lastSaved=v;saved.push(JSON.parse(v));},
  };
  const settings=createSettings(doc,storage);
  const config=[
    ['#fc-grass-full-density-distance','grassFullDensityDistance',10],
    ['#fc-grass-far-density-percent','grassFarDensityPercent',65],
    ['#fc-grass-density-sharpness','grassDensitySharpness',.004505],
    ['#fc-grass-density-coefficient','grassDensityCoefficient',1.2375],
    ['#fc-grass-density-offset','grassDensityOffset',2.125],
    ['#fc-grass-far-width-bonus','grassFarWidthBonus',55],
  ];
  for(const [selector,key,value] of config){
    const slider=element(selector);
    slider.value=String(value);
    if(['grassDensitySharpness','grassDensityCoefficient','grassDensityOffset'].includes(key)){
      slider.onchange();
    }else slider.oninput();
    assert.equal(settings[key],value);
    if(!floatInputs.has(selector))
      assert.equal(element(selector+'-value').textContent,String(value));
    assert.equal(saved.at(-1)[key],value);
  }
  assert.equal(settings.performancePreset,'custom');
  const reloaded=createSettings(doc,storage);
  for(const [,key,value] of config)assert.equal(reloaded[key],value);
});

test('grass formula float coefficients accept arbitrary finite numbers',()=>{
  const vals={grassDensitySharpness:-7.1234567,grassDensityCoefficient:1234.98765,grassDensityOffset:-8.25};
  const settings=sanitizeSettings(vals);
  for(const [k,v] of Object.entries(vals))assert.equal(settings[k],v);
  for(const key of Object.keys(vals)){
    assert.equal(sanitizeSettings({[key]:Infinity})[key],defaults[key]);
    assert.equal(sanitizeSettings({[key]:NaN})[key],defaults[key]);
  }
  assert.equal(sanitizeSettings({grassDensitySharpness:.010005}).grassDensitySharpness,.010005);
});


test('grass performance presets retain tuned formula and density/distance tiers',()=>{
  const tiers={
    ultra:[30,100,.0001],
    high:[30,100,.000001],
    medium:[25,60,.000001],
    low:[20,30,.000001],
  };
  for(const [tier,[density,distance,k]] of Object.entries(tiers)){
    const preset=PERFORMANCE_PRESETS[tier];
    assert.equal(preset.grassDensity,density,tier);
    assert.equal(preset.grassDistance,distance,tier);
    assert.equal(preset.grassFullDensityDistance,10,tier);
    assert.equal(preset.grassFarDensityPercent,0,tier);
    assert.equal(preset.grassDensitySharpness,k,tier);
    assert.equal(preset.grassDensityCoefficient,0,tier);
    assert.equal(preset.grassDensityOffset,30,tier);
    const validated=sanitizeSettings({...preset,performancePreset:tier});
    for(const key of ['grassDensity','grassDistance','grassFullDensityDistance',
      'grassFarDensityPercent','grassDensitySharpness','grassDensityCoefficient','grassDensityOffset'])
      assert.equal(validated[key],preset[key],tier+' validates '+key);
  }
});

test('touch control visibility is applied immediately and saved independently of world state',()=>{
 const elements=new Map(),classes=new Map(),writes=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{style:{},checked:false,setAttribute(){},querySelector:element});return elements.get(id);};
 const doc={createElement:()=>({hidden:false,setAttribute(){},querySelector:element}),head:{append(){}},body:{append(){},classList:{toggle(key,value){classes.set(key,value);}}}};
 const storage={getItem:()=>JSON.stringify({showTouchControls:false}),setItem:(key,value)=>writes.push(JSON.parse(value))};
 const settings=createSettings(doc,storage);
 assert.equal(settings.showTouchControls,false);
 assert.equal(classes.get('hide-touch-controls'),true);
 const checkbox=element('#fc-touch-controls');checkbox.checked=true;checkbox.onchange();
 assert.equal(settings.showTouchControls,true);assert.equal(classes.get('hide-touch-controls'),false);
 assert.equal(writes.at(-1).showTouchControls,true);
});


test('pose sliders have safe ranges, validated defaults, and no effect on graphics presets',()=>{
 const defaults=sanitizeSettings(null);
 assert.deepEqual([defaults.lookTorsoYaw,defaults.lookHeadYaw,defaults.lookFreeYaw],
  [60,60,120]);
 assert.equal(Object.keys(CHARACTER_LOOK_FIELDS).length,12);
 assert.deepEqual(CHARACTER_LOOK_FIELDS.lookRunYawReduction.slice(0,4),[1,10,1,1]);
 assert.equal(sanitizeSettings({lookRunYawReduction:5}).lookRunYawReduction,5);
 assert.equal(sanitizeSettings({lookRunYawReduction:11}).lookRunYawReduction,1);
 for(const [key,[min,max,step,fallback,label,unit]] of Object.entries(CHARACTER_LOOK_FIELDS)){
  assert.equal(defaults[key],fallback,key);
  const html=lookRangeMarkup(key);
  assert.ok(html.includes('id="fc-look-'+key+'"'),key);
  assert.ok(html.includes('min="'+min+'"'),key);
  assert.ok(html.includes('max="'+max+'"'),key);
  assert.ok(html.includes('step="'+step+'"'),key);
  assert.ok(html.includes(label),key);
  assert.ok(html.includes(unit),key);
  assert.equal(sanitizeSettings({[key]:min})[key],min,key+' lower bound');
  assert.equal(sanitizeSettings({[key]:max})[key],max,key+' upper bound');
  for(const bad of [min-1,max+1,'80',NaN,Infinity,-Infinity,{},null])
   assert.equal(sanitizeSettings({[key]:bad})[key],fallback,
    key+' rejects invalid value');
 }
 assert.throws(()=>lookRangeMarkup('not-a-key'),/Unknown character pose setting/);
 const custom=sanitizeSettings({lookTorsoYaw:55,lookHeadYaw:70,lookFreeYaw:125});
 assert.deepEqual([custom.lookTorsoYaw,custom.lookHeadYaw,custom.lookFreeYaw],[55,70,125]);
 const low=sanitizeSettings({...custom,performancePreset:'low'});
 assert.equal(low.lookTorsoYaw,55,'performance preset must not reset anatomy');
});

test('pose slider inputs apply live, persist across sessions, and reset without clearing camera',()=>{
 const elements=new Map(),values=new Map();
 const element=id=>{
  if(!elements.has(id))elements.set(id,{value:'',checked:false,style:{},textContent:'',
   setAttribute(){},querySelector:element});
  return elements.get(id);
 };
 const panels=[];
 const doc={
  createElement:tag=>{
   const node={tag,hidden:false,innerHTML:'',setAttribute(){},querySelector:element};
   panels.push(node);
   return node;
  },
  head:{append(){}},body:{append(){}},
 };
 const storage={
  getItem:key=>values.get(key)??null,
  setItem:(key,value)=>values.set(key,value),
 };
 const initial=createSettings(doc,storage);
 const sectionMarkup=panels.map(node=>node.innerHTML).join(' ');
 assert.ok(sectionMarkup.includes('data-category="pose" aria-label="Поза персонажа"'));
 assert.ok(sectionMarkup.includes('data-category="pose" aria-selected="false"'));
 for(const key of Object.keys(CHARACTER_LOOK_FIELDS)){
  assert.equal(typeof element('#fc-look-'+key).oninput,'function',key);
  assert.equal(element('#fc-look-'+key).value,
   String(CHARACTER_LOOK_FIELDS[key][3]),key);
 }
 assert.equal(initial.lookSettings.lookTorsoYaw,60);
 const chest=element('#fc-look-lookTorsoYaw');
 chest.value='65';chest.oninput();
 assert.equal(initial.lookSettings.lookTorsoYaw,65);
 assert.equal(element('#fc-look-lookTorsoYaw-value').textContent,'65');
 const neck=element('#fc-look-lookHeadYaw');
 neck.value='95';neck.oninput();
 const free=element('#fc-look-lookFreeYaw');
 free.value='180';free.oninput();
 const runReduction=element('#fc-look-lookRunYawReduction');
 runReduction.value='5';runReduction.oninput();
 assert.equal(initial.lookSettings.lookRunYawReduction,5);
 assert.equal(element('#fc-look-lookRunYawReduction-value').textContent,'5');
 assert.deepEqual([
  initial.lookSettings.lookTorsoYaw,
  initial.lookSettings.lookHeadYaw,
  initial.lookSettings.lookFreeYaw,
 ],[65,95,180]);
 const stored=JSON.parse(values.get('forest-chopper:settings:v1'));
 assert.deepEqual([stored.lookTorsoYaw,stored.lookHeadYaw,stored.lookFreeYaw],
  [65,95,180]);
 assert.equal(stored.position,undefined,'pose must live in settings, never world saves');
 assert.equal(stored.lookRunYawReduction,5,'run limit divisor is persisted');
 const reloaded=createSettings(doc,storage);
 assert.deepEqual([reloaded.lookSettings.lookTorsoYaw,
  reloaded.lookSettings.lookHeadYaw,reloaded.lookSettings.lookFreeYaw],
  [65,95,180]);
 assert.equal(reloaded.lookSettings.lookRunYawReduction,5);
 const camera=element('#fc-camera-pitch-limit');
 camera.value='35';camera.oninput({target:camera});
 const speed=element('#fc-look-lookHeadTurnSpeed');
 speed.value='8';speed.oninput();
 assert.equal(reloaded.lookSettings.lookHeadTurnSpeed,8);
 element('#fc-look-defaults').onclick();
 assert.equal(reloaded.cameraPitchLimit,35);
 assert.deepEqual([
  reloaded.lookSettings.lookTorsoYaw,
  reloaded.lookSettings.lookHeadYaw,
  reloaded.lookSettings.lookFreeYaw,
  reloaded.lookSettings.lookHeadTurnSpeed,
 ],[60,60,120,14]);
 assert.equal(reloaded.lookSettings.lookRunYawReduction,1,'pose reset restores 1x');
 assert.equal(JSON.parse(values.get('forest-chopper:settings:v1')).cameraPitchLimit,35);
 element('#fc-reset-settings').onclick();
 assert.equal(reloaded.lookSettings.lookFreeYaw,120);
 assert.equal(reloaded.cameraPitchLimit,80,'full reset still resets everything');
});
