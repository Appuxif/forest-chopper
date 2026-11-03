import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDistantForest,distantForestRange,distanceToLakeShore,
  DISTANT_FOREST_BASE_METERS,DISTANT_FOREST_LAKE_METERS,
  DISTANT_FOREST_SHORE_WIDTH,
} from '../src/distant-forest.js';
import {lakeAt,lakePoint,lakeHorizonDistance} from '../src/lakes.js';
import {terrainHeight} from '../src/terrain.js';
import {forestChunkData} from '../src/world-stream-data.js';
import {treeCanSpawn,treeCandidate,TREES_PER_CHUNK} from '../src/tree-spacing.js';

function fixture(){
  const objects=new Set(),disposed={geometry:0,material:0,mesh:0};
  class Geometry {dispose(){disposed.geometry++;}}
  class Material {dispose(){disposed.material++;}}
  class Object3D {
    constructor(){
      this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});}};
      this.rotation={set(){}};
      this.scale={x:1,y:1,z:1,set(x,y,z){Object.assign(this,{x,y,z});}};
    }
    updateMatrix(){
      this.matrix={position:{...this.position},scale:{...this.scale}};
    }
  }
  class InstancedMesh{
    constructor(geometry,material,capacity){
      this.geometry=geometry;this.material=material;this.capacity=capacity;
      this.count=0;this.matrices=new Map();
      this.instanceMatrix={needsUpdate:false};
    }
    setMatrixAt(i,m){this.matrices.set(i,{
      position:{...m.position},scale:{...m.scale},
    });}
    computeBoundingSphere(){this.boundsUpdates=(this.boundsUpdates??0)+1;}
    dispose(){disposed.mesh++;}
  }
  const THREE={InstancedMesh,Object3D};
  const parts={conifer:[{geometry:new Geometry(),material:new Material()},
    {geometry:new Geometry(),material:new Material(),foliage:true}],
    birch:[{geometry:new Geometry(),material:new Material()},
      {geometry:new Geometry(),material:new Material()},
      {geometry:new Geometry(),material:new Material(),foliage:true}]};
  const ctx={
    THREE,scene:{add:o=>objects.add(o),remove:o=>objects.delete(o)},
    px:0,pz:0,chunkSize:24,radius:3,seed:67890,
    chunks:new Map(),trees:new Map(),felled:new Set(),distantTreeParts:parts,
    terrain:{visibilityTarget:0,visibility:0},
  };
  const distant=createDistantForest(ctx);
  const complete=()=>{
    for(let i=0;i<250&&distant.pending>0;i++)distant.update();
    assert.equal(distant.pending,0,'all desired distant chunks should stream');
  };
  return {ctx,distant,complete,objects,disposed,parts};
}
function meshes(f,kind){
  return [...f.distant.meshes.values()].flatMap(sector=>sector.byKind[kind]);
}
function transforms(f,kind){
  return [...f.distant.meshes.values()].flatMap(sector=>{
    const first=sector.byKind[kind][0];
    return first?[...first.matrices.entries()]
      .filter(([i])=>i<first.count).map(([,m])=>m):[];
  });
}
function allTransforms(f){
  return [...transforms(f,'conifer'),...transforms(f,'birch')];
}
function rand(seed,x,z,n=0){
  const v=Math.sin(x*127.1+z*311.7+n*78.233+seed)*43758.5453;
  return v-Math.floor(v);
}

test('distant forest creates independent frustum-culled sectors and owns only instance buffers',()=>{
  const f=fixture();
  f.distant.update();f.complete();
  assert.ok(f.distant.sectorCount>1);
  assert.equal(f.objects.size,
    meshes(f,'conifer').length+meshes(f,'birch').length);
  assert.ok(f.distant.count>400&&f.distant.count<5000);
  assert.equal(allTransforms(f).length,f.distant.count);
  for(const sector of f.distant.meshes.values()){
    for(const kind of ['conifer','birch']){
      for(const mesh of sector.byKind[kind]){
        assert.equal(mesh.count,sector.byKind[kind][0].count);
        assert.equal(mesh.frustumCulled,true);
        assert.equal(mesh.castShadow,false);
        assert.ok(mesh.count<=mesh.capacity);
        assert.ok(mesh.capacity<=16*TREES_PER_CHUNK);
        assert.ok(mesh.boundsUpdates>0);
      }
    }
  }
  const meshCount=f.objects.size;
  f.distant.dispose();
  assert.equal(f.objects.size,0);
  assert.deepEqual(f.disposed,{geometry:0,material:0,mesh:meshCount},
    'shared geometry/materials belong to the tree templates');
});

