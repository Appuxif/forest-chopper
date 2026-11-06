// Shared game-editor configuration and world-space Voronoi grass.
import {FOREST_GRASS_PRESET} from './grass-generator-defaults.js';
import {makeGrassClumpGeometry} from './grass-clump-geometry.js?v=20261105-grass-tip1';

export const GRASS_EDITOR_FIELDS=Object.freeze([
  ['grassClusterBlades','bladesPerClump',1,10,1,'Травинок в пучке','шт'],
  ['grassClusterTriangles','trianglesPerBlade',1,10,1,'Треугольников на травинку','шт'],
  ['grassClusterMinHeight','minHeight',0.05,2,0.05,'Минимальная высота пучка','м'],
  ['grassClusterMaxHeight','maxHeight',0.05,2,0.05,'Максимальная высота пучка','м'],
  ['grassClusterSpread','spread',0.03,0.65,0.01,'Радиус раскрытия пучка','м'],
  ['grassClusterBladeWidth','bladeWidth',0.004,0.06,0.002,'Полуширина травинки','м'],
  ['grassClusterTipWidth','tipWidth',0,1,0.05,'Толщина кончика','%'],
  ['grassClusterTilt','leanAngle',0,80,1,'Наклон травинки','°'],
  ['grassClusterBend','bendAmount',0,1,0.01,'Изгиб дугой','×'],
  ['grassClusterWave','waveAmount',0,1,0.01,'Извилистость','×'],
  ['grassClusterRootUpright','rootUpright',0,1,0.01,'Плавный выход из земли','×'],
  ['grassClusterAngleSpread','bladeAngleSpread',0,360,1,'Разброс травинок в пучке','°'],
  ['grassClusterWindAlignment','windAlignment',0,1,0.01,'Выравнивание по ветру','×'],
  ['grassClusterWindDirection','windDirection',0,360,1,'Направление ветра','°'],
  ['grassClusterGapMin','clumpGapMin',0,1.5,0.05,'Мин. расстояние между пучками','м'],
  ['grassClusterGapMax','clumpGapMax',0,1.5,0.05,'Макс. расстояние между пучками','м'],
  ['grassClusterBladeGapMin','bladeGapMin',0,0.2,0.005,'Мин. интервал корней','м'],
  ['grassClusterBladeGapMax','bladeGapMax',0.005,0.2,0.005,'Макс. интервал корней','м'],
  ['grassClusterDensity','bladeDensity',1,200,1,'Плотность травинок','шт/м²'],
  ['grassClusterMicroGapMin','microGroupGapMin',0.5,5,0.05,'Мин. шаг микрогрупп','м'],
  ['grassClusterMicroGapMax','microGroupGapMax',0.5,5,0.05,'Макс. шаг микрогрупп','м'],
  ['grassClusterMicroRadius','microGroupRadius',0.1,1.5,0.05,'Радиус микрогруппы','м'],
  ['grassClusterMicroStrength','microGroupStrength',0,1,0.01,'Сила микрогруппировки','×'],
  ['grassClusterCells','voronoiCells',10,300,1,'Количество Voronoi-кластеров','шт'],
  ['grassClusterStrength','voronoiStrength',0,1,0.01,'Сила Voronoi','×'],
  ['grassClusterSoftness','voronoiEdgeSoftness',0.2,4,0.05,'Мягкость границ','×'],
  ['grassClusterWindSpeed','wind',0,1,0.05,'Ветер','×'],
  ['grassClusterTranslucencyIntensity','translucencyIntensity',0,1.5,0.005,'Просвечивание','×'],
  ['grassClusterAOIntensity','aoIntensity',0,1,0.01,'Сила AO у корней','×'],
  ['grassClusterTextureScale','groundTextureScale',2,12,0.5,'Масштаб покрытия земли','м'],
  ['grassClusterDensityStart','densityStart',0,30,1,'Полная плотность до','м'],
  ['grassClusterDensityReduction','densityReduction',0,100,1,'Разреживание вдали','%'],
  ['grassClusterWidthIncrease','widthIncrease',0,500,1,'Увеличение ширины вдали','%'],
  ['grassClusterSeed','seed',0,999999,1,'Seed модели травы',''],
]);
// Deliberately exclude the obsolete curved-editor blade shape, separate
// angle spread and redundant distance LOD controls from game settings.
export const GRASS_GAME_FIELD_KEYS=Object.freeze([
  'grassClusterBlades','grassClusterMinHeight','grassClusterMaxHeight',
  'grassClusterWindAlignment','grassClusterWindDirection',
  'grassClusterGapMin','grassClusterGapMax',
  'grassClusterBladeGapMin','grassClusterBladeGapMax','grassClusterDensity',
  'grassClusterMicroGapMin','grassClusterMicroGapMax',
  'grassClusterMicroRadius','grassClusterMicroStrength',
  'grassClusterCells','grassClusterStrength','grassClusterSoftness',
  'grassClusterWindSpeed','grassClusterTranslucencyIntensity',
  'grassClusterAOIntensity','grassClusterTextureScale',
]);
export const GRASS_CLUSTER_FIELDS=Object.freeze(GRASS_EDITOR_FIELDS
  .filter(([key])=>GRASS_GAME_FIELD_KEYS.includes(key))
  .map(([key,from,min,max,step,label,unit])=>
    [key,FOREST_GRASS_PRESET[from],min,max,step,label,unit]));

