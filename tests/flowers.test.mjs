import test from 'node:test';
import assert from 'node:assert/strict';
import {createFlowers,FLOWER_SPECIES} from '../src/flowers.js';

function threeMock(){
  const created={geometries:[],materials:[]};
  class BufferGeometry{
    constructor(){this.attributes={};created.geometries.push(this)}
    setAttribute(name,attr){this.attributes[name]=attr}
    computeVertexNormals(){this.normalsComputed=true}
  }
  class Float32BufferAttribute{
    constructor(array,size){this.array=array;this.itemSize=size}
  }
  class Material{
    constructor(options){this.options=options;created.materials.push(this)}
  }
  class Mesh{
    constructor(geometry,material){
      this.geometry=geometry;this.material=material;
      this.userData={};
    }
  }
  const THREE={BufferGeometry,Float32BufferAttribute,
    MeshLambertMaterial:Material,Mesh,DoubleSide:2};
  return {THREE,created};
}

test('all flowers have seven petals, real green stalk/leaves and a contrasting gold centre in one draw call',()=>{
  const {THREE,created}=threeMock(),factory=createFlowers(THREE);
  assert.deepEqual(FLOWER_SPECIES,['daisy','buttercup','pink_wildflower','blue_wildflower']);
  assert.equal(factory.geometries.length,4,'one prebuilt vertex-colored geometry per flower color');
  assert.equal(factory.materials.length,1,'one shared material for all four species');
  assert.equal(created.geometries.length,4);
  assert.equal(created.materials.length,1);
  assert.equal(factory.materials[0].options.vertexColors,true);
  const uniqueColors=new Set();
  for(let i=0;i<4;i++){
    const flower=factory.create(i);
    assert.equal(flower.userData.flowerSpecies,FLOWER_SPECIES[i]);
    assert.equal(flower.geometry,factory.geometries[i]);
    assert.equal(flower.material,factory.materials[0]);
    assert.equal(flower.children,undefined,'a flower is one mesh, not 3-4 separate draw calls');
    const geometry=flower.geometry;
    assert.equal(geometry.normalsComputed,true);
    const coords=geometry.attributes.position.array;
    const colors=geometry.attributes.color.array;
    assert.equal(coords.length,colors.length);
    assert.equal(coords.length,86*3*3,'stem, leaves, seven petals and raised centre');
    assert.ok(coords.every(Number.isFinite));
    assert.ok(colors.every(v=>Number.isFinite(v) && v>=0 && v<=1));
    const colorsByTri=new Set();
    for(let j=0;j<colors.length;j+=9){
      colorsByTri.add(colors.slice(j,j+3).map(v=>v.toFixed(4)).join(','));
    }
    assert.ok(colorsByTri.size>=4,'stem, leaves, petals and flower disc have distinct tints');
    uniqueColors.add(colorsByTri.size+':'+colors.slice(20*9+10,20*9+13).join(','));
  }
  assert.equal(uniqueColors.size,4,'the four color schemes differ');
  for(let i=0;i<350;i++)factory.create(i%4);
  assert.equal(created.geometries.length,4,'chunk streaming does not allocate flower geometries');
  assert.equal(created.materials.length,1,'chunk streaming does not allocate flower materials');
});

test('flower is rooted at terrain level, not a floating diamond; bloom spreads radially',()=>{
  const {THREE}=threeMock(),factory=createFlowers(THREE);
  const geometry=factory.geometries[0];
  const pts=geometry.attributes.position.array;
  const xs=[],ys=[],zs=[];
  for(let i=0;i<pts.length;i+=3){xs.push(pts[i]);ys.push(pts[i+1]);zs.push(pts[i+2])}
  assert.equal(Math.min(...ys),0,'stem starts at ground level');
  assert.ok(Math.max(...ys)>.74,'the centre domes above the petals');
  assert.ok(Math.max(...xs)>.35&&Math.min(...xs)<-.35);
  assert.ok(Math.max(...zs)>.35&&Math.min(...zs)<-.35);
  assert.ok(pts.some(v=>Math.abs(v)>.6));
  assert.equal(factory.create(99).userData.flowerSpecies,'daisy',
    'invalid flower palette indices default safely');
});
