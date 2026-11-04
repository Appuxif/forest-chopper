import test from 'node:test';
import {readFileSync} from 'node:fs';
import {FOREST_GRASS_PRESET} from '../src/grass-generator-defaults.js';
import assert from 'node:assert/strict';
import {
  GRASS_CLUSTER_DEFAULTS,GRASS_CLUSTER_FIELDS,GRASS_EDITOR_FIELDS,GRASS_CLUSTER_FLAGS,
  toGrassEditorConfig,
  createWorldVoronoi,generateClusteredGrassTile,
  createGrassClusterGeometry,
} from '../src/grass-clustering.js';
import {grassTileData} from '../src/world-stream-data.js';
import {sanitizeSettings} from '../src/settings.js';
import {grassDistanceDensity} from '../src/micro-grass.js';

test('the requested game clustering defaults are real persisted settings',()=>{
  const s=sanitizeSettings({});
  for(const [key,value] of Object.entries(GRASS_CLUSTER_DEFAULTS))
    assert.equal(s[key],value,key);
  assert.equal(s.grassClusterEnabled,true);
  assert.ok(GRASS_CLUSTER_FIELDS.length>=28);
  const altered=sanitizeSettings({
    grassClusterEnabled:false,grassClusterDensity:199,grassClusterCells:120,
    grassClusterWindSpeed:.55,grassClusterMinHeight:.7,grassClusterMaxHeight:1.4,
  });
  assert.equal(altered.grassClusterEnabled,false);
  assert.equal(altered.grassClusterDensity,199);
  assert.equal(altered.grassClusterWindSpeed,.55);
});

test('Voronoi sampling is deterministic and world-space continuous at tile edges',()=>{
  const a=createWorldVoronoi(123,GRASS_CLUSTER_DEFAULTS);
  const b=createWorldVoronoi(123,GRASS_CLUSTER_DEFAULTS);
  const x=11.9999,z=-31.875;
  assert.deepEqual(a.sample(x,z),b.sample(x,z));
  const left=a.sample(x,z),right=a.sample(x+.0002,z);
  assert.ok(Math.abs(left.fertility-right.fertility)<.01);
  assert.ok(Math.abs(left.interior-right.interior)<.01);
});

test('clustered generator emits physically bounded, single-height pouches',()=>{
  const cfg={...GRASS_CLUSTER_DEFAULTS,grassClusterDensity:40};
  const first=generateClusteredGrassTile(789,0,0,12,cfg,()=>true);
  const again=generateClusteredGrassTile(789,0,0,12,cfg,()=>true);
  const far=generateClusteredGrassTile(789,0,0,12,cfg,()=>true,'far');
  assert.deepEqual(first,again);
  assert.ok(first.length>400);
  assert.equal(far.length,first.length,
    'far tiles must not lose 65% of their clumps before dev distance LOD');
  assert.ok(first.every(p=>p.x>=0&&p.x<12&&p.z>=0&&p.z<12));
  assert.ok(first.every(p=>p.height>=cfg.grassClusterMinHeight&&p.height<=cfg.grassClusterMaxHeight));
  assert.ok(new Set(first.map(p=>Math.round(p.height*100))).size>=10);
  const regions=new Set(first.map(p=>[Math.floor(p.x/2),Math.floor(p.z/2)].join(',')));
  assert.ok(regions.size>30);
});