test('shoreline extension populates the far bank without filling the entire full disk',()=>{
  const f=fixture();
  const lake=lakeAt(f.ctx.seed,0,-1);
  const [x,z]=lakePoint(lake,1.06,Math.PI/3);
  f.ctx.px=x;f.ctx.pz=z;
  assert.equal(distantForestRange(f.ctx.terrain),DISTANT_FOREST_BASE_METERS);
  f.distant.update();f.complete();
  const baseCount=f.distant.count;
  f.ctx.terrain.visibilityTarget=1;
  const dynamic=distantForestRange(f.ctx.terrain,[lake],x,z);
  assert.ok(dynamic>DISTANT_FOREST_BASE_METERS);
  assert.ok(dynamic<=DISTANT_FOREST_LAKE_METERS);
  assert.ok(dynamic<lakeHorizonDistance(lake,x,z,DISTANT_FOREST_SHORE_WIDTH+12)+.001);
  f.distant.update();f.complete();
  assert.ok(f.distant.count>baseCount);
  assert.ok(f.distant.count<baseCount+2500);
  const far=allTransforms(f).filter(m=>Math.hypot(m.position.x-x,m.position.z-z)>208);
  assert.ok(far.length>0);
  assert.equal(far.filter(m=>distanceToLakeShore(lake,
    m.position.x,m.position.z)>DISTANT_FOREST_SHORE_WIDTH+48).length,0);
  f.distant.dispose();
});

test('different lake sizes and player distances determine the panorama limit',()=>{
  const f=fixture();
  const small={rx:50,rz:45,x:150,z:0},large={rx:145,rz:130,x:150,z:0};
  f.ctx.terrain.visibilityTarget=1;
  assert.ok(distantForestRange(f.ctx.terrain,[small],0,0)
    <distantForestRange(f.ctx.terrain,[large],0,0));
  assert.ok(distantForestRange(f.ctx.terrain,[large],-100,0)
    >=distantForestRange(f.ctx.terrain,[large],100,0));
  assert.equal(distantForestRange(f.ctx.terrain,[],0,0),DISTANT_FOREST_BASE_METERS);
  f.distant.dispose();
});

test('worker records preserve exact seeded tree coordinates, species and terrain height',()=>{
  const f=fixture();
  f.distant.update();f.complete();
  const tree=allTransforms(f).find(m=>m.position.x>120&&m.position.z>20);
  assert.ok(tree);
  const cx=Math.floor(tree.position.x/24),cz=Math.floor(tree.position.z/24);
  const random=(x,z,n)=>rand(f.ctx.seed,x,z,n);
  const candidates=new Set();
  for(let i=0;i<TREES_PER_CHUNK;i++){
    if(!treeCanSpawn(cx,cz,i,random,24))continue;
    const pt=treeCandidate(cx,cz,i,random,24);
    if(pt)candidates.add(pt.x+','+pt.z);
  }
  assert.ok(candidates.has(tree.position.x+','+tree.position.z));
  assert.equal(tree.position.y,terrainHeight(f.ctx.seed,tree.position.x,tree.position.z));
  assert.ok(tree.scale.y>0);
  const records=forestChunkData({seed:f.ctx.seed,cx,cz,size:24,density:100});
  assert.ok(records instanceof Float64Array);
  assert.ok(records.some((v,i)=>i%7===0&&v===tree.position.x));
  f.distant.dispose();
});

