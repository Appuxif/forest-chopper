import test from 'node:test';
import assert from 'node:assert/strict';
import {createHitEffects} from '../src/hit-effects.js';
import {createChopping} from '../src/chopping.js';

function treeFixture() {
  const trunkMaterial = {name: 'shared-trunk-material'};
  const trunk = {material: trunkMaterial, scale: {x: 1.3, z: 1.3}};
  const color = {
    hex: 0xe0ad70,
    getHex() {return this.hex;},
    setHex(hex) {this.hex = hex;},
  };
  const scar = {material: {color}, visible: false, scale: {x: 1, y: 1}};
  return {tree: {children: [trunk, scar], userData: {scar}}, trunk, trunkMaterial, scar};
}

test('confirmed hits highlight only the scar, leaving the entire trunk unchanged', () => {
  let materials = 0;
  const ctx = {THREE: {MeshLambertMaterial: class {constructor() {materials++;}}}};
  const fx = createHitEffects(ctx);
  const fixtures = Array.from({length:100},treeFixture);
  for (const {tree, trunk, trunkMaterial, scar} of fixtures) {
    fx.pulse(tree);
    fx.pulse(tree);
    assert.equal(trunk.material, trunkMaterial);
    assert.equal(trunk.scale.x, 1.3);
    assert.equal(scar.visible, true);
    assert.equal(scar.material.color.getHex(), 0xffd49a);
  }
  assert.equal(materials, 0, 'no material allocations per hit');
  assert.equal(fx.activeCount, 100);
  fx.tick(.075);
  assert.ok(fixtures[0].scar.scale.x > 1);
  assert.equal(fixtures[0].trunk.scale.x, 1.3);
  fx.tick(.075);
  assert.equal(fx.activeCount, 0);
  for (const {tree, trunk, trunkMaterial, scar} of fixtures) {
    assert.equal(trunk.material, trunkMaterial);
    assert.equal(trunk.scale.x, 1.3);
    assert.equal(scar.material.color.getHex(), 0xe0ad70);
    assert.equal(scar.scale.x, 1);
    assert.equal(tree.userData.hitEffect, undefined);
  }
  fx.pulse(fixtures[0].tree);
  fx.release(fixtures[0].tree);
  fx.release(fixtures[0].tree);
  assert.equal(fx.activeCount, 0);
  assert.equal(fixtures[0].scar.material.color.getHex(), 0xe0ad70);
});

test('reduced motion keeps the scar size static, restores color and ignores missing scar', () => {
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({matches: true});
  try {
    const {tree, trunk, scar} = treeFixture();
    const fx = createHitEffects({});
    fx.pulse(tree);
    fx.tick(.075);
    assert.equal(scar.scale.x, 1);
    assert.equal(trunk.scale.x, 1.3);
    assert.equal(scar.material.color.getHex(), 0xffd49a);
    fx.tick(.075);
    assert.equal(scar.material.color.getHex(), 0xe0ad70);
    fx.pulse({children: [trunk], userData: {}});
    assert.equal(fx.activeCount, 0);
  } finally {
    if (previous === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = previous;
  }
});

test('wood chips cap at 96 active particles across repeated hits', () => {
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry; this.material = material;
      this.position = {set(x,y,z){Object.assign(this,{x,y,z});}};
    }
  }
  const ctx = {
    THREE: {
      MeshLambertMaterial: class {},
      BoxGeometry: class {},
      Raycaster: class {constructor(){this.far=0;}},
      Mesh,
    },
    scene: {add(){}},
    particles: [],
  };
  const chops = createChopping(ctx);
  const {tree} = treeFixture();
  tree.position = {x:3,z:4};
  for (let i=0;i<100;i++) chops.spawnChips(tree);
  assert.equal(ctx.particles.length,96);
  assert.equal(typeof chops.tickHitEffects,'function');
});
