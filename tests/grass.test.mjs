import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrass,GRASS_SHAPES,GRASS_PALETTES} from '../src/grass.js';

function threeMock(){
  const created={geometries:[],materials:[]};
  class BufferGeometry {
    constructor(){this.attributes={};created.geometries.push(this)}
    setAttribute(name,attr){this.attributes[name]=attr}
    computeVertexNormals(){this.normalsComputed=true}
  }
  class Float32BufferAttribute {
    constructor(array,itemSize){this.array=array;this.itemSize=itemSize}
  }
  class MeshLambertMaterial {
    constructor(options){this.options=options;created.materials.push(this)}
  }
  class Mesh {
    constructor(geometry,material){
      this.geometry=geometry;
      this.material=material;
      this.userData={};
    }
  }
  return {THREE:{BufferGeometry,Float32BufferAttribute,MeshLambertMaterial,Mesh,DoubleSide:2},created};
}

test('four recognizable tuft silhouettes use 12 prebuilt shared resources and a single mesh each',()=>{
  const {THREE,created}=threeMock();
  const grass=createGrass(THREE);
  assert.deepEqual(GRASS_SHAPES,['meadow','lush','sedge','fan']);
  assert.deepEqual(GRASS_PALETTES,['forest','fresh','dry']);
  assert.equal(grass.geometries.length,12);
  assert.equal(grass.materials.length,1);
  assert.equal(created.geometries.length,12);
  assert.equal(created.materials.length,1);
  assert.equal(grass.materials[0].options.vertexColors,true);
  assert.equal(grass.materials[0].options.side,THREE.DoubleSide);
  const bladeCounts=[9,12,7,8];
  for(let shape=0;shape<4;shape++){
    for(let palette=0;palette<3;palette++){
      const tuft=grass.create(shape,palette);
      assert.equal(tuft.geometry,grass.geometries[shape*3+palette]);
      assert.equal(tuft.material,grass.materials[0]);
      assert.equal(tuft.children,undefined,'each grass clump is one mesh/draw call');
      assert.equal(tuft.userData.grassShape,GRASS_SHAPES[shape]);
      assert.equal(tuft.userData.grassPalette,GRASS_PALETTES[palette]);
      const geometry=tuft.geometry;
      assert.equal(geometry.normalsComputed,true);
      const coords=geometry.attributes.position.array;
      const colors=geometry.attributes.color.array;
      assert.equal(coords.length,bladeCounts[shape]*5*2*3*3,
        'each tapered blade has 5 segments and 2 triangles per segment');
      assert.equal(colors.length,coords.length);
      assert.ok(coords.every(Number.isFinite),'blade geometry stays finite');
      assert.ok(colors.every(c=>Number.isFinite(c)&&c>=0&&c<=1));
      const y=coords.filter((_,i)=>i%3===1);
      assert.equal(Math.min(...y),0,'each tuft roots at terrain height');
      assert.ok(Math.max(...y)>.4&&Math.max(...y)<1.8,'readable grass height');
      const x=coords.filter((_,i)=>i%3===0);
      const z=coords.filter((_,i)=>i%3===2);
      assert.ok(Math.max(...x)-Math.min(...x)>.25,'clump is broad, not a floating triangle');
      assert.ok(Math.max(...z)-Math.min(...z)>.25,'clump spreads in multiple directions');
      const distinctY=new Set(y.map(v=>v.toFixed(3)));
      assert.ok(distinctY.size>=6,'individual blades have actual curved segments');
    }
  }
  for(let i=0;i<400;i++)grass.create(i%4,i%3);
  assert.equal(created.geometries.length,12,
    'streaming/growing chunks must never allocate more grass geometries');
  assert.equal(created.materials.length,1,
    'streaming/growing chunks must never allocate more grass materials');
});

test('regional palettes have distinct colors while geometry stays deterministic for every seed',()=>{
  const {THREE}=threeMock();
  const first=createGrass(THREE);
  const second=createGrass(THREE);
  for(let i=0;i<first.geometries.length;i++){
    assert.deepEqual(first.geometries[i].attributes.position.array,
      second.geometries[i].attributes.position.array);
    assert.deepEqual(first.geometries[i].attributes.color.array,
      second.geometries[i].attributes.color.array);
  }
  const sampleColors=[0,1,2].map(palette=>
    first.geometries[palette].attributes.color.array.slice(0,18));
  assert.notDeepEqual(sampleColors[0],sampleColors[1]);
  assert.notDeepEqual(sampleColors[1],sampleColors[2]);
  assert.equal(first.create(99,99).userData.grassShape,'meadow');
  assert.equal(first.create(99,99).userData.grassPalette,'forest');
});
