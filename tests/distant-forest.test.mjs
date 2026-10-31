import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDistantForest,distantForestRange,
  DISTANT_FOREST_BASE_METERS,DISTANT_FOREST_LAKE_METERS,
} from '../src/distant-forest.js';
import {treeCanSpawn,treeCandidate} from '../src/tree-spacing.js';

function fixture(){
  const objects=new Set(),disposed={geometry:0,material:0,mesh:0};
  class BufferGeometry {
    setAttribute(){return this;}
    computeBoundingSphere(){}
    dispose(){disposed.geometry++;}
  }
  class Material {
    dispose(){disposed.material++;}
  }
  class Object3D {
    constructor(){
      this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});}};
      this.rotation={set(){}};
      this.scale={x:1,y:1,z:1,set(x,y,z){Object.assign(this,{x,y,z});}};
    }
    updateMatrix(){
      this.matrix={position:{x:this.position.x,y:this.position.y,z:this.position.z},
        scale:{x:this.scale.x,y:this.scale.y,z:this.scale.z}};
    }
  }
  class InstancedMesh {
    constructor(geometry,material,capacity){
      this.geometry=geometry;this.material=material;
      this.capacity=capacity;this.count=0;this.matrices=new Map();
      this.instanceMatrix={needsUpdate:false};
    }
    setMatrixAt(i,m){this.matrices.set(i,{position:{...m.position},scale:{...m.scale}});}
    dispose(){disposed.mesh++;}
  }
  const THREE={BufferGeometry,Float32BufferAttribute:class {
    constructor(values,size){this.array=values;this.itemSize=size;}
  },MeshLambertMaterial:Material,InstancedMesh,Object3D,DoubleSide:2};
  const ctx={
    THREE,scene:{add:o=>objects.add(o),remove:o=>objects.delete(o)},
    px:0,pz:0,chunkSize:24,radius:3,seed:67890,
    chunks:new Map(),trees:new Map(),felled:new Set(),
    terrain:{
      visibilityTarget:0,visibility:0,
      waterDepthAt(){return 0;},
      heightAt(x,z){return .01*x+.002*z;},
    },
  };
  const distant=createDistantForest(ctx);
  const complete=()=>{
    for(let i=0;i<80&&distant.pending>0;i++)distant.update();
    assert.equal(distant.pending,0,'the distant forest must stream to completion');
  };
  return {ctx,distant,complete,objects,disposed};
}
function allTransforms(f){
  return [...f.distant.meshes.conifer.matrices.entries()]
    .filter(([i])=>i<f.distant.meshes.conifer.count)
    .map(([,value])=>value)
    .concat([...f.distant.meshes.birch.matrices.entries()]
      .filter(([i])=>i<f.distant.meshes.birch.count)
      .map(([,value])=>value));
}
function rand(seed,x,z,n=0){
  const v=Math.sin(x*127.1+z*311.7+n*78.233+seed)*43758.5453;
  return v-Math.floor(v);
}

test('distant forest uses two bounded instanced meshes and streams into visible radius',()=>{
  const f=fixture();
  f.distant.update();f.complete();
  assert.equal(f.objects.size,2);
  assert.ok(f.distant.count>400);
  assert.ok(f.distant.count<5000);
  assert.ok(f.distant.chunkCount>0);
  const data=allTransforms(f);
  assert.equal(data.length,f.distant.count);
  const far=data.some(v=>Math.hypot(v.position.x,v.position.z)>120);
  assert.ok(far,'the horizon has trees even beyond the detailed 7x7 forest');
  for(const m of Object.values(f.distant.meshes)){
    assert.ok(m.count<=m.capacity);
    assert.equal(m.frustumCulled,false);
    assert.equal(m.castShadow,false);
  }
  f.distant.dispose();
  assert.equal(f.objects.size,0);
  assert.deepEqual(f.disposed,{geometry:2,material:1,mesh:2});
});

test('lake panorama grows forest visibility to the opposite shore',()=>{
  const f=fixture();
  assert.equal(distantForestRange(f.ctx.terrain),DISTANT_FOREST_BASE_METERS);
  f.distant.update();f.complete();
  const before=f.distant.count;
  f.ctx.terrain.visibilityTarget=1;
  assert.equal(distantForestRange(f.ctx.terrain),DISTANT_FOREST_LAKE_METERS);
  f.distant.update();f.complete();
  assert.ok(f.distant.count>before*3,
    'the lake panorama needs trees beyond both shores');
  const data=allTransforms(f);
  assert.ok(data.some(v=>v.position.x>340),
    'far-bank trees already exist when the player looks across the lake');
  assert.ok(data.every(v=>Math.hypot(v.position.x,v.position.z)<485),
    'instances are bounded to camera visibility plus chunk margins');
  f.distant.dispose();
});

test('same seeded candidates, ground height and species as detailed forest',()=>{
  const f=fixture();
  f.distant.update();f.complete();
  const transform=allTransforms(f).find(m=>m.position.x>120&&m.position.z>20);
  assert.ok(transform);
  assert.ok(Math.abs(transform.position.y-.01*transform.position.x-
    .002*transform.position.z)<1e-7);
  const cx=Math.floor(transform.position.x/24),cz=Math.floor(transform.position.z/24);
  const candidate=new Set();
  for(let i=0;i<8;i++){
    if(!treeCanSpawn(cx,cz,i,(a,b,n)=>rand(f.ctx.seed,a,b,n),24))continue;
    const point=treeCandidate(cx,cz,i,(a,b,n)=>rand(f.ctx.seed,a,b,n),24);
    if(point)candidate.add(point.x+','+point.z);
  }
  assert.ok(candidate.has(transform.position.x+','+transform.position.z),
    'distant silhouettes occupy the exact tree IDs and coordinates');
  f.distant.dispose();
});

test('moving player evicts distant chunks and felled trees disappear without clear flicker',()=>{
  const f=fixture();
  f.distant.update();f.complete();
  const count=f.distant.count;
  const tree=allTransforms(f).find(m=>m.position.x>120&&m.position.z>20);
  const cx=Math.floor(tree.position.x/24),cz=Math.floor(tree.position.z/24);
  const ids=[];
  for(let i=0;i<8;i++){
    if(!treeCanSpawn(cx,cz,i,(a,b,n)=>rand(f.ctx.seed,a,b,n),24))continue;
    const pt=treeCandidate(cx,cz,i,(a,b,n)=>rand(f.ctx.seed,a,b,n),24);
    if(pt&&pt.x===tree.position.x&&pt.z===tree.position.z)ids.push(cx+','+cz+':'+i);
  }
  assert.equal(ids.length,1);
  f.ctx.felled.add(ids[0]);
  f.distant.invalidateTree(ids[0]);
  assert.equal(f.distant.count,count-1);
  f.ctx.px=1800;f.ctx.pz=-2300;
  f.distant.update();f.complete();
  assert.ok(f.distant.count>0);
  assert.ok(allTransforms(f).every(m=>Math.hypot(m.position.x-1800,m.position.z+2300)<225));
  f.distant.clear();
  assert.equal(f.distant.count,0);
  f.distant.dispose();
});
