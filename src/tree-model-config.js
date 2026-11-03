// The three graphics quality levels store independent procedural-tree presets.
// Pure JS: no Three.js/browser dependencies, safe to validate even before WebGL.
import {SPRUCE_PRESET,BIRCH_PRESET} from './tree-model-presets.js?v=20261103-shared-birch-all1';
export const TREE_MODEL_KEY='forest-chopper:tree-model-profiles:v1';
export const GRAPHICS_KEY='forest-chopper:settings:v1';
// One-time migrations update the approved tree templates across all model
// qualities. The opposite species is kept intact when only one is migrated.
export const SPRUCE_PROFILE_MIGRATION_KEY='forest-chopper:spruce-model-shared-5000:v1';
export const BIRCH_PROFILE_MIGRATION_KEY='forest-chopper:birch-model-shared-6500:v1';
export const TREE_QUALITIES=['low','balanced','high'];

const N=(name,min,max,step=1,group='geometry',hint='')=>({name,min,max,step,group,hint,type:'number'});
const B=(name,group='geometry',hint='')=>({name,group,hint,type:'boolean'});
const C=(name,group='color')=>({name,group,type:'color'});
const A=(name,group='crown')=>({name,group,type:'array',hint:'Числа через запятую. Пусто = автоматически.'});

