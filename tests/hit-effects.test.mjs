import test from 'node:test';
import assert from 'node:assert/strict';
import {createHitEffects} from '../src/hit-effects.js';
import {createChopping} from '../src/chopping.js';

test('repeated confirmed hits share one highlight and restore original material and scale', () => {
  let materials = 0;
  class Material {constructor(){materials++;}}
  const original = {name:'trunk-shared-material'};
  const ctx = {THREE:{MeshLambertMaterial:Material}};
  const fx = createHitEffects(ctx);
  const trees = Array.from({length:100},()=>({
    children:[{material:original,scale:{x:1.3,z:1.3}}],
    userData:{},
  }));
  for(const tree of trees) {
    fx.pulse(tree);
    fx.pulse(tree);
  }
  assert.equal(materials,1,'not a new GPU material per hit');
  assert.equal(fx.activeCount,100);
  fx.tick(.075);
  assert.ok(trees[0].children[0].scale.x>1.3);
  fx.tick(.075);
  assert.equal(fx.activeCount,0);
  for(const tree of trees){
    assert.equal(tree.children[0].material,original);
    assert.equal(tree.children[0].scale.x,1.3);
    assert.equal(tree.children[0].scale.z,1.3);
    assert.equal(tree.userData.hitEffect,undefined);
  }
  fx.pulse(trees[0]);
  fx.release(trees[0]);
  fx.release(trees[0]); // safe when a chunk is unloaded after falling
  assert.equal(fx.activeCount,0);
  assert.equal(trees[0].children[0].material,original);
});

test('reduced motion keeps hit feedback static and restores trunk state',()=>{
  const previous=globalThis.matchMedia;
  globalThis.matchMedia=()=>({matches:true});
  try {
    const original={name:'tree-material'};
    const tree={children:[{material:original,scale:{x:1,z:1}}],userData:{}};
    const fx=createHitEffects({THREE:{MeshLambertMaterial:class {}}});
    fx.pulse(tree);
    fx.tick(.075);
    assert.equal(tree.children[0].scale.x,1);
    assert.notEqual(tree.children[0].material,original);
    fx.tick(.075);
    assert.equal(tree.children[0].material,original);
  } finally {if(previous===undefined)delete globalThis.matchMedia;else globalThis.matchMedia=previous;}
});

test('wood chips cap at 96 active particles across repeated hits',()=>{
  const shared={color: 1};
  class Mesh {
    constructor(geometry, material) {
      this.geometry=geometry;this.material=material;
      this.position={set(x,y,z){Object.assign(this,{x,y,z})}};
      this.scale={x:1,z:1};
    }
  }
  const ctx={
    THREE:{
      MeshLambertMaterial:class{constructor(){}},
      BoxGeometry:class{},
      Raycaster:class{constructor(){this.far=0;}},
      Mesh,
    },
    scene:{add(){}},
    particles:[],
  };
  const chops=createChopping(ctx);
  const tree={children:[new Mesh(null,shared)],userData:{},
    position:{x:3,z:4}};
  for(let i=0;i<100;i++)chops.spawnChips(tree);
  assert.equal(ctx.particles.length,96);
  assert.equal(chops.tickHitEffects instanceof Function,true);
});
