// Lightweight client-only preferences. No framework or new dependencies.
import {collectDiagnostics, formatDiagnostics, getGpuRendererName} from './diagnostics.js?v=20261101-gpu-renderer1';
import {FPS_OPTIONS} from './frame-limiter.js';
import {treeModelEditorMarkup,mountTreeModelEditor} from './tree-model-editor.js?v=20261103-shared-birch-all1';
import {PERFORMANCE_PRESETS,PERFORMANCE_KEYS,PERFORMANCE_DEFAULTS,PERFORMANCE_LIGHTING_PRESETS} from './performance-presets.js?v=20261103-grass-presets-tuned1';
import {SOUND_CONTROLS,AXE_VARIANTS,VOICE_VARIANTS,DEFAULT_AUDIO,sanitizeAudioSettings} from './sound-rules.js?v=20261102-jump-voices1';
const KEY = 'forest-chopper:settings:v1';
export const LIGHTING_FIELDS=Object.freeze({
 dayAmbient:[0,3,.05,1.2,'☀️ Рассеянный свет дня'],
 daySun:[0,5,.05,2,'☀️ Солнечный свет'],
 nightAmbient:[0,1,.005,0,'🌙 Рассеянный свет ночи'],
 nightMoon:[0,1,.005,.2,'🌙 Лунный свет'],
 nightViewDistance:[30,160,5,30,'🌑 Дальность ночной видимости, м'],
 fireShadowLimit:[0,4,1,2,'Количество источников с обновляемыми тенями'],
 sunNearShadowDistance:[10,60,5,30,'Граница чётких солнечных теней, м'],
 sunNearShadowMapSize:[1024,4096,1024,2048,'Разрешение ближней карты теней'],
 sunCascadeBlendDistance:[0,10,1,4,'Ширина плавного перехода, м'],
 sunCascadeCasterOverlap:[0,40,2,12,'Запас перекрытия каскадов, м'],
 sunNearShadowSoftness:[0,4,.5,1,'Мягкость ближних солнечных теней, тексели'],
 sunFarShadowSoftness:[0,4,.5,1.5,'Мягкость дальних солнечных теней, тексели'],
 campfireDayIntensity:[1,100,.1,1.3,'День · яркость'],
 campfireNightIntensity:[1,100,.1,30,'Ночь · яркость'],
 campfireDayRadius:[1,30,1,7,'День · радиус расчёта теней, м'],
 campfireNightRadius:[1,30,1,30,'Ночь · радиус расчёта теней, м'],
 campfireShadowVisibilityDistance:[1,100,1,30,'Дальность видимости теней, м'],
 campfireVisibilityDistance:[10,250,5,100,'Радиус освещения (PointLight.distance), м'],
 campfireActivationDistance:[10,250,5,100,'Дальность видимости лампы (от игрока), м'],
 campfireDecay:[0,3,.1,2,'Затухание света (decay)'],
 campfireLightHeight:[.2,4,.05,1.5,'Высота света над основанием, м'],
 torchDayIntensity:[1,100,.1,1.1,'День · яркость'],
 torchNightIntensity:[1,100,.1,30,'Ночь · яркость'],
 torchDayRadius:[1,30,1,6,'День · радиус расчёта теней, м'],
 torchNightRadius:[1,30,1,30,'Ночь · радиус расчёта теней, м'],
 torchShadowVisibilityDistance:[1,100,1,30,'Дальность видимости теней, м'],
 torchVisibilityDistance:[10,250,5,100,'Радиус освещения (PointLight.distance), м'],
 torchActivationDistance:[10,250,5,100,'Дальность видимости лампы (от игрока), м'],
 torchDecay:[0,3,.1,2,'Затухание света (decay)'],
 torchLightHeight:[.2,4,.05,2.23,'Высота света над основанием, м'],
});
export const LIGHTING_FLAGS=Object.freeze({
 flameShader:true,flameBillboard:true,fireShadows:true,nightDisableMoonShadows:true,
});
const CAMERA_80_MIGRATION = 'forest-chopper:camera-80-default:v1';
const AUDIO_REWORK_MIGRATION='forest-chopper:audio-rework-defaults:v2';
const VOICE_MIGRATION='forest-chopper:voice-samples:v3';
const NIGHT_PROFILE_MIGRATION='forest-chopper:night-profile-defaults:v1';
const MOONLIGHT_MIGRATION='forest-chopper:night-moon-default:v1';
const NIGHT_VISIBILITY_30_MIGRATION='forest-chopper:night-visibility-30-default:v1';
const CSM_FAR_MIGRATION='forest-chopper:far-cascade-range:v1';
const FIRE_ACTIVATION_MIGRATION='forest-chopper:fire-activation-distance:v1';
const PREVIOUS_LIGHTING_DEFAULTS=Object.freeze({
 shadowContrast:70,dayAmbient:2.1,daySun:2.3,nightAmbient:.06,nightMoon:.025,
 nightViewDistance:100,campfireNightIntensity:4,campfireNightRadius:20,
 torchNightIntensity:3.3,torchNightRadius:16,
});
const DEFAULT=Object.freeze({
 ...PERFORMANCE_DEFAULTS,performancePreset:'high',
 mouseSensitivity:1,showFps:false,dayCycleEnabled:false,autoSprint:false,fov:75,
 cameraHeight:2.3,cameraSide:.4,cameraDistance:1.7,cameraPitchLimit:80,
 audio:DEFAULT_AUDIO,
 ...Object.fromEntries(Object.entries(LIGHTING_FIELDS).map(([key,val])=>[key,val[3]])),
 ...LIGHTING_FLAGS,
 ...PERFORMANCE_LIGHTING_PRESETS.high,
});

function validCameraNumber(value,min,max,fallback,digits=2){
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)return fallback;
  const factor=10**digits;
  return Math.round(value*factor)/factor;
}

export function sanitizeSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const number = Number(source.mouseSensitivity);
  const fov = Number(source.fov);
  const performancePreset=['ultra','high','medium','low','custom'].includes(source.performancePreset)
    ?source.performancePreset:(source.quality?'custom':'high');
  const settings = {
    audio:sanitizeAudioSettings(source.audio),
    performancePreset,
    ...Object.fromEntries(PERFORMANCE_KEYS.filter(key=>!(key in {
      quality:1,maxFps:1,windEnabled:1,shadowDistance:1,shadowRefreshSeconds:1,
      characterShadowsEnabled:1,characterShadowDistance:1,spruceFoliageDensity:1,
      grassDensity:1,grassDistance:1,grassMinSize:1,grassMaxSize:1,grassWidth:1,
      grassFullDensityDistance:1,grassFarDensityPercent:1,grassFarWidthBonus:1,
      grassDensitySharpness:1,grassDensityCoefficient:1,grassDensityOffset:1,
      grassTurnMin:1,grassTurnMax:1,shadowContrast:1,
    })).map(key=>[key,
      typeof PERFORMANCE_DEFAULTS[key]==='number'
        ? (Number.isFinite(source[key])?source[key]:PERFORMANCE_DEFAULTS[key])
        : (typeof source[key]===typeof PERFORMANCE_DEFAULTS[key]
          ?source[key]:PERFORMANCE_DEFAULTS[key])
    ])),
    mouseSensitivity: Number.isFinite(number) && number >= .4 && number <= 2.5
      ? Math.round(number * 10) / 10 : DEFAULT.mouseSensitivity,
    showFps: source.showFps === true,
    spruceFoliageVisible: source.spruceFoliageVisible !== false,
    spruceFoliageShadows: source.spruceFoliageShadows !== false,
    spruceFoliageDensity: Number.isInteger(source.spruceFoliageDensity)
      && source.spruceFoliageDensity>=0 && source.spruceFoliageDensity<=100
      && source.spruceFoliageDensity%5===0
      ? source.spruceFoliageDensity : DEFAULT.spruceFoliageDensity,
    windEnabled: source.windEnabled !== false,
    dayCycleEnabled: source.dayCycleEnabled === true,
    ...Object.fromEntries(Object.entries(LIGHTING_FIELDS).map(([key,[min,max,step,fallback]])=>{
      const value=source[key];
      const presetFallback=performancePreset==='high'?DEFAULT[key]:fallback;
      return [key,typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max
        ?Number((Math.round(value/step)*step).toFixed(4)):presetFallback];
    })),
    ...Object.fromEntries(Object.entries(LIGHTING_FLAGS).map(([key,fallback])=>
      [key,typeof source[key]==='boolean'?source[key]:
        performancePreset==='high'?DEFAULT[key]:fallback])),
    autoSprint: source.autoSprint === true,
    quality: ['low','balanced','high'].includes(source.quality) ? source.quality : DEFAULT.quality,
    maxFps: FPS_OPTIONS.includes(source.maxFps) ? source.maxFps : DEFAULT.maxFps,
    shadowDistance: Number.isInteger(source.shadowDistance) && source.shadowDistance >= 60
      && source.shadowDistance <= 350 ? source.shadowDistance : DEFAULT.shadowDistance,
    shadowRefreshSeconds: Number.isFinite(source.shadowRefreshSeconds)
      && source.shadowRefreshSeconds >= 0 && source.shadowRefreshSeconds <= 20
      ? Math.round(source.shadowRefreshSeconds * 2) / 2 : DEFAULT.shadowRefreshSeconds,
    // Read both the old 0–60 FPS slider and the original checkbox setting.
    characterShadowsEnabled: source.characterShadowsEnabled === false
      || (source.characterShadowsEnabled === undefined && source.characterShadowFps === 0)
      ? false : true,
    characterShadowDistance: Number.isInteger(source.characterShadowDistance)
      && source.characterShadowDistance >= 10 && source.characterShadowDistance <= 100
      ? source.characterShadowDistance : DEFAULT.characterShadowDistance,
    shadowContrast: Number.isInteger(source.shadowContrast) && source.shadowContrast >= 0
      && source.shadowContrast <= 100 ? source.shadowContrast : DEFAULT.shadowContrast,
    grassDensity: Number.isInteger(source.grassDensity) && source.grassDensity >= 1
      && source.grassDensity <= 50 ? source.grassDensity : DEFAULT.grassDensity,
    grassDistance: Number.isInteger(source.grassDistance) && source.grassDistance >= 12
      && source.grassDistance <= 100 ? source.grassDistance : DEFAULT.grassDistance,
    grassMinSize: Number.isFinite(source.grassMinSize) && source.grassMinSize >= 1
      && source.grassMinSize <= 8 ? Math.round(source.grassMinSize * 4) / 4 : DEFAULT.grassMinSize,
    grassMaxSize: Number.isFinite(source.grassMaxSize) && source.grassMaxSize >= 1
      && source.grassMaxSize <= 8 ? Math.round(source.grassMaxSize * 4) / 4 : DEFAULT.grassMaxSize,
    grassWidth: Number.isFinite(source.grassWidth) && source.grassWidth >= .25
      && source.grassWidth <= 4 ? Math.round(source.grassWidth * 4) / 4 : DEFAULT.grassWidth,
    grassFullDensityDistance: Number.isInteger(source.grassFullDensityDistance)
      && source.grassFullDensityDistance >= 0 && source.grassFullDensityDistance <= 30
      ? source.grassFullDensityDistance : DEFAULT.grassFullDensityDistance,
    grassFarDensityPercent: Number.isInteger(source.grassFarDensityPercent)
      && source.grassFarDensityPercent >= 0 && source.grassFarDensityPercent <= 100
      ? source.grassFarDensityPercent : DEFAULT.grassFarDensityPercent,
    grassFarWidthBonus: Number.isInteger(source.grassFarWidthBonus)
      && source.grassFarWidthBonus >= 0 && source.grassFarWidthBonus <= 100
      ? source.grassFarWidthBonus : DEFAULT.grassFarWidthBonus,
    // Experimental shape parameters accept any finite floating-point value.
    grassDensitySharpness: Number.isFinite(source.grassDensitySharpness)
      ? source.grassDensitySharpness : DEFAULT.grassDensitySharpness,
    grassDensityCoefficient: Number.isFinite(source.grassDensityCoefficient)
      ? source.grassDensityCoefficient : DEFAULT.grassDensityCoefficient,
    grassDensityOffset: Number.isFinite(source.grassDensityOffset)
      ? source.grassDensityOffset : DEFAULT.grassDensityOffset,
    grassTurnMin: Number.isInteger(source.grassTurnMin) && source.grassTurnMin >= -90
      && source.grassTurnMin <= 0 ? source.grassTurnMin : DEFAULT.grassTurnMin,
    grassTurnMax: Number.isInteger(source.grassTurnMax) && source.grassTurnMax >= 0
      && source.grassTurnMax <= 90 ? source.grassTurnMax : DEFAULT.grassTurnMax,
    fov: Number.isFinite(fov) && fov >= 65 && fov <= 95
      ? Math.round(fov / 5) * 5 : DEFAULT.fov,
    cameraHeight: validCameraNumber(source.cameraHeight,.6,3.5,DEFAULT.cameraHeight),
    cameraSide: validCameraNumber(source.cameraSide,-1.5,1.5,DEFAULT.cameraSide),
    cameraDistance: validCameraNumber(source.cameraDistance,1.2,6,DEFAULT.cameraDistance),
    cameraPitchLimit: validCameraNumber(source.cameraPitchLimit,10,80,DEFAULT.cameraPitchLimit,0),
  };
  const ranges={
    renderScale:[50,125,5],shadowMapSize:[512,4096,512],treeTrianglesSpruce:[2000,40000,500],
    treeTrianglesBirch:[1200,25000,100],
    grassTriangles:[1,6,1],detailedTreeRadius:[2,5,1],
    farForestDistance:[90,450,5],viewDistance:[160,500,10],
    lakeViewDistance:[160,500,10],farTreeDensity:[0,100,5],
    farSpruceTriangles:[800,5000,100],farBirchTriangles:[600,3500,100],
    terrainSegments:[16,64,8],decorDensity:[0,100,5],
  };
  for(const [key,[min,max,step]] of Object.entries(ranges)){
    const value=source[key];
    settings[key]=typeof value==='number'&&Number.isFinite(value)&&value>=min
      &&value<=max ?Math.round(value/step)*step:PERFORMANCE_DEFAULTS[key];
  }
  if(![1,3,6].includes(settings.grassTriangles))settings.grassTriangles=6;
  if(![512,1024,2048,4096].includes(settings.shadowMapSize))settings.shadowMapSize=1024;
  if(![1024,2048,4096].includes(settings.sunNearShadowMapSize))
    settings.sunNearShadowMapSize=2048;
  if(!['off','shore','full'].includes(settings.lakeForestMode))
    settings.lakeForestMode=PERFORMANCE_DEFAULTS.lakeForestMode;
  if(!['simple','high'].includes(settings.waterQuality))
    settings.waterQuality=PERFORMANCE_DEFAULTS.waterQuality;
  if(settings.grassMinSize > settings.grassMaxSize)
    [settings.grassMinSize,settings.grassMaxSize] = [settings.grassMaxSize,settings.grassMinSize];
  return settings;
}