export const TREE_FIELDS={
  spruce:{
    generatorQuality:{name:'Качество геометрии ветвей',type:'select',choices:['low','balanced','high'],group:'render',hint:'Управляет числом граней и вторичных веток. Отдельно от качества разрешения игры.'},
    seed:N('Seed (форма)',0,999999,1,'trunk'),
    trunkHeight:N('Высота генератора',2,14,.25,'trunk','Влияет на фактический размер: игровая высота масштабируется от базовых 6 м.'),
    trunkRadius:N('Радиус ствола',.05,.8,.01,'trunk'),
    barkColor:C('Цвет коры','trunk'),
    branchStartHeight:N('Начало ветвей, м',.2,9,.1,'crown'),
    whorls:N('Ярусы ветвей',4,24,1,'crown'),
    branchesPerWhorl:A('Ветвей по ярусам','crown'),
    levels:N('Уровни ветвления',1,2,1,'crown'),
    crownRatio:N('Верхняя точка кроны',.6,.99,.01,'crown'),
    basePitch:N('Наклон нижних ветвей, °',-45,45,1,'crown'),
    topPitch:N('Наклон верхних ветвей, °',-30,65,1,'crown'),
    level1Length:N('Длина основных ветвей, м',.15,5,.05,'crown'),
    level2LengthFactor:N('Длина вторичных (доля)',.1,.8,.05,'crown'),
    secondaryBranchDensity:N('Плотность вторичных ветвей',0,3,.1,'crown'),
    showSecondaryBranches:B('Показывать геометрию вторичных ветвей','crown'),
    cardCountPerBranch:N('Карточек на ветвь',1,30,1,'foliage'),
    cardLengthScale:N('Длина карточек (×)',.3,2.5,.05,'foliage'),
    cardWidthScale:N('Ширина карточек (×)',.3,2.5,.05,'foliage'),
    cardSpread:N('Разброс поворота карточек, °',0,90,1,'foliage'),
    cardCrossed:B('Перекрещивать карточки','foliage','Две карточки на цель; увеличивает плотность и количество треугольников.'),
    cardAlphaTest:N('Alpha test',.05,.9,.01,'foliage'),
    showFoliage:B('Генерировать хвою','foliage'),
    leafColor:C('Основной цвет хвои','foliage'),
    leafAccent:C('Светлая хвоя','foliage'),
    maxTriangles:N('Лимит треугольников на ель',2000,40000,500,'render'),
  },
  birch:{
    seed:N('Seed (форма)',0,999999,1,'trunk'),
    trunkHeight:N('Высота генератора',3,20,.25,'trunk','Влияет на размер: игровая высота масштабируется от базовых 8 м.'),
    trunkRadius:N('Радиус ствола',.07,.7,.01,'trunk'),
    trunkCurve:N('Кривизна ствола',0,1,.01,'trunk'),
    barkColor:C('Цвет берёзовой коры','trunk'),
    barkMarkColor:C('Цвет тёмных отметин','trunk'),
    woodColor:C('Цвет ветвей','trunk'),
    branchStartHeight:N('Начало ветвления, м',.3,12,.1,'crown'),
    branchCount:N('Количество основных ветвей',4,125,1,'crown'),
    branchLength:N('Длина ветвей, м',.3,5,.05,'crown'),
    branchPitch:N('Наклон нижних ветвей, °',-10,80,1,'crown'),
    branchTopPitch:N('Наклон верхних ветвей, °',-10,85,1,'crown'),
    branchDroop:N('Свисание ветвей',0,1.5,.05,'crown'),
    branchCurve:N('Извилистость ветвей',0,1,.05,'crown'),
    shootsPerBranch:N('Побегов на ветвь',0,20,1,'shoots'),
    shootLength:N('Длина побегов, м',.3,3,.05,'shoots'),
    shootDroop:N('Свисание побегов',0,2,.05,'shoots'),
    showShootWood:B('Геометрия древесины побегов','shoots'),
    cardsPerShoot:N('Карточек на побег',1,12,1,'foliage'),
    cardLengthScale:N('Длина карточек (×)',.3,3,.05,'foliage'),
    cardWidthScale:N('Ширина карточек (×)',.3,3,.05,'foliage'),
    cardTwist:N('Поворот карточек, °',0,90,1,'foliage'),
    cardCrossed:B('Перекрещивать карточки','foliage'),
    cardAlphaTest:N('Alpha test',.05,.9,.01,'foliage'),
    leafCount:N('Листьев на веточке атласа',3,60,1,'foliage'),
    showFoliage:B('Генерировать листву','foliage'),
    leafColor:C('Основной цвет листьев','foliage'),
    leafAccent:C('Светлые листья','foliage'),
    maxTriangles:N('Лимит треугольников на берёзу',1200,25000,100,'render'),
  },
};
export const TREE_GROUPS={
  spruce:{trunk:'Ствол и кора',crown:'Ветви и форма кроны',foliage:'Хвоя и Foliage Cards',render:'Производительность'},
  birch:{trunk:'Ствол и кора',crown:'Основные ветви',shoots:'Побеги',foliage:'Листва и Foliage Cards',render:'Производительность'},
};
const DEFAULTS={spruce:SPRUCE_PRESET.params,birch:BIRCH_PRESET.params};
export function defaultTreeModel(species){
  const params=DEFAULTS[species];
  if(!params)throw Error('Unknown tree species');
  const value=JSON.parse(JSON.stringify(params));
  if(species==='spruce'){
    // The old editor preset contains trunkStyle, but the current foliage-card
    // generator ignores it. Do not advertise a setting that has no effect.
    delete value.trunkStyle;
    value.generatorQuality=params.generatorQuality??'high';
  }
  return value;
}
// Graphics LOD limits may only reduce the model's own triangle budget.
export function limitTreeModelTriangles(model,graphicsBudget){
  return {...model,maxTriangles:Math.min(model.maxTriangles,graphicsBudget)};
}
// Backwards-compatible helper used by earlier tests.
export const limitSpruceModelTriangles=limitTreeModelTriangles;
export function sanitizeTreeModel(species,source){
  const valid=source&&typeof source==='object'&&!Array.isArray(source)?source:{};
  const defaults=defaultTreeModel(species);
  const out={};
  for(const [key,field] of Object.entries(TREE_FIELDS[species])){
    const value=valid[key],fallback=defaults[key];
    if(field.type==='boolean')out[key]=typeof value==='boolean'?value:fallback;
    else if(field.type==='color')out[key]=typeof value==='string'&&/^#[a-fA-F0-9]{6}$/.test(value)?value.toLowerCase():fallback;
    else if(field.type==='select')out[key]=field.choices.includes(value)?value:fallback;
    else if(field.type==='array'){
      out[key]=Array.isArray(value)&&value.length<=24
        &&value.every(n=>Number.isInteger(n)&&n>=0&&n<=10)?value.slice():fallback.slice();
    }else{
      const number=typeof value==='number'?value:NaN;
      if(Number.isFinite(number)&&number>=field.min&&number<=field.max){
        const precision=String(field.step).split('.')[1]?.length??0;
        out[key]=Number((Math.round(number/field.step)*field.step).toFixed(precision));
      }else out[key]=fallback;
    }
  }
  return out;
}
export function defaultTreeProfiles(){
  return Object.fromEntries(TREE_QUALITIES.map(q=>[q,{
    spruce:defaultTreeModel('spruce'),birch:defaultTreeModel('birch'),
  }]));
}
export function sanitizeTreeProfiles(source){
  const profiles={};
  for(const quality of TREE_QUALITIES){
    profiles[quality]={
      spruce:sanitizeTreeModel('spruce',source?.[quality]?.spruce),
      birch:sanitizeTreeModel('birch',source?.[quality]?.birch),
    };
  }
  return profiles;
}
export function loadTreeProfiles(storage){
  try{
    const raw=storage?.getItem(TREE_MODEL_KEY);
    const profiles=sanitizeTreeProfiles(JSON.parse(raw??'null'));
    if(raw){
      const migrateSpruce=storage?.getItem(SPRUCE_PROFILE_MIGRATION_KEY)!=='1';
      const migrateBirch=storage?.getItem(BIRCH_PROFILE_MIGRATION_KEY)!=='1';
      if(migrateSpruce||migrateBirch){
        for(const quality of TREE_QUALITIES){
          if(migrateSpruce)profiles[quality].spruce=defaultTreeModel('spruce');
          if(migrateBirch)profiles[quality].birch=defaultTreeModel('birch');
        }
        try{
          storage?.setItem?.(TREE_MODEL_KEY,JSON.stringify(profiles));
          if(migrateSpruce)storage?.setItem?.(SPRUCE_PROFILE_MIGRATION_KEY,'1');
          if(migrateBirch)storage?.setItem?.(BIRCH_PROFILE_MIGRATION_KEY,'1');
        }catch{/* readonly storage still gets updated in-memory profiles */}
      }
    }
    return profiles;
  }catch{return defaultTreeProfiles();}
}
export function saveTreeProfiles(storage,profiles){
  if(typeof storage?.setItem!=='function')return false;
  try{
    storage.setItem(TREE_MODEL_KEY,JSON.stringify(sanitizeTreeProfiles(profiles)));
    storage.setItem(SPRUCE_PROFILE_MIGRATION_KEY,'1');
    storage.setItem(BIRCH_PROFILE_MIGRATION_KEY,'1');
    return true;
  }catch{return false;}
}
export function readActiveTreeConfig(storage){
  let local=storage;
  if(local===undefined){
    try{local=window.localStorage;}catch{local=null;}
  }
  let quality='balanced';
  try{
    const q=JSON.parse(local?.getItem(GRAPHICS_KEY)??'null')?.quality;
    if(TREE_QUALITIES.includes(q))quality=q;
  }catch{/* default */}
  const profiles=loadTreeProfiles(local);
  return {quality,models:profiles[quality]};
}
