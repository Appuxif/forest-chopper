import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuilding} from '../src/building.js';

function setup(online = false) {
  const sent = [], added = [], removed = [], notifications = [], elements = new Map();
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.position = {set(x, y, z) {Object.assign(this, {x, y, z});}};
      this.rotation = {x: 0, y: 0, z: 0, set(x, y, z) {Object.assign(this, {x, y, z});}};
    }
  }
  class Material {
    constructor() {this.color = {setHex(n) {this.hex = n;}}; this.disposed = false;}
    dispose() {this.disposed = true;}
  }
  const $ = id => {
    if (!elements.has(id)) elements.set(id, {textContent: '', style: {}, classList: {toggle() {}}});
    return elements.get(id);
  };
  const ctx = {
    THREE: {Mesh, MeshLambertMaterial: Material},
    logGeo: {}, logMat: {}, endMat: {},
    scene: {add: mesh => added.push(mesh), remove: mesh => removed.push(mesh)},
    $, px: 0, pz: 0, yaw: 0, orientation: 0, wood: 0, logRadius: .29,
    buildMode: false, preview: null, placement: null, placed: [],
    isOnline: () => online,
    sendNet: data => sent.push(data),
    notify: (...args) => notifications.push(args),
    offlineSave: {markDirty() {}},

  };
  return {ctx, sent, added, removed, notifications, $,
    building: createBuilding(ctx)};
}

for (const online of [false, true]) {
  test(`${online ? 'online' : 'offline'}: no placement outside build mode, even with stale preview`, () => {
    const {ctx, sent, building, $} = setup(online);
    ctx.wood = 10;
    ctx.placement = {x: 0, z: -3.5, level: 0, orientation: 0};
    assert.equal(building.placeLog(), false);
    assert.equal(building.removeLog(), false);
    assert.equal(sent.length, 0);
    assert.equal(ctx.placed.length, 0);
    assert.match($('buildhint').textContent, /включите строительство/);
  });

  test(`${online ? 'online' : 'offline'}: depleted wood and height 16 both reject placement`, () => {
    const {ctx, sent, building, $} = setup(online);
    building.setMode(true);
    assert.equal(building.placeLog(), false);
    building.updatePreview();
    assert.equal(ctx.preview.material.color.hex, 0xff6666);
    assert.match($('buildhint').textContent, /Недостаточно древесины/);

    ctx.wood = 10;
    ctx.placed = Array.from({length: 16}, (_, level) =>
      ({x: 0, z: -3.5, orientation: 0, level, mesh: {}}));
    building.updatePreview();
    assert.equal(ctx.placement.level, 16);
    assert.equal(ctx.preview.material.color.hex, 0xff6666);
    assert.equal(building.placeLog(), false);
    assert.match($('buildhint').textContent, /16 уровней/);
    assert.equal(sent.length, 0);
    assert.equal(ctx.placed.length, 16);
    assert.equal(ctx.wood, 10);
  });

  test(`${online ? 'online' : 'offline'}: valid placement uses current candidate, not stale preview`, () => {
    const {ctx, sent, building, $, notifications} = setup(online);
    ctx.wood = 3;
    building.setMode(true);
    building.updatePreview();
    ctx.px = 7; // moving before next preview frame must affect placement
    assert.equal(building.placeLog(), true);
    if (online) {
      assert.deepEqual(sent, [{type: 'place', x: 7, z: -3.5, orientation: 0}]);
      assert.equal(ctx.wood, 3, 'online resources change only on server ack');
      assert.equal(ctx.placed.length, 0);
      assert.deepEqual(notifications, [], 'no success toast before server acknowledgement');
    } else {
      assert.equal(ctx.placed.length, 1);
      assert.equal(notifications[0][1], 'success');
      assert.equal(ctx.placed[0].x, 7);
      assert.equal(ctx.wood, 2);
      assert.equal($('wood').textContent, 2);
    }
  });

  test(`${online ? 'online' : 'offline'}: removal requires mode and nearby log`, () => {
    const {ctx, sent, building, $} = setup(online);
    ctx.wood = 2;
    building.setMode(true);
    assert.equal(building.removeLog(), false);
    assert.match($('buildhint').textContent, /Нет брёвен/);
    const near = {id: 9, x: 0, z: -3.5, level: 0, orientation: 0, mesh: {}};
    ctx.placed.push(near);
    assert.equal(building.removeLog(), true);
    if (online) {
      assert.deepEqual(sent, [{type: 'remove', id: 9}]);
      assert.equal(ctx.placed.length, 1);
      assert.equal(ctx.wood, 2);
    } else {
      assert.equal(ctx.placed.length, 0);
      assert.equal(ctx.wood, 3);
    }
    building.setMode(false);
    assert.equal(building.removeLog(), false);
    assert.equal(sent.length, online ? 1 : 0);
  });
}

test('preview turns green when placement becomes valid and is released on exit', () => {
  const {ctx, building} = setup();
  ctx.wood = 1;
  building.setMode(true);
  building.updatePreview();
  assert.equal(ctx.preview.material.color.hex, 0x83efb5);
  const material = ctx.preview.material;
  building.setMode(false);
  assert.equal(ctx.preview, null);
  assert.equal(material.disposed, true);
});
