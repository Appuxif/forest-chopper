import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world.js';
import {createBuilding} from '../src/building.js';

// Lightweight Three.js doubles; check that tree geometry/materials are shared.
// Only the temporary building preview should allocate a unique material.
function fixture() {
  const created = [], disposed = [];
  class Resource {
    constructor() { created.push(this); this.calls = 0; }
    dispose() { this.calls++; disposed.push(this); }
  }
  class Geometry extends Resource {}
  class Material extends Resource {
    constructor(opts = {}) { super(); Object.assign(this, opts); this.color = {setHex() {}}; }
  }
  class Obj {
    constructor() {
      this.position = {x: 0, y: 0, z: 0, set(x, y, z) {
        this.x = x; this.y = y; this.z = z;
      }};
      this.rotation = {x: 0, y: 0, z: 0, set(x, y, z) {
        this.x = x; this.y = y; this.z = z;
      }};
      this.scale = {x: 1, y: 1, z: 1, set(x, y, z) {
        this.x = x; this.y = y; this.z = z;
      }, setScalar(n) {this.x = this.y = this.z = n;}};
      this.children = [];
      this.userData = {};
    }
    add(obj) {this.children.push(obj);}
  }
  class Mesh extends Obj {
    constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
  }
  const THREE = {
    Group: Obj, Mesh, MeshLambertMaterial: Material, PlaneGeometry: Geometry,
    DoubleSide: 2,
  };
  const scene = {members: new Set(), add(obj) {this.members.add(obj);},
    remove(obj) {this.members.delete(obj);}};
  const sharedGeometry = new Geometry(), sharedMaterial = new Material();
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, {
      style: {}, classList: {toggle() {}}, textContent: '',
    });
    return elements.get(id);
  };
  const ctx = {
    THREE, scene, $, trunkGeo: sharedGeometry, leafGeo: sharedGeometry,
    grassGeo: sharedGeometry, rockGeo: sharedGeometry,
    trunkMats: [sharedMaterial, sharedMaterial, sharedMaterial],
    leafMats: [sharedMaterial, sharedMaterial, sharedMaterial, sharedMaterial],
    grassMat: sharedMaterial, rockMat: sharedMaterial, logGeo: sharedGeometry,
    logMat: sharedMaterial, endMat: sharedMaterial,
    trees: new Map(), chunks: new Map(), felled: new Set(),
    treeDamage: new Map(), seed: 321, chunkSize: 24, radius: 0,
    px: 0, pz: 0, yaw: 0, orientation: 0, placed: [],
    wood: 5, logRadius: .29, buildMode: false, preview: null,
    placement: null, isOnline: () => false,
  };
  return {ctx, created, disposed, sharedGeometry, sharedMaterial};
}

test('130 chunk cycles keep shared resources and never create growing rectangular scars', () => {
  const {ctx, created, sharedGeometry, sharedMaterial} = fixture();
  const world = createWorld(ctx);
  for (let i = 0; i < 130; i++) {
    ctx.px = 40 + i * 220;
    ctx.pz = 40 + i * 220;
    world.updateChunks();
    for (const tree of ctx.trees.values()) {
      assert.equal(tree.children.length, 5, 'one trunk and four foliage meshes only');
      assert.equal(tree.userData.scar, undefined);
    }
  }
  assert.ok(ctx.trees.size > 0, 'test actually builds trees');
  assert.deepEqual(created, [sharedGeometry, sharedMaterial], 'no individual tree geometry/material');
  assert.equal(sharedGeometry.calls, 0);
  assert.equal(sharedMaterial.calls, 0);
});

test('restoring a damaged tree preserves HP without recreating the rectangular overlay', () => {
  const {ctx, created, sharedGeometry, sharedMaterial} = fixture();
  const world = createWorld(ctx);
  ctx.treeDamage.set('0,0:0', 3);
  world.makeTree(12, 12, '0,0:0');
  const tree = ctx.trees.get('0,0:0');
  assert.equal(tree.userData.hp, 3);
  assert.equal(tree.children.length, 5);
  assert.equal(tree.userData.scar, undefined);
  assert.deepEqual(created, [sharedGeometry, sharedMaterial]);
});

test('preview cycles dispose only owned preview material, never shared log geometry', () => {
  const {ctx, created, sharedGeometry, sharedMaterial} = fixture();
  const building = createBuilding(ctx);
  for (let i = 0; i < 140; i++) {
    building.setMode(true);
    building.updatePreview();
    const preview = ctx.preview;
    assert.ok(preview);
    assert.equal(preview.geometry, sharedGeometry);
    building.updatePreview();
    assert.equal(ctx.preview, preview, 'updates reuse the current preview');
    building.setMode(false);
    assert.equal(ctx.preview, null);
    assert.equal(preview.material.calls, 1);
  }
  building.disposePreview();
  assert.equal(sharedGeometry.calls, 0);
  assert.equal(sharedMaterial.calls, 0);
  assert.equal(created.filter(r => r !== sharedGeometry && r !== sharedMaterial).length, 140);
});

test('three visual tree silhouettes are deterministic without altering gameplay identifiers or allocating materials', () => {
  const {ctx, created, sharedGeometry, sharedMaterial} = fixture();
  const world = createWorld(ctx);
  const variants = new Set();
  for (let i = 0; i < 90; i++) {
    const x = 5 + i * 2.5, z = 10 + i * 1.3, id = `3,7:${i}`;
    const expectedHp = 7 + Math.floor(world.rand(x,z,8)*5);
    const expectedHeight = 7.5 + world.rand(x,z,4)*6.5;
    const expectedScale = .9 + world.rand(x,z,5)*.65;
    world.makeTree(x,z,id);
    const tree = ctx.trees.get(id);
    variants.add(tree.userData.variant);
    assert.equal(tree.userData.maxHp, expectedHp);
    assert.equal(tree.userData.h, expectedHeight);
    assert.equal(tree.userData.scale, expectedScale);
    assert.equal(tree.userData.id, id);
    assert.equal(tree.position.x, x);
    assert.equal(tree.position.z, z);
    assert.equal(tree.children.length, 5);
    assert.ok(tree.children.every(child => child.geometry === sharedGeometry && child.material === sharedMaterial));
    const snapshot = tree.children.slice(1).map(child => [child.scale.x, child.scale.y, child.position.y]);
    ctx.scene.remove(tree);ctx.trees.delete(id);
    world.makeTree(x,z,id);
    const rebuilt = ctx.trees.get(id);
    assert.equal(rebuilt.userData.variant,tree.userData.variant);
    assert.deepEqual(rebuilt.children.slice(1).map(child => [child.scale.x, child.scale.y, child.position.y]),snapshot);
    ctx.scene.remove(rebuilt);ctx.trees.delete(id);
  }
  assert.deepEqual([...variants].sort(),[0,1,2]);
  assert.deepEqual(created,[sharedGeometry,sharedMaterial],'variants reuse existing GPU resources');
});
