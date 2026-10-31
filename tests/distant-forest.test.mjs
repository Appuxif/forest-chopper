import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDistantForest,distantForestRange,distanceToLakeShore,
  DISTANT_FOREST_BASE_METERS,DISTANT_FOREST_LAKE_METERS,
  DISTANT_FOREST_SHORE_WIDTH,
} from '../src/distant-forest.js';
import {lakeAt,lakePoint,lakeHorizonDistance,lakeNormalized} from '../src/lakes.js';
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
    setMatrixAt(i,m){this.matrices.set(i,{position:{...m.position},scale:{...m.scale}});}
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
    terrain:{visibilityTarget:0,visibility:0,
      waterDepthAt(){return 0;},
      heightAt(x,z){return .01*x+.002*z;}},
  };
  const distant=createDistantForest(ctx);
  const complete=()=>{
    for(let i=0;i<100&&distant.pending>0;i++)distant.update();
    assert.equal(distant.pending,0,'distant forest chunks should finish streaming');
  };
  return {ctx,distant,complete,objects,disposed,parts};
}
function transforms(f,kind){
  const first=f.distant.meshes[kind][0];
  return [...first.matrices.entries()]
    .filter(([i])=>i<first.count)
    .map(([,m])=>m);
}
function allTransforms(f){
  return [...transforms(f,'conifer'),...transforms(f,'birch')];
}
function rand(seed,x,z,n=0){
  const v=Math.sin(x*127.1+z*311.7+n*78.233+seed)*43758.5453;
  return v-Math.floor(v);
}

test('distant procedural forest reuses shared spruce/birch templates and releases only instances',()=>{
  const f=fixture();
  f.distant.update();f.complete();
  assert.equal(f.objects.size,5,'2 spruce and 3 birch parts are each instanced once');
  assert.ok(f.distant.count>400&&f.distant.count<5000);
  assert.ok(f.distant.chunkCount>0);
  assert.equal(allTransforms(f).length,f.distant.count);
  for(const kind of ['conifer','birch']){
    const count=f.distant.meshes[kind][0].count;
    for(const mesh of f.distant.meshes[kind]){
      assert.equal(mesh.count,count,'every model part has the same instance transform count');
      assert.equal(mesh.frustumCulled,false);
      assert.equal(mesh.castShadow,false);
      assert.ok(mesh.count<=mesh.capacity);
    }
  }
  f.distant.dispose();
  assert.equal(f.objects.size,0);
  assert.deepEqual(f.disposed,{geometry:0,material:0,mesh:5},
    'geometry/materials/texture atlases belong to the shared templates');
});

test('lake perimeter grows visibility only along the shoreline, not into a 410m full disk',()=>{
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
  assert.ok(f.distant.count>baseCount,'the far lake bank is populated');
  assert.ok(f.distant.count<baseCount+2500,'do not populate the whole distant forest disk');
  const distant=allTransforms(f).filter(m=>Math.hypot(m.position.x-x,m.position.z-z)>208);
  assert.ok(distant.length>0,'trees appear across the lake');
  const offShore=distant.filter(m=>distanceToLakeShore(
    lake,m.position.x,m.position.z)>DISTANT_FOREST_SHORE_WIDTH+48);
  assert.equal(offShore.length,0,
    'far trees should not fill the landscape behind the lake shoreline');
  f.distant.dispose();
});

test('different lake sizes and player distances determine the panorama limit',()=>{
  const f=fixture();
  const small={rx:50,rz:45,x:150,z:0};
  const large={rx:145,rz:130,x:150,z:0};
  f.ctx.terrain.visibilityTarget=1;
  assert.ok(distantForestRange(f.ctx.terrain,[small],0,0)
    <distantForestRange(f.ctx.terrain,[large],0,0));
  assert.ok(distantForestRange(f.ctx.terrain,[large],-100,0)
    >=distantForestRange(f.ctx.terrain,[large],100,0));
  assert.equal(distantForestRange(f.ctx.terrain,[],0,0),DISTANT_FOREST_BASE_METERS);
  f.distant.dispose();
});

test('distant models agree on tree IDs, positions and height with the detailed forest',()=>{
  const f=fixture();
  f.distant.update();f.complete();
  const sample=allTransforms(f).find(m=>m.position.x>120&&m.position.z>20);
  assert.ok(sample);
  assert.ok(Math.abs(sample.position.y-.01*sample.position.x-.002*sample.position.z)<1e-7);
  const cx=Math.floor(sample.position.x/24),cz=Math.floor(sample.position.z/24);
  const candidates=new Set();
  for(let i=0;i<TREES_PER_CHUNK;i++){
    const random=(a,b,n)=>rand(f.ctx.seed,a,b,n);
    if(!treeCanSpawn(cx,cz,i,random,24))continue;
    const point=treeCandidate(cx,cz,i,random,24);
    if(point)candidates.add(point.x+','+point.z);
  }
  assert.ok(candidates.has(sample.position.x+','+sample.position.z));
  assert.ok(sample.scale.y>0,'the generated model is scaled with height, not a flat silhouette');
  f.distant.dispose();
});

test('felled trees disappear; moved player unloads old chunks and reset clears instances',()=>{
  const f=fixture();
  f.distant.update();f.complete();
  const count=f.distant.count;
  const tree=allTransforms(f).find(m=>m.position.x>120&&m.position.z>20);
  assert.ok(tree);
  const cx=Math.floor(tree.position.x/24),cz=Math.floor(tree.position.z/24);
  const ids=[];
  for(let i=0;i<TREES_PER_CHUNK;i++){
    const random=(a,b,n)=>rand(f.ctx.seed,a,b,n);
    if(!treeCanSpawn(cx,cz,i,random,24))continue;
    const pt=treeCandidate(cx,cz,i,random,24);
    if(pt&&pt.x===tree.position.x&&pt.z===tree.position.z)ids.push(cx+','+cz+':'+i);
  }
  assert.equal(ids.length,1);
  f.ctx.felled.add(ids[0]);
  f.distant.invalidateTree(ids[0]);
  assert.equal(f.distant.count,count-1);
  f.ctx.px=1800;f.ctx.pz=-2300;
  f.distant.update();f.complete();
  assert.ok(f.distant.count>0);
  assert.ok(allTransforms(f).every(m=>Math.hypot(m.position.x-1800,m.position.z+2300)<210));
  f.distant.clear();
  assert.equal(f.distant.count,0);
  f.distant.dispose();
});
