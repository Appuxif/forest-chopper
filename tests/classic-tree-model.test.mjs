import {flatTerrain} from './helpers/flat-terrain.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world.js';

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
    terrain:flatTerrain(),THREE:{Group,Mesh},
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
