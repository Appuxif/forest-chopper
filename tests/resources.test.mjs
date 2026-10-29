import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world.js';
import {createBuilding} from '../src/building.js';

// Lightweight Three.js doubles; count resources owned by tree scars / previews.
// Shared terrain/tree/log geometry and materials must never be disposed on unload.
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

test('100+ chunk unloads dispose unique scar resources but keep shared objects', () => {
  const {ctx, created, sharedGeometry, sharedMaterial} = fixture();
  const world = createWorld(ctx);
  for (let i = 0; i < 130; i++) {
    ctx.px = 40 + i * 220;
    ctx.pz = 40 + i * 220;
    world.updateChunks();
  }
  const activeScars = [...ctx.trees.values()].map(t => t.userData.scar);
  assert.ok(created.length > 200, 'test must generate many unique resources');
  for (const resource of created) {
    if (resource === sharedGeometry || resource === sharedMaterial) {
      assert.equal(resource.calls, 0, 'shared resource must not be disposed');
    } else if (activeScars.some(s => s.geometry === resource || s.material === resource)) {
      assert.equal(resource.calls, 0, 'live tree resource must not be disposed');
    } else {
      assert.equal(resource.calls, 1, 'unloaded tree scar must be disposed once');
    }
  }
  for (const tree of ctx.trees.values()) {
    world.disposeTree(tree);
    world.disposeTree(tree); // Idempotent on reset, disconnect, etc.
  }
  assert.ok(created.every(r => r === sharedGeometry || r === sharedMaterial || r.calls === 1));
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
