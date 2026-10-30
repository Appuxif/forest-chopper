import test from 'node:test';
import assert from 'node:assert/strict';
import {createTreeVariants,TREE_VARIANT_COUNT} from '../src/tree-variants.js';
import {createWorld} from '../src/world.js';

class Attribute {
  constructor(values,size){this.array=Float32Array.from(values);this.itemSize=size;}
}
class Geometry {
  constructor(){this.attributes={};}
  setAttribute(key,attribute){this.attributes[key]=attribute;}
  getAttribute(key){return this.attributes[key];}
  computeVertexNormals(){}
}
const THREE={
  BufferGeometry:Geometry,
  Float32BufferAttribute:Attribute,
};
const baseTrunk=new Geometry();
baseTrunk.setAttribute('position',new Attribute([0,0,0,1,0,0,0,1,0],3));
baseTrunk.setAttribute('uv',new Attribute([0,0,1,0,0,1],2));

test('ten shared growth templates per species are bounded, deterministic and distinct',()=>{
  const variants=createTreeVariants(THREE,baseTrunk);
  assert.equal(TREE_VARIANT_COUNT,10);
  for(const species of ['birch','conifer']){
    assert.equal(variants[species].length,10);
    const geometries=variants[species].map(x=>x.canopy);
    assert.equal(new Set(geometries).size,10);
    assert.ok(geometries.every(g=>g.getAttribute('position').array.length>100));
    assert.ok(geometries.every(g=>g.getAttribute('position').array.length<120000));
    assert.ok(variants[species].every(x=>x.trunk.getAttribute('uv').array.length>6));
    assert.ok(variants[species].some((x,i)=>i>0&&
      x.canopy.getAttribute('position').array.length!==
      variants[species][0].canopy.getAttribute('position').array.length),
      'random-seeded templates should differ in branch count and crown density');
  }
  const again=createTreeVariants(THREE,baseTrunk);
  for(const species of ['birch','conifer'])for(let i=0;i<10;i++){
    assert.deepEqual(variants[species][i].canopy.getAttribute('position').array,
      again[species][i].canopy.getAttribute('position').array);
  }
});

test('restored original forest uses trunk plus four low-poly crown meshes',()=>{
  class Group {
    constructor(){
      this.children=[];this.userData={};
      this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
      this.rotation={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
      this.scale={x:1,y:1,z:1,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    }
    add(child){this.children.push(child);}
  }
  class Mesh extends Group {
    constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.isMesh=true;}
  }
  const trunkGeo={type:'CylinderGeometry'},leafGeo={type:'ConeGeometry'};
  const birchLeafGeo={type:'IcosahedronGeometry'};
  const ctx={
    THREE:{Group,Mesh},
    seed:3428,treeDamage:new Map(),trees:new Map(),
    trunkGeo,leafGeo,birchLeafGeo,
    birchTrunkMat:{},trunkMats:[{},{},{}],
    birchLeafMats:[{},{},{}],leafMats:[{},{},{},{}],rareLeafMat:{},
    scene:{add(){}},
  };
  const world=createWorld(ctx),seen=new Set();
  for(let i=0;i<80;i++){
    const x=5+i*1.3,z=9+i*1.7,id='test:'+i;
    world.makeTree(x,z,id);
    const tree=ctx.trees.get(id),species=tree.userData.species;
    seen.add(species);
    assert.equal(tree.children.length,5);
    assert.equal(tree.children[0].geometry,trunkGeo);
    for(const crown of tree.children.slice(1))
      assert.equal(crown.geometry,species==='birch'?birchLeafGeo:leafGeo);
    assert.equal(tree.userData.modelVariant,undefined);
    assert.equal(tree.position.x,x);
    assert.equal(tree.position.z,z);
  }
  assert.deepEqual([...seen].sort(),['birch','conifer']);
});