// The same control renderer is used by every light and shadow group.
export function lightingFieldMarkup(key){
 const spec=LIGHTING_FIELDS[key];
 if(!spec)throw Error('Unknown lighting setting: '+key);
 const [min,max,step,,label]=spec;
 if(key==='sunNearShadowMapSize'){
  return `<label>${label}: <output id="fc-light-${key}-value"></output>
    <select id="fc-light-${key}">
      <option value="1024">1024 × 1024</option>
      <option value="2048">2048 × 2048</option>
      <option value="4096">4096 × 4096</option>
    </select></label>`;
 }
 return `<label>${label}: <output id="fc-light-${key}-value"></output>
   <input id="fc-light-${key}" type="range" min="${min}" max="${max}" step="${step}"></label>`;
}

// Portable snapshot: current values and tree generator profiles, no world save.
export function settingsExportJSON(settings,treeProfiles,exportedAt=new Date().toISOString()){
 return JSON.stringify({
  format:'forest-chopper-settings',version:1,exportedAt,
  performancePreset:settings.performancePreset,
  settings:JSON.parse(JSON.stringify(settings)),
  treeModels:{version:1,profiles:JSON.parse(JSON.stringify(treeProfiles))},
 },null,2);
}

export function createSettings(doc = document, storage = null, onFovChange = null, onQualityChange = null, treeModelStats = null, onPerformanceChange = null, onSoundPreview = null) {
  let persisted;
  try {
    const local = storage ?? window.localStorage;
    persisted = JSON.parse(local.getItem(KEY) || 'null');
    storage = local;
    // Old untouched defaults should adopt the quieter reviewed recordings.
    // Preserve every custom audio value and run only once per browser profile.
    if(persisted?.audio && !local.getItem(AUDIO_REWORK_MIGRATION)){
      const changed={fire:[60,40],water:[38,40],forest:[42,40],hurtFemale:[78,0]};
      for(const [key,[oldVolume,newVolume]] of Object.entries(changed)){
        if(persisted.audio[key]===oldVolume)persisted.audio[key]=newVolume;
      }
      local.setItem(KEY,JSON.stringify(persisted));
      local.setItem(AUDIO_REWORK_MIGRATION,'1');
    }
    // Female pain recordings were previously unavailable and defaulted to 0.
    // Enable the newly approved sample set once, preserving all other volumes.
    if(persisted?.audio && !local.getItem(VOICE_MIGRATION)){
      if(persisted.audio.hurtFemale===0)persisted.audio.hurtFemale=78;
      local.setItem(KEY,JSON.stringify(persisted));
      local.setItem(VOICE_MIGRATION,'1');
    }
    // One-time adoption of the new defaults without overwriting custom values.
    if(persisted&&!local.getItem(NIGHT_PROFILE_MIGRATION)){
      for(const [key,oldValue] of Object.entries(PREVIOUS_LIGHTING_DEFAULTS)){
        if(persisted[key]===oldValue)persisted[key]=
          key==='shadowContrast'?100:LIGHTING_FIELDS[key]?.[3];
      }
      local.setItem(KEY,JSON.stringify(persisted));
      local.setItem(NIGHT_PROFILE_MIGRATION,'1');
    }
    // A saved 0 was the previous moonlight default. Upgrade that default
    // once, while leaving custom nonzero values untouched.
    if(persisted&&!local.getItem(MOONLIGHT_MIGRATION)){
      if(persisted.nightMoon===0&&persisted.performancePreset!=='high'){
        persisted.nightMoon=LIGHTING_FIELDS.nightMoon[3];
        local.setItem(KEY,JSON.stringify(persisted));
      }
      local.setItem(MOONLIGHT_MIGRATION,'1');
    }
    // Replace only the last night-visibility default (60 m) with 30 m.
    // A deliberately customized range other than 60 m is preserved.
    if(persisted&&!local.getItem(NIGHT_VISIBILITY_30_MIGRATION)){
      if(persisted.nightViewDistance===60&&persisted.performancePreset!=='high'){
        persisted.nightViewDistance=LIGHTING_FIELDS.nightViewDistance[3];
        local.setItem(KEY,JSON.stringify(persisted));
      }
      local.setItem(NIGHT_VISIBILITY_30_MIGRATION,'1');
    }
    // The old far range was only 60m and mostly covered near trees. Change
    // untouched per-preset defaults once; keep custom nondefault ranges.
    if(persisted&&!local.getItem(CSM_FAR_MIGRATION)){
      const previous={high:[60,150],ultra:[100,250],medium:[40,90],low:[20,60]};
      const candidate=previous[persisted.performancePreset];
      if(candidate&&persisted.shadowDistance===candidate[0])
        persisted.shadowDistance=candidate[1];
      local.setItem(KEY,JSON.stringify(persisted));
      local.setItem(CSM_FAR_MIGRATION,'1');
    }
    // A former single slider controlled both light attenuation and the
    // distance at which the game hid its PointLight. Preserve that culling
    // distance for existing saves; from now on the values are independent.
    if(persisted&&!local.getItem(FIRE_ACTIVATION_MIGRATION)){
      for(const kind of ['campfire','torch']){
        const key=kind+'ActivationDistance';
        const previous=persisted[kind+'VisibilityDistance'];
        if(persisted[key]===undefined&&Number.isFinite(previous)&&previous>=10&&previous<=250){
          persisted[key]=previous;
        }
      }
      local.setItem(KEY,JSON.stringify(persisted));
      local.setItem(FIRE_ACTIVATION_MIGRATION,'1');
    }
    // The previous third-person default was ±40°. Upgrade existing saved
    // defaults once, without overriding future user choices of ±40°.
    if(persisted?.cameraPitchLimit === 40 && local.getItem(CAMERA_80_MIGRATION) !== '1'){
      persisted.cameraPitchLimit=80;
      local.setItem(KEY,JSON.stringify(persisted));
      local.setItem(CAMERA_80_MIGRATION,'1');
    }
  } catch {
    persisted = null;
    storage = null;
  }
  const state = sanitizeSettings(persisted);
  let connected = false, latency = null, lastRate = null, lastPhysicsRate = null, lastCpuMs = null, lastGpuMs = null, gpuTimingSupported = null, lastDiagnostics = '', lastPosition = '', lastGpu = null;
  let profilerSampling=false;
  const performanceSampling=()=>state.showFps||profilerSampling;
  const css = doc.createElement('style');
  css.textContent = `
.fc-settings-toggle{position:fixed;top:55px;right:16px;z-index:12;border-radius:9px;padding:9px 12px;font-size:12px}
/* In-game graphics changes must remain visible through the backdrop. */
.fc-settings-backdrop{position:fixed;inset:0;z-index:28;background:transparent;backdrop-filter:none}
/* The main menu still benefits from its regular dimmed modal backdrop. */
.fc-settings-backdrop-menu{background:#020f0bcc;backdrop-filter:blur(3px)}
.fc-settings{position:fixed;z-index:29;left:50%;top:50%;transform:translate(-50%,-50%);width:min(700px,calc(100vw - 28px));max-height:min(680px,calc(100dvh - 28px));display:flex;flex-direction:column;overflow:hidden;background:#10251ff7;color:white;border:1px solid #ffffff55;border-radius:15px;padding:0;font:13px/1.45 system-ui,sans-serif;box-shadow:0 24px 70px #000b}
.fc-settings[hidden],.fc-settings-backdrop[hidden],.fc-fps[hidden]{display:none}
.fc-settings-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px 10px}
.fc-settings-header h2{margin:0;font-size:18px}
.fc-settings-close{font-size:23px;line-height:1;color:#e8fff0;background:#204336;border:1px solid #ffffff44;min-width:36px;min-height:36px}
.fc-settings-tabs{display:flex;gap:6px;padding:6px 18px 12px;overflow-x:auto;border-bottom:1px solid #ffffff26;flex-shrink:0}
.fc-settings .fc-settings-tab{flex:1 0 auto;min-width:76px;background:#19392d;color:#bbd7c5;border:1px solid #ffffff20}
.fc-settings .fc-settings-tab[aria-selected=true]{background:#326849;color:white;border-color:#8bd0a4}
.fc-settings-content{padding:9px 22px 18px;overflow-y:auto;overscroll-behavior:contain;min-height:120px;flex:1}
.fc-settings-page[hidden]{display:none}
.fc-settings-page{max-width:570px;margin:auto}
.fc-settings-page[data-category=trees]{max-width:635px}
.fc-light-group{border:1px solid #43634d;border-radius:10px;margin:12px 0;padding:12px 15px;background:#112b21}
.fc-light-group h3{margin:0 0 8px;font-size:14px;color:#c0edd0}
.fc-light-group label{margin:12px 0!important}
.fc-light-switches{display:flex;flex-wrap:wrap;gap:7px 20px}
.fc-audio-group{margin:12px 0 20px;border:1px solid #ffffff30;border-radius:9px;padding:12px 15px;background:#0e211a}
.fc-audio-group h3{font-size:14px;margin:0 0 12px;color:#c1eacf}
.fc-audio-row{display:grid;grid-template-columns:minmax(0,1fr) 42px;gap:10px;align-items:end;margin:12px 0}
.fc-audio-row label{margin:0!important}.fc-audio-row output{font-variant-numeric:tabular-nums}.fc-audio-preview{height:35px;background:#315d43;color:#fff;border:1px solid #ffffff3f}
.fc-audio-voice-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(98px,1fr));gap:6px;margin-top:8px}
.fc-settings .fc-audio-voice-grid button{background:#204636;color:#dcf2e5;border:1px solid #ffffff45;font-size:12px}

.fc-settings-shortcuts{margin-top:18px;padding:12px 14px;border:1px solid #45624c;border-radius:9px;background:#152f24;color:#d8f0df;line-height:1.75}.fc-settings-shortcuts strong{display:block;font-size:14px;margin-bottom:5px}.fc-settings-shortcuts small{display:block;margin-top:7px;opacity:.8}
.fc-tree-toolbar{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.fc-tree-actions{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0}
.fc-tree-actions button{background:#214834;color:#e8fff0;border:1px solid #64836c}
.fc-tree-actions button[aria-pressed=true]{background:#40885a;border-color:#98ddaf}
.fc-tree-section{border:1px solid #ffffff27;border-radius:9px;margin:11px 0;background:#0e211a}
.fc-tree-section summary{padding:10px;cursor:pointer;font-weight:650}
.fc-tree-fields{padding:0 11px 12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 14px}
.fc-tree-field{min-width:0;padding:3px 0}
.fc-settings .fc-tree-field label{font-size:12px;margin:6px 0;color:#d5eedc}
.fc-settings .fc-tree-field small{margin:5px 0;font-size:11px}
.fc-tree-numeric{display:flex;align-items:center;gap:8px}
.fc-settings .fc-tree-numeric input[type=range]{min-width:0;flex:1;margin:0}
.fc-settings .fc-tree-numeric input[type=number]{width:75px;min-width:60px;flex-shrink:0}
.fc-settings .fc-tree-field input[type=text],.fc-settings .fc-tree-field input[type=number],.fc-settings #fc-tree-json{box-sizing:border-box;width:100%;background:#0b2419;color:#fff;border:1px solid #617c69;border-radius:6px;padding:7px}
.fc-settings .fc-tree-field input[type=color]{width:100%;height:34px;background:transparent;border:0;cursor:pointer}
.fc-settings .fc-tree-apply{display:block;width:100%;background:#40885a;color:white;border:1px solid #a0cfad;font-weight:650;margin:12px 0}
.fc-settings #fc-tree-json{resize:vertical;min-height:76px}
.fc-settings #fc-tree-status{min-height:18px;font-size:12px;color:#a2dcb0}
.fc-settings .fc-tree-active-stats{font-size:11px;line-height:1.5;background:#183529;border:1px solid #365947;border-radius:7px;padding:8px 10px;color:#d0e8d5}
.fc-settings #fc-tree-status[data-error=true]{color:#ffb3a9}
.fc-settings-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 20px;border-top:1px solid #ffffff26}
.fc-settings-footer small{margin:0!important}.fc-settings-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.fc-settings :focus-visible{outline:2px solid #a8eec0;outline-offset:3px}
.fc-settings h2{font-size:16px;margin:0 0 12px}
.fc-settings label{display:block;margin:10px 0}
.fc-settings small{display:block;color:#bed7c6;line-height:1.35;margin:-5px 0 9px}
.fc-settings select{display:block;width:100%;padding:7px;background:#0c2619;color:white;border:1px solid #ffffff55;border-radius:6px;margin-top:6px}
.fc-settings input[type=range]{display:block;width:100%;margin-top:8px;accent-color:#8bd0a4}
.fc-settings input[type=checkbox]{accent-color:#8bd0a4}
.fc-angle-pair{display:block;height:32px;position:relative;margin-top:7px;touch-action:none}
.fc-angle-track{position:absolute;top:15px;left:8px;right:8px;height:4px;border-radius:4px;background:#466856}
.fc-settings .fc-angle-pair input[type=range]{position:absolute;left:0;top:3px;margin:0;width:100%;height:26px;background:transparent;appearance:none;-webkit-appearance:none;pointer-events:none;accent-color:transparent}
.fc-angle-pair input[type=range]::-webkit-slider-runnable-track{background:transparent;border:0}
.fc-angle-pair input[type=range]::-moz-range-track{background:transparent;border:0}
.fc-angle-pair input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:17px;height:23px;border:2px solid #143c25;border-radius:6px;background:#96e3aa;cursor:ew-resize;pointer-events:auto}
.fc-angle-pair input[type=range]::-moz-range-thumb{width:17px;height:23px;border:2px solid #143c25;border-radius:6px;background:#96e3aa;cursor:ew-resize;pointer-events:auto}
.fc-settings button{border-radius:7px;padding:7px 10px}
.fc-fps{position:fixed;z-index:9;top:7px;left:50%;transform:translateX(-50%);max-width:min(560px,calc(100vw - 150px));max-height:26vh;overflow:hidden;border-radius:6px;padding:4px 7px;background:#10251fe8;color:#baf1ca;font:600 10px/1.35 ui-monospace,monospace;white-space:pre-line;pointer-events:none;text-align:center}
@media(max-width:450px){.fc-tree-fields{grid-template-columns:1fr}.fc-tree-toolbar{grid-template-columns:1fr}.fc-tree-actions button{flex:1}.fc-settings{width:calc(100vw - 16px);max-height:calc(100dvh - 16px);border-radius:11px}.fc-settings-header{padding:11px 13px 7px}.fc-settings-tabs{padding:6px 10px 9px}.fc-settings .fc-settings-tab{min-width:80px;padding:8px 6px}.fc-settings-content{padding:7px 14px 12px}.fc-settings-footer{padding:9px 13px}.fc-settings-toggle{top:95px;right:12px;padding:8px 10px}}
`;
  doc.head.append(css);
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'fc-settings-toggle';
  toggle.textContent = '⚙ Настройки';
  toggle.setAttribute('aria-expanded', 'false');
  const backdrop=doc.createElement('div');
  backdrop.className='fc-settings-backdrop';
  backdrop.hidden=true;
  backdrop.setAttribute('aria-hidden','true');
  const panel = doc.createElement('section');
  panel.className = 'fc-settings';
  panel.hidden = true;
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-modal','true');
  panel.setAttribute('aria-label', 'Настройки игры');
  panel.innerHTML = `<header class="fc-settings-header"><h2>⚙ Настройки игры</h2>
      <button id="fc-settings-close" class="fc-settings-close" type="button" aria-label="Закрыть настройки">×</button></header>
    <nav class="fc-settings-tabs" aria-label="Категории настроек">
      <button type="button" class="fc-settings-tab" data-category="graphics" aria-selected="true">🎨 Графика</button>
      <button type="button" class="fc-settings-tab" data-category="grass" aria-selected="false">🌿 Трава</button>
      <button type="button" class="fc-settings-tab" data-category="trees" aria-selected="false">🌲 Деревья</button>
      <button type="button" class="fc-settings-tab" data-category="controls" aria-selected="false">🎮 Управление</button>
      <button type="button" class="fc-settings-tab" data-category="camera" aria-selected="false">📷 Камера</button>
      <button type="button" class="fc-settings-tab" data-category="audio" aria-selected="false">🔊 Звук</button>
      <button type="button" class="fc-settings-tab" data-category="lighting" aria-selected="false">💡 Освещение</button>
      <button type="button" class="fc-settings-tab" data-category="shadows" aria-selected="false">🌑 Тени</button>
      <button type="button" class="fc-settings-tab" data-category="world" aria-selected="false">🌍 Мир</button>
    </nav>
    <div class="fc-settings-content">
    <section class="fc-settings-page" data-category="graphics" aria-label="Графика">
    <label>Пресет производительности
      <select id="fc-quality"><option value="ultra">Ультра</option><option value="high">Высокий</option><option value="medium">Средний</option><option value="low">Низкий</option><option value="custom">Пользовательский</option></select></label>
    <small>Ручное изменение параметров графики включает пользовательский режим. Модели деревьев заменяются прямо в игре.</small>
    <label>Масштаб рендера: <output id="fc-render-scale-value"></output>%
      <input id="fc-render-scale" type="range" min="50" max="125" step="5"></label>
    <label><input id="fc-antialias" type="checkbox"> MSAA сглаживание</label>
    <small>MSAA применяется при следующем входе в игру (или после перезагрузки игрового клиента).</small>
    <label>Максимальный FPS
      <select id="fc-max-fps"><option value="30">30 FPS</option><option value="60">60 FPS</option>
      <option value="90">90 FPS</option><option value="120">120 FPS</option>
      <option value="144">144 FPS</option><option value="0">Без ограничения</option></select></label>
    <small>Ограничивает только рендеринг; физика и анимации обновляются с частотой дисплея. По умолчанию 60 FPS.</small>
    <h2>🌄 Дальность и детализация</h2>
    <label>Видимость: <output id="fc-view-distance-value"></output> м
      <input id="fc-view-distance" type="range" min="160" max="500" step="10"></label>
    <label>Радиус подробных деревьев: <output id="fc-detailed-tree-radius-value"></output> чанка
      <input id="fc-detailed-tree-radius" type="range" min="2" max="5" step="1"></label>
    <label>Дальность дальнего леса: <output id="fc-far-forest-distance-value"></output> м
      <input id="fc-far-forest-distance" type="range" min="90" max="450" step="5"></label>
    <label>Плотность дальних деревьев: <output id="fc-far-tree-density-value"></output>%
      <input id="fc-far-tree-density" type="range" min="0" max="100" step="5"></label>
    <label>Режим леса у озёр
      <select id="fc-lake-forest-mode"><option value="off">Отключён</option><option value="shore">Только берега</option><option value="full">Весь горизонт</option></select></label>
    <label><input id="fc-lake-visibility" type="checkbox"> Панорамная видимость у озёр</label>
    <label>Панорама озёр: <output id="fc-lake-view-distance-value"></output> м
      <input id="fc-lake-view-distance" type="range" min="160" max="500" step="10"></label>
    <label>Треугольники ели: <output id="fc-tree-triangles-spruce-value"></output>
      <input id="fc-tree-triangles-spruce" type="range" min="2000" max="40000" step="500"></label>
    <label>Треугольники берёзы: <output id="fc-tree-triangles-birch-value"></output>
      <input id="fc-tree-triangles-birch" type="range" min="1200" max="25000" step="100"></label>
    <label>LOD ели: <output id="fc-far-spruce-triangles-value"></output>
      <input id="fc-far-spruce-triangles" type="range" min="800" max="5000" step="100"></label>
    <label>LOD берёзы: <output id="fc-far-birch-triangles-value"></output>
      <input id="fc-far-birch-triangles" type="range" min="600" max="3500" step="100"></label>
    <label>Сегменты рельефа: <output id="fc-terrain-segments-value"></output>
      <input id="fc-terrain-segments" type="range" min="16" max="64" step="8"></label>
    <label>Качество воды
      <select id="fc-water-quality"><option value="high">Стандартное</option><option value="simple">Простое</option></select></label>
    <label>Плотность декораций: <output id="fc-decor-density-value"></output>%
      <input id="fc-decor-density" type="range" min="0" max="100" step="5"></label>
    <h2>🌲 Диагностика хвои ели</h2>
    <label><input id="fc-spruce-foliage-visible" type="checkbox"> Foliage Cards — отображать хвою</label>
    <label><input id="fc-spruce-foliage-shadows" type="checkbox"> Foliage Shadows — тени от хвои</label>
    <label>Плотность Foliage Cards: <output id="fc-spruce-foliage-density-value"></output>%
      <input id="fc-spruce-foliage-density" type="range" min="0" max="100" step="5"></label>
    <small>Прозрачные области хвои оптимизируются автоматически при старте. Плотность меняется без перегенерации леса.</small>
    <label>Угол обзора (FOV): <output id="fc-fov-value"></output>°
      <input id="fc-fov" type="range" min="65" max="95" step="5"></label>
    <label title="Панель появляется после завершения или пропуска обучения"><input id="fc-show-fps" type="checkbox"> FPS рендера и физики, диагностика (локально)</label>
    </section>
    <section class="fc-settings-page" data-category="trees" aria-label="Модели деревьев" hidden><div id="fc-tree-editor">${treeModelEditorMarkup()}</div></section>
    <section class="fc-settings-page" data-category="grass" aria-label="Трава" hidden>
    <label>Треугольники мелкой травы
      <select id="fc-grass-triangles"><option value="6">6 — плавные</option><option value="3">3 — облегчённые</option><option value="1">1 — минимальные</option></select></label>
    <label><input type="checkbox" id="fc-grass-interaction"> Сгибание травы и взаимодействие с окружением</label>
    <label>Плотность мелкой травы: <output id="fc-grass-density-value"></output>
      <input id="fc-grass-density" type="range" min="1" max="50" step="1"></label>
    <label>Дальность мелкой травы: <output id="fc-grass-distance-value"></output> м
      <input id="fc-grass-distance" type="range" min="12" max="100" step="1"></label>
    <h3>Оптимизация травы на расстоянии</h3>
    <label>Полная плотность до: <output id="fc-grass-full-density-distance-value"></output> м
      <input id="fc-grass-full-density-distance" type="range" min="0" max="30" step="1"></label>
    <label>Остаточная плотность вдали: <output id="fc-grass-far-density-percent-value"></output>%
      <input id="fc-grass-far-density-percent" type="range" min="0" max="100" step="1"></label>
    <h3>Формула плотности</h3>
    <small>f(t) = t³ / (t³ + (c + k) × (a − t)²), где t — относительное расстояние.
      Применение — после ввода числа и Enter или потери фокуса.</small>
    <label>k — добавка к коэффициенту:
      <input id="fc-grass-density-sharpness" type="number" step="any" inputmode="decimal"></label>
    <label>c — коэффициент (ранее 0.25):
      <input id="fc-grass-density-coefficient" type="number" step="any" inputmode="decimal"></label>
    <label>a — смещение в (a − t) (ранее 1):
      <input id="fc-grass-density-offset" type="number" step="any" inputmode="decimal"></label>
    <small>Можно вводить любые конечные числа, в том числе отрицательные. Если кривая немонотонна, CPU не прореживает плитки; итоговая плотность ограничена диапазоном 0–100%.</small>
    <label>Дополнительная ширина вдали: +<output id="fc-grass-far-width-bonus-value"></output>%
      <input id="fc-grass-far-width-bonus" type="range" min="0" max="100" step="1"></label>
    <small>После указанного расстояния плотность плавно снижается до выбранного процента,
      а ширина оставшихся травинок постепенно увеличивается. 100% плотности и +0% ширины отключают эффект.</small>
    <label>Размер травинок: <output id="fc-grass-size-range-value"></output>
      <span class="fc-angle-pair" id="fc-grass-size-pair">
        <span class="fc-angle-track" id="fc-grass-size-track"></span>
        <input id="fc-grass-min-size" type="range" min="1" max="8" step="0.25"
          aria-label="Минимальный размер травинок">
        <input id="fc-grass-max-size" type="range" min="1" max="8" step="0.25"
          aria-label="Максимальный размер травинок">
      </span>
    </label>
    <label>Ширина травинок: <output id="fc-grass-width-value"></output>
      <input id="fc-grass-width" type="range" min="0.25" max="4" step="0.25"></label>
    <label>Разброс поворота травинок: <output id="fc-grass-turn-value"></output>
      <span class="fc-angle-pair" id="fc-grass-turn-pair">
        <span class="fc-angle-track" id="fc-grass-turn-track"></span>
        <input id="fc-grass-turn-min" type="range" min="-90" max="90" step="1"
          aria-label="Минимальный поворот, от -90 до 0 градусов">
        <input id="fc-grass-turn-max" type="range" min="-90" max="90" step="1"
          aria-label="Максимальный поворот, от 0 до 90 градусов">
      </span>
    </label>
    <small>Меняется сразу; высокая плотность и дальность могут увеличить нагрузку. На полянках действуют собственные параметры травы.</small>
    </section>
    <section class="fc-settings-page" data-category="controls" aria-label="Управление" hidden>
    <label>Чувствительность обзора: <output id="fc-sensitivity-value"></output>
      <input id="fc-sensitivity" type="range" min="0.4" max="2.5" step="0.1"></label>
    <label><input id="fc-auto-sprint" type="checkbox"> Автобег при движении</label>
    <div class="fc-settings-shortcuts" aria-label="Клавиши и управление">
      <strong>Клавиши управления</strong>
      <div>WASD / стрелки — ходьба · Shift — бег · Space — прыжок</div>
      <div>Мышь — обзор · ЛКМ — рубить · E — подобрать</div>
      <div>I — инвентарь · K — книга рецептов · 1–4 — быстрые слоты</div>
      <div>V — камера · R — повернуть постройку · Esc — закрыть окно</div>
      <small>На сенсорном экране — джойстик, свайп и кнопки действий.</small>
    </div>
    </section>
    <section class="fc-settings-page" data-category="camera" aria-label="Камера" hidden>
    <small>Камера от третьего лица · изменения применяются сразу.</small>
    <label>Высота от пола: <output id="fc-camera-height-value"></output> м
      <input id="fc-camera-height" type="range" min="0.6" max="3.5" step="0.05"></label>
    <label>Смещение вбок: <output id="fc-camera-side-value"></output> м
      <input id="fc-camera-side" type="range" min="-1.5" max="1.5" step="0.05"></label>
    <small>Отрицательное — влево, положительное — вправо, 0 — строго по центру.</small>
    <label>Вертикальный ход взгляда: ±<output id="fc-camera-pitch-limit-value"></output>°
      <input id="fc-camera-pitch-limit" type="range" min="10" max="80" step="1"></label>
    <label>Расстояние от персонажа: <output id="fc-camera-distance-value"></output> м
      <input id="fc-camera-distance" type="range" min="1.2" max="6" step="0.05"></label>
    </section>
    <section class="fc-settings-page" data-category="audio" aria-label="Звук" hidden>
    <small>Каждый звук настраивается отдельно. Громкость меняется сразу, сохраняется автоматически. Кнопка ▶ позволяет послушать запись.</small>
    ${[
      ['main','🔊 Общая громкость'],
      ['effects','🎮 Действия и персонаж'],
      ['ambience','🌲 Природа и окружение'],
    ].map(([group,title])=>`<div class="fc-audio-group"><h3>${title}</h3>${SOUND_CONTROLS.filter(s=>s.group===group).map(({key,label})=>`
      <div class="fc-audio-row"><label for="fc-audio-${key}">${label}: <output id="fc-audio-${key}-value"></output>%
      <input id="fc-audio-${key}" data-sound="${key}" type="range" min="0" max="100" step="1"></label>
      ${key==='master'?'<span></span>':`<button type="button" class="fc-audio-preview" data-preview="${key}" aria-label="Прослушать: ${label}">▶</button>`}</div>`).join('')}</div>`).join('')}
    <details class="fc-audio-group" id="fc-voice-preview-set">
      <summary>🎙️ Прослушать все варианты голосов</summary>
      <small>Здесь каждый фрагмент пронумерован. Назови номера неудачных, чтобы удалить их из случайного выбора.</small>
      ${Object.entries(VOICE_VARIANTS).map(([category,sounds])=>`<h3>${({hurtMale:'Мужчина · боль',hurtFemale:'Женщина · боль',jumpMale:'Мужчина · прыжок',jumpFemale:'Женщина · прыжок',deathMale:'Мужчина · смерть',deathFemale:'Женщина · смерть'})[category]} (${sounds.length})</h3>
      <div class="fc-audio-voice-grid">${sounds.map((id,i)=>`<button type="button" data-voice-preview="${id}">▶ ${id.match(/_(\d+)$/)?.[1]??i+1}</button>`).join('')}</div>`).join('')}
    </details>
    <details class="fc-audio-group" id="fc-axe-preview-set">
      <summary>🪓 Прослушать варианты ударов топора (${AXE_VARIANTS.length})</summary>
      <div class="fc-audio-voice-grid">${AXE_VARIANTS.map((id,i)=>`<button type="button" data-voice-preview="${id}">▶ ${i+1}</button>`).join('')}</div>
    </details>
    <button type="button" id="fc-audio-defaults">Сбросить только громкости</button>
    </section>
    <section class="fc-settings-page" data-category="lighting" aria-label="Освещение" hidden>
      <small>Настройки яркости и дальности света. Дневные и ночные значения смешиваются автоматически. Параметры теней находятся рядом, во вкладке «🌑 Тени».</small>
      ${[
        ['day','☀️ Дневное освещение',['dayAmbient','daySun']],
        ['night','🌙 Ночное освещение',['nightAmbient','nightMoon','nightViewDistance']],
        ['campfire','🔥 Костёр',['campfireDayIntensity','campfireNightIntensity','campfireVisibilityDistance','campfireActivationDistance','campfireDecay','campfireLightHeight']],
        ['torch','🕯️ Факел',['torchDayIntensity','torchNightIntensity','torchVisibilityDistance','torchActivationDistance','torchDecay','torchLightHeight']],
      ].map(([,title,keys])=>`<div class="fc-light-group"><h3>${title}</h3>${keys.map(lightingFieldMarkup).join('')}</div>`).join('')}
      <div class="fc-light-group"><h3>✨ Внешний вид пламени</h3>
        ${[['flameShader','Шейдерное пламя (вместо простых конусов)'],
           ['flameBillboard','Billboard-свечение вокруг пламени']
].map(([key,label])=>
          `<label><input id="fc-light-${key}" type="checkbox"> ${label}</label>`).join('')}
        <small>Внешний вид пламени и свечения; яркость и дальность света регулируются выше.</small>
      </div>
    </section>
    <section class="fc-settings-page" data-category="shadows" aria-label="Тени" hidden>
      <small>Солнечные тени: ближние — чёткие, пересчитываются каждый кадр; дальние — кэшируемые, с отдельной частотой обновления. Каждая карта включает деревья, постройки и персонажей.</small>
      <div class="fc-light-group"><h3>🌲 Общие солнечные тени</h3>
    <label><input id="fc-tree-shadows" type="checkbox"> Тени деревьев</label>
    <label><input id="fc-character-shadows" type="checkbox"> Тени персонажей (в обеих картах CSM)</label>
    <label>Дальность детальных теней персонажей: <output id="fc-character-shadow-distance-value"></output> м
      <input id="fc-character-shadow-distance" type="range" min="10" max="100" step="1"></label>
    <small>Анимированный силуэт до выбранной дальности, затем ещё 16 м упрощённой тени. Большой радиус снижает чёткость и может нагружать GPU.</small>
    <label>Контрастность теней: <output id="fc-shadow-contrast-value"></output>%
      <input id="fc-shadow-contrast" type="range" min="0" max="100" step="5"></label>
    <small>Уменьшает фоновый свет внутри теней: 0% — мягкие, 100% — максимально контрастные. Применяется и днём, и ночью.</small>
    <small>В обе карты CSM входят деревья и персонажи; ближняя обновляется каждый кадр, дальняя — по таймеру.</small>
      </div>
      ${[
        ['sun-cascades','☀️ Ближние солнечные тени · каждый кадр',
          ['sunNearShadowDistance','sunNearShadowMapSize','sunCascadeBlendDistance','sunCascadeCasterOverlap','sunNearShadowSoftness']]
      ].map(([,title,keys])=>`<div class="fc-light-group"><h3>${title}</h3>${keys.map(lightingFieldMarkup).join('')}</div>`).join('')}
      <small>«Ширина перехода» смешивает освещение между картами, а «Запас перекрытия» расширяет область геометрии и камеру ближних теней, чтобы не образовывалась пустая полоса. Больший запас уменьшает плотность пикселей ближней карты и увеличивает число объектов. Мягкость: 0 — без сглаживания, 1–4 — размытие краёв по существующим PCF-выборкам (без новых проходов теневой карты); при значениях 3–4 возможна зернистость.</small>
      <div class="fc-light-group"><h3>🌲 Дальние солнечные тени</h3>
        <label>Дальность дальних теней от солнца: <output id="fc-shadow-distance-value"></output> м
          <input id="fc-shadow-distance" type="range" min="60" max="350" step="10"></label>
        <label>${LIGHTING_FIELDS.sunFarShadowSoftness[4]}: <output id="fc-light-sunFarShadowSoftness-value"></output>
          <input id="fc-light-sunFarShadowSoftness" type="range" min="0" max="4" step="0.5"></label>
        <label>Разрешение дальней солнечной карты
          <select id="fc-shadow-map-size"><option value="512">512 × 512</option><option value="1024">1024 × 1024</option><option value="2048">2048 × 2048</option><option value="4096">4096 × 4096 (4K)</option></select></label>
        <label>Обновлять дальние солнечные тени: <output id="fc-shadow-refresh-value"></output>
          <input id="fc-shadow-refresh" type="range" min="0" max="20" step="0.5"></label>
        <small>Дальний каскад берёт деревья за границей ближней зоны, включая низкополигональный дальний лес. Радиус 60–350 м и разрешение влияют только на дальнюю карту. При большой дальности уменьшайте разрешение и увеличивайте период обновления до 20 с. Ближняя карта независимо настраивается выше.</small>
      </div>
      ${[
        ['campfire','🔥 Костёр',['campfireDayRadius','campfireNightRadius','campfireShadowVisibilityDistance']],
        ['torch','🕯️ Факел',['torchDayRadius','torchNightRadius','torchShadowVisibilityDistance']]
      ].map(([,title,keys])=>`<div class="fc-light-group"><h3>${title}</h3>${keys.map(lightingFieldMarkup).join('')}</div>`).join('')}
      <div class="fc-light-group"><h3>⚙️ Общие настройки теней</h3>
        <label>${LIGHTING_FIELDS.fireShadowLimit[4]}: <output id="fc-light-fireShadowLimit-value"></output>
        <input id="fc-light-fireShadowLimit" type="range" min="0" max="4" step="1"></label>
        ${[['fireShadows','Включить тени от огня (дороже на GPU)'],
           ['nightDisableMoonShadows','Ночью отключать тени от луны: деревья, объекты, персонаж']].map(([key,label])=>
          `<label><input id="fc-light-${key}" type="checkbox"> ${label}</label>`).join('')}
        <small>Лимит 0–4 ограничивает только покадровые обновления карт огня. Все остальные костры и факелы показывают кэшированные тени.</small>
      </div>
    </section>
    <section class="fc-settings-page" data-category="world" aria-label="Мир" hidden>
    <label><input id="fc-wind-enabled" type="checkbox"> Лёгкий ветер в деревьях</label>
    <label><input id="fc-day-cycle" type="checkbox"> Локальная смена дня и ночи</label>
    <small>Полные сутки 16 минут (8 минут день и 8 минут ночь). В сетевой игре время суток общее и управляется сервером.</small>
    </section></div>
    <footer class="fc-settings-footer"><small>Изменения сохраняются автоматически</small>
      <div class="fc-settings-actions">
        <button id="fc-export-settings" type="button">📥 Экспорт JSON</button>
        <button id="fc-reset-settings" type="button">Сбросить всё</button>
      </div></footer>`;
  const fps = doc.createElement('div');
  fps.className = 'fc-fps';
  fps.setAttribute('aria-label', 'Частота кадров');
  fps.hidden = !state.showFps;
  fps.textContent = 'Render FPS — · Physics FPS —';
  doc.body.append(toggle,backdrop,panel,fps);

  const cameraControls = [
    ['cameraHeight','camera-height',2],
    ['cameraSide','camera-side',2],
    ['cameraPitchLimit','camera-pitch-limit',0],
    ['cameraDistance','camera-distance',2],
  ];
  const range = panel.querySelector('#fc-sensitivity');
  const output = panel.querySelector('#fc-sensitivity-value');
  const checkbox = panel.querySelector('#fc-show-fps');
  const windCheckbox = panel.querySelector('#fc-wind-enabled');
  const sprintCheckbox = panel.querySelector('#fc-auto-sprint');
  const qualitySelect = panel.querySelector('#fc-quality');
  const fpsSelect = panel.querySelector('#fc-max-fps');
  const spruceVisibleInput=panel.querySelector('#fc-spruce-foliage-visible');
  const spruceShadowsInput=panel.querySelector('#fc-spruce-foliage-shadows');
  const spruceDensityInput=panel.querySelector('#fc-spruce-foliage-density');
  const spruceDensityValue=panel.querySelector('#fc-spruce-foliage-density-value');
  const shadowDistanceInput = panel.querySelector('#fc-shadow-distance');
  const shadowRefreshInput = panel.querySelector('#fc-shadow-refresh');
  const characterShadowsInput = panel.querySelector('#fc-character-shadows');
  const characterShadowDistanceInput = panel.querySelector('#fc-character-shadow-distance');
  const characterShadowDistanceValue = panel.querySelector('#fc-character-shadow-distance-value');
  const shadowContrastInput = panel.querySelector('#fc-shadow-contrast');
  const shadowContrastValue = panel.querySelector('#fc-shadow-contrast-value');
  const shadowDistanceValue = panel.querySelector('#fc-shadow-distance-value');
  const shadowRefreshValue = panel.querySelector('#fc-shadow-refresh-value');
  const grassDensityInput = panel.querySelector('#fc-grass-density');
  const grassDistanceInput = panel.querySelector('#fc-grass-distance');
  const grassDensityValue = panel.querySelector('#fc-grass-density-value');
  const grassDistanceValue = panel.querySelector('#fc-grass-distance-value');
  const grassMinSizeInput = panel.querySelector('#fc-grass-min-size');
  const grassMaxSizeInput = panel.querySelector('#fc-grass-max-size');
  const grassWidthInput = panel.querySelector('#fc-grass-width');
  const grassLodFields=[
    ['grassFullDensityDistance','grass-full-density-distance'],
    ['grassFarDensityPercent','grass-far-density-percent'],
    ['grassDensitySharpness','grass-density-sharpness'],
    ['grassDensityCoefficient','grass-density-coefficient'],
    ['grassDensityOffset','grass-density-offset'],
    ['grassFarWidthBonus','grass-far-width-bonus'],
  ];
  const grassSizeRangeValue = panel.querySelector('#fc-grass-size-range-value');
  const grassSizeTrack = panel.querySelector('#fc-grass-size-track');
  const grassWidthValue = panel.querySelector('#fc-grass-width-value');
  const grassTurnMinInput = panel.querySelector('#fc-grass-turn-min');
  const grassTurnMaxInput = panel.querySelector('#fc-grass-turn-max');
  const grassTurnValue = panel.querySelector('#fc-grass-turn-value');
  const grassTurnTrack = panel.querySelector('#fc-grass-turn-track');
  const dayCheckbox = panel.querySelector('#fc-day-cycle');
  const fovSlider = panel.querySelector('#fc-fov');
  const fovOutput = panel.querySelector('#fc-fov-value');
  const networkLabel = () => connected ? `Ping ${latency === null ? '—' : latency + ' ms'}` : 'offline';
  const PERFORMANCE_INPUTS={
    renderScale:'render-scale',treeShadowsEnabled:'tree-shadows',shadowMapSize:'shadow-map-size',
    viewDistance:'view-distance',detailedTreeRadius:'detailed-tree-radius',
    farForestDistance:'far-forest-distance',farTreeDensity:'far-tree-density',
    lakeForestMode:'lake-forest-mode',lakeVisibility:'lake-visibility',
    lakeViewDistance:'lake-view-distance',treeTrianglesSpruce:'tree-triangles-spruce',
    treeTrianglesBirch:'tree-triangles-birch',farSpruceTriangles:'far-spruce-triangles',
    farBirchTriangles:'far-birch-triangles',terrainSegments:'terrain-segments',
    waterQuality:'water-quality',decorDensity:'decor-density',
    grassTriangles:'grass-triangles',grassInteraction:'grass-interaction',
    antialias:'antialias',
  };
  const renderFps = () => {fps.textContent = `Render FPS ${lastRate === null ? '—' : lastRate} · Physics FPS ${lastPhysicsRate === null ? '—' : lastPhysicsRate} · ${networkLabel()}\nCPU Frame Time ${lastCpuMs === null ? '—' : lastCpuMs.toFixed(2)+' ms'} · GPU Frame Time ${gpuTimingSupported===false?'н/д':lastGpuMs === null?'—':lastGpuMs.toFixed(2)+' ms'}${lastGpu ? '\nGPU: '+lastGpu : ''}${lastPosition ? '\n'+lastPosition : ''}${lastDiagnostics ? '\n'+lastDiagnostics : ''}`;};
  function reflect() {
    for(const key of Object.keys(LIGHTING_FIELDS)){
      const el=panel.querySelector('#fc-light-'+key);
      if(el){el.value=String(state[key]);panel.querySelector('#fc-light-'+key+'-value').textContent=String(state[key]);}
    }
    for(const key of Object.keys(LIGHTING_FLAGS)){
      const el=panel.querySelector('#fc-light-'+key);if(el)el.checked=state[key];
    }
    for(const [key,id,digits] of cameraControls){
      panel.querySelector('#fc-'+id).value=String(state[key]);
      panel.querySelector('#fc-'+id+'-value').textContent=state[key].toFixed(digits);
    }
    range.value = state.mouseSensitivity;
    output.textContent = String(state.mouseSensitivity.toFixed(1));
    checkbox.checked = state.showFps;
    windCheckbox.checked = state.windEnabled;
    dayCheckbox.checked = connected || state.dayCycleEnabled;
    dayCheckbox.disabled = connected;
    dayCheckbox.title = connected?'В сетевом мире время суток задаёт сервер':'';
    sprintCheckbox.checked = state.autoSprint;
    qualitySelect.value = state.performancePreset;
    for(const [key,id] of Object.entries(PERFORMANCE_INPUTS)){
      const el=panel.querySelector('#fc-'+id);
      if(!el)continue;
      if(el.type==='checkbox')el.checked=state[key];
      else el.value=String(state[key]);
      const output=panel.querySelector('#fc-'+id+'-value');
      if(output)output.textContent=String(state[key]);
    }
    fpsSelect.value = String(state.maxFps);
    spruceVisibleInput.checked=state.spruceFoliageVisible;
    spruceShadowsInput.checked=state.spruceFoliageShadows;
    spruceDensityInput.value=String(state.spruceFoliageDensity);
    spruceDensityValue.textContent=String(state.spruceFoliageDensity);
    shadowDistanceInput.value = String(state.shadowDistance);
    shadowRefreshInput.value = String(state.shadowRefreshSeconds);
    characterShadowsInput.checked = state.characterShadowsEnabled;
    characterShadowDistanceInput.value = String(state.characterShadowDistance);
    characterShadowDistanceValue.textContent = String(state.characterShadowDistance);
    shadowContrastInput.value = String(state.shadowContrast);
    shadowContrastValue.textContent = String(state.shadowContrast);
    shadowDistanceValue.textContent = String(state.shadowDistance);
    shadowRefreshValue.textContent = state.shadowRefreshSeconds===0?'каждый кадр':String(state.shadowRefreshSeconds)+' с';
    grassDensityInput.value = String(state.grassDensity);
    grassDistanceInput.value = String(state.grassDistance);
    grassDensityValue.textContent = String(state.grassDensity);
    grassDistanceValue.textContent = String(state.grassDistance);
    grassMinSizeInput.value = String(state.grassMinSize);
    grassMaxSizeInput.value = String(state.grassMaxSize);
    grassWidthInput.value = String(state.grassWidth);
    for(const [key,id] of grassLodFields){
      panel.querySelector('#fc-'+id).value=String(state[key]);
      const output=panel.querySelector('#fc-'+id+'-value');
      if(output)output.textContent=String(state[key]);
    }
    grassSizeRangeValue.textContent = state.grassMinSize + '× … ' + state.grassMaxSize + '×';
    const sizeLeft = (state.grassMinSize - 1) / 7 * 100;
    const sizeRight = (state.grassMaxSize - 1) / 7 * 100;
    grassSizeTrack.style.background = `linear-gradient(to right,#466856 ${sizeLeft}%,#9ce2ab ${sizeLeft}%,#9ce2ab ${sizeRight}%,#466856 ${sizeRight}%)`;
    grassWidthValue.textContent = state.grassWidth + '×';
    grassTurnMinInput.value = String(state.grassTurnMin);
    grassTurnMaxInput.value = String(state.grassTurnMax);
    grassTurnValue.textContent = state.grassTurnMin+'° … +'+state.grassTurnMax+'°';
    const left = (state.grassTurnMin + 90) / 180 * 100;
    const right = (state.grassTurnMax + 90) / 180 * 100;
    grassTurnTrack.style.background = `linear-gradient(to right,#466856 ${left}%,#9ce2ab ${left}%,#9ce2ab ${right}%,#466856 ${right}%)`;
    fovSlider.value = String(state.fov);
    fovOutput.textContent = String(state.fov);
    fps.hidden = !state.showFps;
    renderFps();
  }
  let lastPerformance=JSON.stringify(PERFORMANCE_KEYS.map(key=>state[key]));
  let applyingPreset=false;
  function save() {
    const nextPerformance=JSON.stringify(PERFORMANCE_KEYS.map(key=>state[key]));
    if(!applyingPreset&&nextPerformance!==lastPerformance&&state.performancePreset!=='custom'){
      state.performancePreset='custom';
      qualitySelect.value='custom';
    }
    const changed=nextPerformance!==lastPerformance;
    lastPerformance=nextPerformance;
    try {storage?.setItem(KEY, JSON.stringify(state));}
    catch { /* Private mode or blocked storage: keep preferences for this tab. */ }
    if(changed)onPerformanceChange?.(state);
  }
  const tabButtons=Array.from(panel.querySelectorAll?.('.fc-settings-tab')??[]);
  const pages=Array.from(panel.querySelectorAll?.('.fc-settings-page')??[]);
  let activeCategory='graphics';
  function activateCategory(category) {
    if(!['graphics','grass','trees','controls','camera','audio','lighting','shadows','world'].includes(category))return;
    activeCategory=category;
    for(const tab of tabButtons)tab.setAttribute('aria-selected',String(tab.dataset.category===category));
    for(const page of pages)page.hidden=page.dataset.category!==category;
    const content=panel.querySelector?.('.fc-settings-content');
    if(content)content.scrollTop=0;
  }
  for(const tab of tabButtons)tab.onclick=()=>activateCategory(tab.dataset.category);
  for(const key of Object.keys(LIGHTING_FIELDS)){
    const el=panel.querySelector('#fc-light-'+key);
    el.oninput=()=>{
      state[key]=Number(el.value);
      panel.querySelector('#fc-light-'+key+'-value').textContent=String(state[key]);
      save();
    };
  }
  for(const key of Object.keys(LIGHTING_FLAGS)){
    const el=panel.querySelector('#fc-light-'+key);
    el.onchange=()=>{state[key]=el.checked;save();};
  }
  function reflectAudio(){
    for(const {key} of SOUND_CONTROLS){
      const input=panel.querySelector('#fc-audio-'+key);
      const value=panel.querySelector('#fc-audio-'+key+'-value');
      if(input)input.value=String(state.audio[key]);
      if(value)value.textContent=String(state.audio[key]);
    }
  }
  for(const {key} of SOUND_CONTROLS){
    const slider=panel.querySelector('#fc-audio-'+key);
    if(!slider)continue;
    slider.oninput=()=>{
      state.audio={...state.audio,[key]:Number(slider.value)};
      reflectAudio();save();
    };
  }
  for(const preview of panel.querySelectorAll?.('[data-voice-preview]')??[]){
    preview.onclick=()=>onSoundPreview?.(preview.dataset.voicePreview,true);
  }
  for(const preview of panel.querySelectorAll?.('[data-preview]')??[]){
    preview.onclick=()=>onSoundPreview?.(preview.dataset.preview);
  }
  panel.querySelector('#fc-audio-defaults').onclick=()=>{
    state.audio={...DEFAULT_AUDIO};reflectAudio();save();
  };
  reflectAudio();
  function close() {
    if(panel.hidden)return;
    panel.hidden=true;
    backdrop.hidden=true;
    toggle.setAttribute('aria-expanded','false');
    toggle.focus?.();
  }
  backdrop.onclick=close;
  panel.querySelector('#fc-settings-close').onclick=close;
  panel.addEventListener?.('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    // Keep keyboard navigation inside the dialog, including on mobile keyboards.
    if(event.key==='Tab'){
      const focusable=Array.from(panel.querySelectorAll?.('button,input,select')??[])
        .filter(node=>!node.disabled&&node.getClientRects?.().length);
      if(focusable.length){
        const first=focusable[0],last=focusable[focusable.length-1];
        if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
      }
    }
    // Arrow keys and space should operate settings controls, not the character.
    event.stopPropagation();
  });
  toggle.onclick = () => {
    if(!panel.hidden){close();return;}
    const network=doc.getElementById?.('network');
    if(network)network.style.display='none';
    activateCategory(activeCategory);
    backdrop.hidden=false;
    panel.hidden=false;
    toggle.setAttribute('aria-expanded','true');
    panel.querySelector('#fc-settings-close').focus?.();
  };
  for(const [key,id] of cameraControls){
    panel.querySelector('#fc-'+id).oninput=event=>{
      state[key]=sanitizeSettings({...state,[key]:Number(event.target.value)})[key];
      reflect();save();
    };
  }
  for(const [key,id] of Object.entries(PERFORMANCE_INPUTS)){
    const el=panel.querySelector('#fc-'+id);
    if(!el)continue;
    const change=()=>{
      const value=el.type==='checkbox'?el.checked:
        (el.tagName==='SELECT'&&!['grassTriangles','shadowMapSize'].includes(key))?el.value:Number(el.value);
      const valid=sanitizeSettings({...state,[key]:value});
      state[key]=valid[key];
      reflect();save();
    };
    if(el.type==='range')el.oninput=change;
    else el.onchange=change;
  }
  range.oninput = () => {
    Object.assign(state, sanitizeSettings({...state, mouseSensitivity: Number(range.value)}));
    reflect();save();
  };
  checkbox.onchange = () => {
    state.showFps = checkbox.checked;
    lastSample=null;frames=0;lastRate=null;
    lastPhysicsSample=null;physicsFrames=0;lastPhysicsRate=null;
    cpuSampleStart=null;cpuSamples=0;cpuTotalMs=0;lastCpuMs=null;
    lastGpuMs=null;gpuTimingSupported=null;
    reflect();save();
  };
  windCheckbox.onchange = () => {state.windEnabled = windCheckbox.checked;reflect();save();};
  dayCheckbox.onchange = () => {state.dayCycleEnabled = dayCheckbox.checked;reflect();save();};
  sprintCheckbox.onchange = () => {state.autoSprint = sprintCheckbox.checked;reflect();save();};
  qualitySelect.onchange = () => {
    const preset=qualitySelect.value;
    if(preset!=='custom'&&PERFORMANCE_PRESETS[preset]){
      applyingPreset=true;
      Object.assign(state,PERFORMANCE_PRESETS[preset]);
      if(PERFORMANCE_LIGHTING_PRESETS[preset])Object.assign(state,PERFORMANCE_LIGHTING_PRESETS[preset]);
    }
    state.performancePreset=preset;
    onQualityChange?.(state.quality);
    reflect();save();applyingPreset=false;
    treeEditor.selectProfile(state.quality);
  };
  fpsSelect.onchange = () => {
    state.maxFps = sanitizeSettings({...state,maxFps:Number(fpsSelect.value)}).maxFps;
    lastSample=null;frames=0;lastRate=null;
    reflect();save();
  };
  spruceVisibleInput.onchange=()=>{
    state.spruceFoliageVisible=spruceVisibleInput.checked;
    reflect();save();
  };
  spruceShadowsInput.onchange=()=>{
    state.spruceFoliageShadows=spruceShadowsInput.checked;
    reflect();save();
  };
  spruceDensityInput.oninput=()=>{
    state.spruceFoliageDensity=sanitizeSettings({
      ...state,spruceFoliageDensity:Number(spruceDensityInput.value),
    }).spruceFoliageDensity;
    reflect();save();
  };
  shadowDistanceInput.oninput = () => {
    state.shadowDistance = sanitizeSettings({...state,
      shadowDistance:Number(shadowDistanceInput.value)}).shadowDistance;
    reflect();save();
  };
  shadowRefreshInput.oninput = () => {
    state.shadowRefreshSeconds = sanitizeSettings({...state,
      shadowRefreshSeconds:Number(shadowRefreshInput.value)}).shadowRefreshSeconds;
    reflect();save();
  };
  characterShadowsInput.onchange = () => {
    state.characterShadowsEnabled = characterShadowsInput.checked;
    reflect();save();
  };
  characterShadowDistanceInput.oninput = () => {
    state.characterShadowDistance = sanitizeSettings({...state,
      characterShadowDistance:Number(characterShadowDistanceInput.value)}).characterShadowDistance;
    reflect();save();
  };
  shadowContrastInput.oninput = () => {
    state.shadowContrast = sanitizeSettings({...state,
      shadowContrast:Number(shadowContrastInput.value)}).shadowContrast;
    reflect();save();
  };
  grassDensityInput.oninput = () => {
    state.grassDensity = sanitizeSettings({...state, grassDensity:Number(grassDensityInput.value)}).grassDensity;
    reflect();save();
  };
  grassDistanceInput.oninput = () => {
    state.grassDistance = sanitizeSettings({...state, grassDistance:Number(grassDistanceInput.value)}).grassDistance;
    reflect();save();
  };
  grassMinSizeInput.oninput = () => {
    const value = Number(grassMinSizeInput.value);
    state.grassMinSize = Math.min(value,state.grassMaxSize);
    reflect();save();
  };
  grassMaxSizeInput.oninput = () => {
    const value = Number(grassMaxSizeInput.value);
    state.grassMaxSize = Math.max(value,state.grassMinSize);
    reflect();save();
  };
  grassWidthInput.oninput = () => {
    state.grassWidth = sanitizeSettings({...state,grassWidth:Number(grassWidthInput.value)}).grassWidth;
    reflect();save();
  };
  for(const [key,id] of grassLodFields){
    const input=panel.querySelector('#fc-'+id);
    const update=()=>{
      // Don't apply a temporarily blank/incomplete float during editing.
      const raw=input.value.trim();
      const value=raw===''?NaN:Number(raw);
      if(Number.isFinite(value)){
        state[key]=sanitizeSettings({...state,[key]:value})[key];
        save();
      }
      reflect();
    };
    if(input.type==='number')input.onchange=update;
    else input.oninput=update;
  }
  grassTurnMinInput.oninput = () => {
    state.grassTurnMin = Math.max(-90,Math.min(0,Number(grassTurnMinInput.value)));
    reflect();save();
  };
  grassTurnMaxInput.oninput = () => {
    state.grassTurnMax = Math.max(0,Math.min(90,Number(grassTurnMaxInput.value)));
    reflect();save();
  };
  fovSlider.oninput = () => {
    state.fov = sanitizeSettings({...state,fov:Number(fovSlider.value)}).fov;
    onFovChange?.(state.fov);
    reflect();save();
  };
  const treeEditor=mountTreeModelEditor(panel.querySelector('#fc-tree-editor'),{
    storage,activeStats:treeModelStats,
    getQuality:()=>state.quality,
    applyQuality:quality=>{
      state.quality=quality;
      state.performancePreset='custom';
      onQualityChange?.(quality);
      reflect();save();
    },
    reload:()=>onPerformanceChange?.(state),
  });
  panel.querySelector('#fc-export-settings').onclick=()=>{
    const json=settingsExportJSON(state,treeEditor.getProfiles());
    const blob=new Blob([json],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const anchor=doc.createElement('a');
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    anchor.href=url;
    anchor.download='forest-chopper-settings-'+state.performancePreset+'-'+stamp+'.json';
    anchor.hidden=true;
    doc.body.append(anchor);
    try{anchor.click();}
    finally{
      anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  };
  panel.querySelector('#fc-reset-settings').onclick = () => {
    Object.assign(state, DEFAULT, {audio:{...DEFAULT_AUDIO}});reflectAudio();treeEditor.resetAll();onFovChange?.(state.fov);onQualityChange?.(state.quality);applyingPreset=true;reflect();save();applyingPreset=false;
  };
  reflect();
  onFovChange?.(state.fov);
  onQualityChange?.(state.quality);

  let lastSample = null, frames = 0;
  let lastPhysicsSample = null, physicsFrames = 0;
  let cpuSampleStart = null, cpuSamples = 0, cpuTotalMs = 0;
  // CPU: wall-clock JavaScript time per rAF callback, including render submit
  // on rendered frames. GPU: asynchronous elapsed GPU time of the render path.
  function recordCpuFrame(durationMs,now){
    if(!performanceSampling()||!Number.isFinite(now)||!Number.isFinite(durationMs)||
      durationMs<0)return;
    if(cpuSampleStart===null)cpuSampleStart=now;
    cpuTotalMs+=durationMs;
    cpuSamples++;
    if(now-cpuSampleStart>=950){
      lastCpuMs=cpuTotalMs/cpuSamples;
      cpuSampleStart=now;cpuTotalMs=0;cpuSamples=0;
      renderFps();
    }
  }
  function setGpuFrameTime(ms,supported){
    if(!performanceSampling())return;
    const nextSupported=!!supported;
    const nextMs=nextSupported&&Number.isFinite(ms)&&ms>=0?ms:null;
    if(gpuTimingSupported===nextSupported&&lastGpuMs===nextMs)return;
    gpuTimingSupported=nextSupported;
    lastGpuMs=nextMs;
    renderFps();
  }
  // Called on EVERY rAF callback, independent of the render-only FPS limiter.
  // This measures variable-timestep simulation frequency, not fixed steps.
  function tickPhysics(now) {
    if(!performanceSampling()){
      lastPhysicsSample=null;physicsFrames=0;lastPhysicsRate=null;
      return;
    }
    if(!Number.isFinite(now))return;
    if(lastPhysicsSample===null){lastPhysicsSample=now;physicsFrames=0;return;}
    physicsFrames++;
    if(now-lastPhysicsSample>=950){
      lastPhysicsRate=Math.max(0,Math.round(physicsFrames*1000/(now-lastPhysicsSample)));
      lastPhysicsSample=now;
      physicsFrames=0;
      renderFps();
    }
  }
  function setConnected(online) {
    connected = !!online;
    latency = null;
    dayCheckbox.checked=connected||state.dayCycleEnabled;
    dayCheckbox.disabled=connected;
    dayCheckbox.title=connected?'В сетевом мире время суток задаёт сервер':'';
    renderFps();
  }
  function setLatency(ms) {
    latency = connected && Number.isFinite(ms) && ms >= 0 && ms <= 120000 ? Math.round(ms) : null;
    renderFps();
  }
  function tick(now, gameCtx = null) {
    if (!performanceSampling()) {lastSample = null;frames = 0;lastRate=null;lastDiagnostics='';return;}
    if (lastGpu===null && gameCtx?.renderer)
      lastGpu=getGpuRendererName(gameCtx.renderer);
    if (lastSample === null) {lastSample = now;frames = 0;renderFps();return;}
    frames++;
    if (now - lastSample >= 950) {
      const rate = Math.round(frames * 1000 / (now - lastSample));
      lastRate = Math.max(0, rate);
      lastPosition = gameCtx ? `X ${gameCtx.px.toFixed(1)} · Y ${gameCtx.feetY.toFixed(1)} · Z ${gameCtx.pz.toFixed(1)}` : '';
      lastDiagnostics = gameCtx ? formatDiagnostics(collectDiagnostics(gameCtx)) : '';
      renderFps();
      frames = 0;
      lastSample = now;
    }
  }
  return {
    get performancePreset(){return state.performancePreset;},
    get renderScale(){return state.renderScale;},
    get treeShadowsEnabled(){return state.treeShadowsEnabled;},
    get shadowMapSize(){return state.shadowMapSize;},
    get viewDistance(){return state.viewDistance;},
    get detailedTreeRadius(){return state.detailedTreeRadius;},
    get farForestDistance(){return state.farForestDistance;},
    get farTreeDensity(){return state.farTreeDensity;},
    get lakeForestMode(){return state.lakeForestMode;},
    get lakeVisibility(){return state.lakeVisibility;},
    get lakeViewDistance(){return state.lakeViewDistance;},
    get treeTrianglesSpruce(){return state.treeTrianglesSpruce;},
    get treeTrianglesBirch(){return state.treeTrianglesBirch;},
    get farSpruceTriangles(){return state.farSpruceTriangles;},
    get farBirchTriangles(){return state.farBirchTriangles;},
    get terrainSegments(){return state.terrainSegments;},
    get waterQuality(){return state.waterQuality;},
    get decorDensity(){return state.decorDensity;},
    get grassTriangles(){return state.grassTriangles;},
    get grassInteraction(){return state.grassInteraction;},
    get antialias(){return state.antialias;},
    get cameraHeight(){return state.cameraHeight;},
    get cameraSide(){return state.cameraSide;},
    get cameraPitchLimit(){return state.cameraPitchLimit;},
    get cameraDistance(){return state.cameraDistance;},
    get mouseSensitivity(){return state.mouseSensitivity;},
    get showFps(){return state.showFps;},
    get profilerSampling(){return profilerSampling;},
    get fpsReport(){return fps.textContent;},
    setProfilerSampling(enabled){
      profilerSampling=!!enabled;
      if(profilerSampling){
        lastSample=null;frames=0;lastRate=null;
        lastPhysicsSample=null;physicsFrames=0;lastPhysicsRate=null;
        cpuSampleStart=null;cpuSamples=0;cpuTotalMs=0;lastCpuMs=null;
        lastGpuMs=null;gpuTimingSupported=null;
        renderFps();
      }
    },
    setShowFps(enabled){checkbox.checked=!!enabled;checkbox.onchange();return state.showFps;},
    get spruceFoliageVisible(){return state.spruceFoliageVisible;},
    get spruceFoliageShadows(){return state.spruceFoliageShadows;},
    get spruceFoliageDensity(){return state.spruceFoliageDensity;},
    get windEnabled(){return state.windEnabled;},
    get dayCycleEnabled(){return state.dayCycleEnabled;},
    get dayAmbient(){return state.dayAmbient;},
    get daySun(){return state.daySun;},
    get nightAmbient(){return state.nightAmbient;},
    get nightMoon(){return state.nightMoon;},
    get nightViewDistance(){return state.nightViewDistance;},
    get campfireDayIntensity(){return state.campfireDayIntensity;},
    get campfireNightIntensity(){return state.campfireNightIntensity;},
    get campfireDayRadius(){return state.campfireDayRadius;},
    get campfireNightRadius(){return state.campfireNightRadius;},
    get campfireShadowVisibilityDistance(){return state.campfireShadowVisibilityDistance;},
    get campfireLightHeight(){return state.campfireLightHeight;},
    get campfireVisibilityDistance(){return state.campfireVisibilityDistance;},
    get campfireActivationDistance(){return state.campfireActivationDistance;},
    get campfireDecay(){return state.campfireDecay;},
    get torchDayIntensity(){return state.torchDayIntensity;},
    get torchNightIntensity(){return state.torchNightIntensity;},
    get torchDayRadius(){return state.torchDayRadius;},
    get torchNightRadius(){return state.torchNightRadius;},
    get torchShadowVisibilityDistance(){return state.torchShadowVisibilityDistance;},
    get torchLightHeight(){return state.torchLightHeight;},
    get torchVisibilityDistance(){return state.torchVisibilityDistance;},
    get torchActivationDistance(){return state.torchActivationDistance;},
    get torchDecay(){return state.torchDecay;},
    get sunNearShadowDistance(){return state.sunNearShadowDistance;},
    get sunNearShadowMapSize(){return state.sunNearShadowMapSize;},
    get sunCascadeBlendDistance(){return state.sunCascadeBlendDistance;},
    get sunCascadeCasterOverlap(){return state.sunCascadeCasterOverlap;},
    get sunNearShadowSoftness(){return state.sunNearShadowSoftness;},
    get sunFarShadowSoftness(){return state.sunFarShadowSoftness;},
    get flameShader(){return state.flameShader;},
    get flameBillboard(){return state.flameBillboard;},
    get fireShadows(){return state.fireShadows;},
    get fireShadowLimit(){return state.fireShadowLimit;},
    get nightDisableMoonShadows(){return state.nightDisableMoonShadows;},
    get autoSprint(){return state.autoSprint;},
    get fov(){return state.fov;},
    get quality(){return state.quality;},
    get maxFps(){return state.maxFps;},
    get audio(){return state.audio;},
    get shadowDistance(){return state.shadowDistance;},
    get shadowRefreshSeconds(){return state.shadowRefreshSeconds;},
    get characterShadowsEnabled(){return state.characterShadowsEnabled;},
    get characterShadowDistance(){return state.characterShadowDistance;},
    get shadowContrast(){return state.shadowContrast;},
    get grassDensity(){return state.grassDensity;},
    get grassDistance(){return state.grassDistance;},
    get grassMinSize(){return state.grassMinSize;},
    get grassMaxSize(){return state.grassMaxSize;},
    get grassWidth(){return state.grassWidth;},
    get grassFullDensityDistance(){return state.grassFullDensityDistance;},
    get grassFarDensityPercent(){return state.grassFarDensityPercent;},
    get grassDensitySharpness(){return state.grassDensitySharpness;},
    get grassDensityCoefficient(){return state.grassDensityCoefficient;},
    get grassDensityOffset(){return state.grassDensityOffset;},
    get grassFarWidthBonus(){return state.grassFarWidthBonus;},
    get grassTurnMin(){return state.grassTurnMin;},
    get grassTurnMax(){return state.grassTurnMax;},
    tick, tickPhysics, recordCpuFrame, setGpuFrameTime, close, setConnected, setLatency,
    setPerformancePreset(name){
      if(!PERFORMANCE_PRESETS[name])throw new Error('Unknown performance preset: '+name);
      qualitySelect.value=name;
      qualitySelect.onchange();
      return {preset:state.performancePreset,maxFps:state.maxFps,renderScale:state.renderScale};
    },
  open:()=>toggle.onclick(),
  setMenuMode(enabled){
    toggle.hidden=!!enabled;
    backdrop.className=enabled?'fc-settings-backdrop fc-settings-backdrop-menu':'fc-settings-backdrop';
    fps.hidden=!!enabled||!state.showFps;
  },
  destroy(){close();toggle.remove?.();backdrop.remove?.();panel.remove?.();fps.remove?.();css.remove?.();},
  };
}