export const GRASS_CLUSTER_FLAGS=Object.freeze([
  ['grassClusterProceduralNormals','proceduralNormals','Procedural Normals'],
  ['grassClusterTranslucency','translucency','Translucency'],
  ['grassClusterAO','ambientOcclusion','AO'],
  ['grassClusterGroundTexture','groundTextureEnabled','Покрытие земли'],
]);
export const GRASS_CLUSTER_DEFAULTS=Object.freeze({
  ...Object.fromEntries(GRASS_CLUSTER_FIELDS.map(([key,v])=>[key,v])),
  ...Object.fromEntries(GRASS_CLUSTER_FLAGS.map(([key,from])=>[key,FOREST_GRASS_PRESET[from]])),
  grassClusterGroundType:FOREST_GRASS_PRESET.groundTextureType,
});

export function toGrassEditorConfig(settings={}) {
  const config={...FOREST_GRASS_PRESET};
  for(const [key,from] of GRASS_EDITOR_FIELDS)
    config[from]=settings[key]??FOREST_GRASS_PRESET[from];
  for(const [key,from] of GRASS_CLUSTER_FLAGS)
    config[from]=settings[key]??FOREST_GRASS_PRESET[from];
  config.groundTextureType=settings.grassClusterGroundType??config.groundTextureType;
  return config;
}