test('one instanced pouch has exactly blades*triangles and normalized vertex heights',()=>{
  class Attribute{constructor(data,n){this.array=data;this.count=data.length/n;}}
  class Geometry{
    constructor(){this.attrs={};this.index=null;}
    setAttribute(key,v){this.attrs[key]=v;}
    setIndex(index){this.index=index;}
    computeVertexNormals(){}
  }
  const THREE={BufferGeometry:Geometry,Float32BufferAttribute:Attribute};
  for(const blades of [1,5,10])for(const triangles of [1,3,6,10]){
    const geometry=createGrassClusterGeometry(THREE,{...GRASS_CLUSTER_DEFAULTS,
      grassClusterBlades:blades,grassClusterTriangles:triangles});
    assert.equal(geometry.index.length/3,blades*triangles);
    assert.ok(geometry.attrs.position.array.every(Number.isFinite));
    const vertexCount=blades*(triangles+2);
    assert.equal(geometry.attrs.fcGrassAO.count,vertexCount);
    assert.equal(geometry.attrs.fcGrassRibbonSide.count,vertexCount);
    const ao=geometry.attrs.fcGrassAO.array;
    assert.ok(ao.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
    assert.ok(ao[0]<ao[triangles+1],'crowded roots shade more than leaf tips');
    const side=geometry.attrs.fcGrassRibbonSide.array;
    assert.ok(side.every(v=>v===1||v===-1));
    const heights=geometry.attrs.position.array.filter((_,i)=>i%3===1);
    assert.ok(heights.every(v=>v>=0&&v<=1));
  }
});

test('worker preserves 9-float tile layout for game instance matrices',()=>{
  const cfg={...GRASS_CLUSTER_DEFAULTS,grassClusterDensity:25};
  const packed=grassTileData({seed:88,tx:0,tz:0,size:12,density:25,
    tier:'near',clusterConfig:cfg});
  assert.ok(packed instanceof Float32Array);
  assert.equal(packed.length%9,0);
  assert.ok(packed.length>0);
  for(let i=0;i<packed.length;i+=9){
    assert.ok(packed[i+4]>=cfg.grassClusterMinHeight-.0001);
    assert.ok(packed[i+4]<=cfg.grassClusterMaxHeight+.0001);
  }
});

test('dev distance formula is preserved and not replaced with editor t^k',()=>{
  assert.equal(grassDistanceDensity(0,50),1);
  assert.ok(grassDistanceDensity(33,50,{sharpness:.005})>
    grassDistanceDensity(45,50,{sharpness:.005}));
});

test('grass density increases until spatial spacing capacity is reached',()=>{
  const sample=(density,tier='far')=>generateClusteredGrassTile(57,1,2,
    tier==='far'?24:12,
    {...GRASS_CLUSTER_DEFAULTS,grassClusterDensity:density},()=>true,tier);
  const low=sample(25).length,mid=sample(50).length,high=sample(200).length;
  assert.ok(low<mid*.65,{low,mid});
  assert.ok(high>=mid,{mid,high});
  assert.ok(sample(50,'near').length>sample(25,'near').length*1.35);
});

test('spacing controls upper spatial capacity independently of target density',()=>{
  const sample=max=>generateClusteredGrassTile(57,1,2,12,
    {...GRASS_CLUSTER_DEFAULTS,grassClusterDensity:200,
      grassClusterGapMax:max},()=>true).length;
  const tight=sample(.15),wide=sample(.5),veryWide=sample(1.5);
  assert.ok(tight>wide*1.2,{tight,wide});
  assert.ok(wide>veryWide*2,{wide,veryWide});
});

test('blade angle sector reproduces parallel and spread-out editors',()=>{
  class Attribute{constructor(data,n){this.array=data;this.count=data.length/n;}}
  class Geometry{
    constructor(){this.attrs={};}
    setAttribute(k,v){this.attrs[k]=v;}
    setIndex(i){this.index=i;}
    computeVertexNormals(){}
  }
  const THREE={BufferGeometry:Geometry,Float32BufferAttribute:Attribute};
  const parallel=createGrassClusterGeometry(THREE,
    {...GRASS_CLUSTER_DEFAULTS,grassClusterAngleSpread:0});
  const fan=createGrassClusterGeometry(THREE,
    {...GRASS_CLUSTER_DEFAULTS,grassClusterAngleSpread:180});
  const p=parallel.attrs.fcGrassDirection.array;
  const q=fan.attrs.fcGrassDirection.array;
  for(let i=0;i<p.length;i+=2)
    assert.ok(Math.abs(p[i]-1)<1e-6&&Math.abs(p[i+1])<1e-6);
  assert.ok(q.some((value,i)=>i%2===1&&Math.abs(value)>.2));
});

test('global wind alignment keeps every Voronoi clump pointing the same way at full strength',()=>{
  const cfg={...GRASS_CLUSTER_DEFAULTS,grassClusterDensity:35,
    grassClusterWindAlignment:1,grassClusterWindDirection:135};
  const a=generateClusteredGrassTile(991,1,2,12,cfg,()=>true);
  const b=generateClusteredGrassTile(991,-8,9,12,cfg,()=>true);
  const target=135*Math.PI/180;
  for(const clump of [...a,...b]){
    const diff=Math.atan2(Math.sin(clump.yaw-target),Math.cos(clump.yaw-target));
    assert.ok(Math.abs(diff)<1e-8);
  }
});

test('increasing spread preserves triangle count but increases tip displacement',()=>{
  class Attribute{constructor(data,n){this.array=data;this.count=data.length/n;}}
  class Geometry{
    constructor(){this.attrs={};}
    setAttribute(k,a){this.attrs[k]=a;}
    setIndex(i){this.index=i;}
    computeVertexNormals(){}
  }
  const THREE={BufferGeometry:Geometry,Float32BufferAttribute:Attribute};
  const make=spread=>createGrassClusterGeometry(THREE,{
    ...GRASS_CLUSTER_DEFAULTS,grassClusterSpread:spread,
    grassClusterAngleSpread:0,
  });
  const small=make(.03),wide=make(.5);
  const tipMax=(g)=>{
    const p=g.attrs.position.array;
    let furthest=0;
    for(let i=0;i<p.length;i+=3)
      if(p[i+1]>.6)furthest=Math.max(furthest,Math.hypot(p[i],p[i+2]));
    return furthest;
  };
  assert.equal(small.index.length,wide.index.length);
  assert.ok(tipMax(wide)>tipMax(small)*1.2);
});


test('the uploaded JSON is exactly the runtime preset, including game controls',()=>{
  const file=JSON.parse(readFileSync(new URL(
    '../assets/presets/grass-generator-default.json',import.meta.url),'utf8'));
  assert.deepEqual(FOREST_GRASS_PRESET,file);
  const settings=sanitizeSettings({});
  assert.deepEqual(toGrassEditorConfig(settings),file);
  for(const [key,field] of GRASS_EDITOR_FIELDS){
    assert.equal(settings[key],FOREST_GRASS_PRESET[field],key);
  }
  for(const [key,field] of GRASS_CLUSTER_FLAGS){
    assert.equal(settings[key],FOREST_GRASS_PRESET[field],key);
  }
  assert.equal(settings.grassClusterEnabled,true);
  assert.equal(settings.grassClusterDensityCurve,.17);
  assert.equal(settings.grassClusterWidthIncrease,455);
  assert.equal(settings.grassClusterGroundType,'forest');
});

test('preserved rational LOD can be shaped with editor curve on CPU',()=>{
  const c={nearEnd:10,minDensity:0,sharpness:.000001,coefficient:0,offset:30};
  assert.equal(grassDistanceDensity(5,100,{...c,curve:.17}),1);
  assert.equal(grassDistanceDensity(95,100,{...c,curve:0}),1);
  assert.ok(grassDistanceDensity(35,100,{...c,curve:.17})<
    grassDistanceDensity(35,100,{...c,curve:1}));
});