test('felled trees are removed by sector update; moving player releases old sectors',()=>{
  const f=fixture();
  f.distant.update();f.complete();
  const before=f.distant.count;
  const tree=allTransforms(f).find(m=>m.position.x>120&&m.position.z>20);
  assert.ok(tree);
  const cx=Math.floor(tree.position.x/24),cz=Math.floor(tree.position.z/24);
  const ids=[];
  for(let i=0;i<TREES_PER_CHUNK;i++){
    const random=(x,z,n)=>rand(f.ctx.seed,x,z,n);
    if(!treeCanSpawn(cx,cz,i,random,24))continue;
    const pt=treeCandidate(cx,cz,i,random,24);
    if(pt?.x===tree.position.x&&pt?.z===tree.position.z)
      ids.push(cx+','+cz+':'+i);
  }
  assert.equal(ids.length,1);
  f.ctx.felled.add(ids[0]);
  f.distant.invalidateTree(ids[0]);
  f.complete();
  assert.equal(f.distant.count,before-1);
  f.ctx.px=1800;f.ctx.pz=-2300;
  f.distant.update();f.complete();
  assert.ok(f.distant.count>0);
  assert.ok(allTransforms(f).every(m=>Math.hypot(
    m.position.x-1800,m.position.z+2300)<210));
  f.distant.clear();
  assert.equal(f.distant.count,0);
  assert.equal(f.objects.size,0);
  f.distant.dispose();
});

test('far forest range/density settings preserve the subset of seeded coordinates',()=>{
  const f=fixture();
  f.ctx.settings={farForestDistance:110,farTreeDensity:50,lakeForestMode:'off'};
  f.distant.update();f.complete();
  const small=f.distant.count;
  const points=new Set(allTransforms(f).map(m=>m.position.x+','+m.position.z));
  assert.ok(small>0);
  f.ctx.settings.farForestDistance=165;
  f.ctx.settings.farTreeDensity=100;
  f.distant.update();f.complete();
  assert.ok(f.distant.count>small);
  const all=new Set(allTransforms(f).map(m=>m.position.x+','+m.position.z));
  assert.ok([...points].every(point=>all.has(point)));
  f.distant.dispose();
});

test('Ultra populates full lake horizon and Low disables lake panorama',()=>{
  const lake={x:150,z:0,rx:85,rz:70};
  const terrain={visibility:1,visibilityTarget:1};
  assert.equal(distantForestRange(terrain,[lake],0,0,{
    farForestDistance:200,lakeForestMode:'full',lakeViewDistance:450,
  }),450);
  assert.equal(distantForestRange(terrain,[lake],0,0,{
    farForestDistance:110,lakeForestMode:'off',lakeViewDistance:450,
  }),110);
  assert.ok(distantForestRange(terrain,[lake],0,0,{
    farForestDistance:165,lakeForestMode:'shore',lakeViewDistance:380,
  })<450);
});

test('camera rotation keeps sector instance buffers unchanged (frustum handled by Three.js)',()=>{
  const f=fixture();
  f.distant.update();f.complete();
  const before=f.distant.count;
  const instances=[...f.objects];
  instances.forEach(m=>m.instanceMatrix.needsUpdate=false);
  f.distant.updateVisibility(0);
  f.distant.updateVisibility(Math.PI);
  assert.equal(f.distant.count,before);
  assert.deepEqual([...f.objects],instances);
  assert.ok(instances.every(m=>m.instanceMatrix.needsUpdate===false));
  f.distant.dispose();
});


test('distant forest ignores lakes during deep night and limits draw range',()=>{
 const terrain={visibility:1,visibilityTarget:1,nightBlend:1,nightViewDistance:100};
 const lake=lakeAt(123456,0,-1);
 assert.equal(distantForestRange(terrain,[lake],lake.x,lake.z,
   {lakeForestMode:'full',farForestDistance:165,lakeViewDistance:450}),100);
 terrain.nightBlend=0;
 assert.equal(distantForestRange(terrain,[lake],lake.x,lake.z,
   {lakeForestMode:'full',farForestDistance:165,lakeViewDistance:450}),450);
});