function hash(seed,x,z,channel=0){
  let n=(seed|0)^Math.imul(x|0,0x1b873593)^
    Math.imul(z|0,0x85ebca6b)^Math.imul(channel+1,0xc2b2ae35);
  n=Math.imul(n^(n>>>16),0x7feb352d);
  n=Math.imul(n^(n>>>15),0x846ca68b);
  return ((n^(n>>>16))>>>0)/4294967296;
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>t*t*(3-2*t);
const patchSeed=(seed,x,z,spacing)=>{
  const u=.15+.70*hash(seed,x,z,700);
  const v=.15+.70*hash(seed,x,z,701);
  return {
    x:(x+u)*spacing,z:(z+v)*spacing,
    height:hash(seed,x,z,702),
    yaw:hash(seed,x,z,703)*Math.PI*2,
    tint:hash(seed,x,z,705),
    density:.40+1.30*hash(seed,x,z,704),
  };
};

// One Voronoi centre per jittered world cell. The number setting represents
// the number of centres in a reference 70×70 m field, not a finite world map.
// Nearby sites and patch attributes are shared across tile boundaries.
export function createWorldVoronoi(seed,config) {
  const spacing=100/Math.sqrt(config.grassClusterCells);
  const edgeWidth=Math.max(.001,spacing*.20*config.grassClusterSoftness);
  const cells=new Map();
  function site(cx,cz){
    const id=cx+','+cz;
    let result=cells.get(id);
    if(!result){
      result=patchSeed(seed,cx,cz,spacing);
      cells.set(id,result);
    }
    return result;
  }
  return {
    spacing,
    sample(x,z){
      const gx=Math.floor(x/spacing),gz=Math.floor(z/spacing);
      let first=null,second=null,d1=Infinity,d2=Infinity;
      // Jitter is within each grid cell; sites outside the 5x5 ring cannot
      // be closer than the two closest sites in the inner neighbourhood.
      for(let cz=gz-2;cz<=gz+2;cz++)for(let cx=gx-2;cx<=gx+2;cx++){
        const s=site(cx,cz);
        const d=(s.x-x)**2+(s.z-z)**2;
        if(d<d1){d2=d1;second=first;d1=d;first=s;}
        else if(d<d2){d2=d;second=s;}
      }
      const border=clamp((Math.sqrt(d2)-Math.sqrt(d1))/edgeWidth,0,1);
      const interior=smooth(border);
      const influence=config.grassClusterStrength*interior;
      // No border penalty: blending fertility avoids Voronoi-shaped roads.
      const mix=(1-interior)*.5;
      const fertility=first.density*(1-mix)+second.density*mix;
      return {first,second,interior,influence,fertility};
    },
  };
}

export function createGrassClusterGeometry(THREE,config,seed=7) {
  return makeGrassClumpGeometry(THREE,{...toGrassEditorConfig(config),seed});
}

// Infinite, deterministic jittered microgroup centres: unlike the finite
// editor field, the world has no grass boundaries to create seams around.
export function createWorldMicrogroups(seed,config){
  const a=toGrassEditorConfig(config);
  const spacing=(a.microGroupGapMin+a.microGroupGapMax)*.5;
  const jitter=Math.min(spacing*.38,Math.max(0,(spacing-a.microGroupGapMin)*.5));
  const centres=new Map();
  function point(ix,iz){
    const key=ix+','+iz;
    let p=centres.get(key);
    if(!p){
      p={x:(ix+.5+(iz%2)*.22)*spacing+
        (hash(seed,ix,iz,901)-.5)*2*jitter,
        z:(iz+.5)*spacing+(hash(seed,ix,iz,902)-.5)*2*jitter,
        radius:a.microGroupRadius*(.8+.4*hash(seed,ix,iz,903)),
        id:key};
      centres.set(key,p);
    }
    return p;
  }
  return {
    nearest(x,z){
      const ix=Math.floor(x/spacing),iz=Math.floor(z/spacing);
      let chosen=null,best=Infinity;
      for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){
        const p=point(ix+dx,iz+dz);
        const d=(x-p.x)**2+(z-p.z)**2;
        if(d<best){best=d;chosen=p;}
      }
      return chosen;
    },
    place(x,z,i,tileX,tileZ,tileSize){
      const group=this.nearest(x,z);
      const angle=hash(seed,tileX,tileZ,i+904)*Math.PI*2;
      const d=Math.sqrt(hash(seed,tileX,tileZ,i+905))*group.radius;
      const strength=a.microGroupStrength;
      // Gradually preserve original positions near tile edges: crossing a
      // worker tile does not clamp group centres into artificial straight rows.
      const localX=x-tileX*tileSize,localZ=z-tileZ*tileSize;
      const margin=Math.max(.001,Math.min(localX,localZ,
        tileSize-localX,tileSize-localZ));
      const edge=Math.min(1,margin/1.1);
      const w=strength*edge*edge*(3-2*edge);
      return {
        x:clamp(x+(group.x+Math.cos(angle)*d-x)*w,
          tileX*tileSize,tileX*tileSize+tileSize-1e-6),
        z:clamp(z+(group.z+Math.sin(angle)*d-z)*w,
          tileZ*tileSize,tileZ*tileSize+tileSize-1e-6),
        groupId:group.id,
      };
    },
  };
}

export function generateClusteredGrassTile(seed,tileX,tileZ,size,config,
  accepts=()=>true,tier="near"){
  const list=[];
  const perSq=config.grassClusterDensity/config.grassClusterBlades;
  // Spatial budget comes from BOTH the requested density and the tuft
  // spacing: raising the maximum spacing really lowers the number of
  // candidates, rather than merely jittering their positions by a few cm.
  // The requested max gap cannot be guaranteed after density thinning.
  const meanGap=Math.max(.02,(config.grassClusterGapMin+
    config.grassClusterGapMax)*.5);
  const spatialCapacity=size*size/(meanGap*meanGap);
  const count=Math.max(1,Math.ceil(Math.min(size*size*perSq*1.32,spatialCapacity)));
  const phaseX=hash(seed,tileX,tileZ,301);
  const phaseZ=hash(seed,tileX,tileZ,302);
  const x0=tileX*size,z0=tileZ*size;
  const cluster=config.grassClusterStrength>0?createWorldVoronoi(seed,config):null;
  const grouped=config.grassClusterMicroStrength>0?createWorldMicrogroups(seed,config):null;
  const gapMin=config.grassClusterGapMin;
  const gapMax=config.grassClusterGapMax;
  // Respect minimum spacing with or without microgroups. Microgrouping
  // influences placement, but should never silently disable the slider.
  const occupied=new Map();
  const bucketStep=Math.max(.01,gapMin);
  const bucketKey=(bx,bz)=>bx+','+bz;
  function hasTooCloseNeighbour(x,z){
    if(gapMin<=0)return false;
    const bx=Math.floor(x/bucketStep),bz=Math.floor(z/bucketStep);
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      for(const pt of occupied.get(bucketKey(bx+dx,bz+dz))??[]){
        if((pt.x-x)**2+(pt.z-z)**2<gapMin*gapMin-1e-9)return true;
      }
    }
    return false;
  }
  function addOccupied(x,z){
    if(gapMin<=0)return;
    const bx=Math.floor(x/bucketStep),bz=Math.floor(z/bucketStep);
    const key=bucketKey(bx,bz);
    if(!occupied.has(key))occupied.set(key,[]);
    occupied.get(key).push({x,z});
  }
  // Preserve the requested spatial coverage in both tiers. The original
  // dev distance formula is the *only* distance-based thinning mechanism.
  // Far geometry uses fewer triangles per blade to offset the extra tufts.
  const baseProbability=Math.min(1,size*size*perSq/count);
  for(let i=0;i<count;i++){
    const u=(phaseX+(i+.5)*.7548776662466927)%1;
    const v=(phaseZ+(i+.5)*.5698402909980532)%1;
    const drift=gapMin+(gapMax-gapMin)*hash(seed,tileX,tileZ,i+13500);
    const direction=2*Math.PI*hash(seed,tileX,tileZ,i+14500);
    let x=x0+clamp(u*size+Math.cos(direction)*drift,0,size-1e-6);
    let z=z0+clamp(v*size+Math.sin(direction)*drift,0,size-1e-6);
    const moved=grouped?.place(x,z,i,tileX,tileZ,size);
    if(moved){x=moved.x;z=moved.z;}
    if(hasTooCloseNeighbour(x,z))continue;
    const accepted=accepts(x,z);
    if(!accepted)continue;
    const patch=cluster?.sample(x,z);
    const fertility=1+(patch?.fertility-1||0)*config.grassClusterStrength;
    const chance=Math.min(1,baseProbability*fertility);
    if(hash(seed,tileX,tileZ,i+840)>chance)continue;
    addOccupied(x,z);
    const heightRandom=hash(seed,tileX,tileZ,i+1300);
    const blend=(patch?.influence||0)*.87;
    const height=config.grassClusterMinHeight+
      (heightRandom*(1-blend)+(patch?.first.height??heightRandom)*blend)*
      (config.grassClusterMaxHeight-config.grassClusterMinHeight);
    const randomYaw=hash(seed,tileX,tileZ,i+1400)*Math.PI*2;
    const patchYaw=patch?.first.yaw??randomYaw;
    const patchBlend=(patch?.influence||0)*.85;
    const VoronoiYaw=randomYaw+Math.atan2(Math.sin(patchYaw-randomYaw),
      Math.cos(patchYaw-randomYaw))*patchBlend;
    const globalYaw=config.grassClusterWindDirection*Math.PI/180;
    const yaw=VoronoiYaw+Math.atan2(Math.sin(globalYaw-VoronoiYaw),
      Math.cos(globalYaw-VoronoiYaw))*config.grassClusterWindAlignment;
    const tintRandom=hash(seed,tileX,tileZ,i+1500);
    const tint=tintRandom*(1-(patch?.influence||0)*.65)+
      (patch?.first.tint??tintRandom)*(patch?.influence||0)*.65;
    list.push({x,z,height,yaw,tint,biome:0,
      groupId:moved?.groupId??null,
      patchKind:accepted===true?0:(accepted.patchKind??0),
      patchWeight:accepted===true?0:(accepted.patchWeight??0)});
  }
  return list;
}
