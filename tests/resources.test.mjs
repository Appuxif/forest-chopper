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
    birchLeafGeo: sharedGeometry, birchTrunkMat: sharedMaterial,
    birchLeafMats: [sharedMaterial,sharedMaterial,sharedMaterial],
    grassGeo: sharedGeometry, rockGeo: sharedGeometry,
    flowerGeo: sharedGeometry,
    mushrooms:{create(index){const group=new THREE.Group();group.userData.mushroomSpecies=['fly_agaric','boletus','death_cap','milkcap'][index];group.add(new THREE.Mesh(sharedGeometry,sharedMaterial));return group;}},
    flowers:{create(index){const mesh=new THREE.Mesh(sharedGeometry,sharedMaterial);mesh.userData.flowerSpecies=['daisy','buttercup','pink_wildflower','blue_wildflower'][index];return mesh;}},
    trunkMats: [sharedMaterial, sharedMaterial, sharedMaterial],
    leafMats: [sharedMaterial, sharedMaterial, sharedMaterial, sharedMaterial],
    grassMat: sharedMaterial, rockMat: sharedMaterial,
    flowerMat: sharedMaterial, mushroomMat: sharedMaterial,
    rareLeafMat: sharedMaterial, logGeo: sharedGeometry,
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

test('deterministic mushrooms and flowers replace existing grass without extra meshes or collisions', () => {
  function snapshot() {
    const {ctx,created,sharedGeometry,sharedMaterial} = fixture();
    const world = createWorld(ctx);
    const counts = {grass:0,rock:0,flower:0,mushroom:0};
    const rows=[];
    for(let i=0;i<14;i++){
      world.build(i,2);
      const decor=ctx.chunks.get(`${i},2`);
      assert.equal(decor.children.length,25,'same budget per chunk');
      const chunk=decor.children.map(mesh=>{
        const type=mesh.userData.decorType;
        if(type==='mushroom'){
          assert.equal(mesh.children.length,1,'mushroom stub reuses shared resource meshes');
          assert.equal(mesh.children[0].geometry,sharedGeometry);
          assert.equal(mesh.children[0].material,sharedMaterial);
          assert.ok(['fly_agaric','boletus','death_cap','milkcap'].includes(mesh.userData.mushroomSpecies));
        }else{
          assert.equal(mesh.geometry,sharedGeometry);
          assert.equal(mesh.material,sharedMaterial);
        }
        counts[type]++;
        if(type==='mushroom'){
          const slot=decor.children.indexOf(mesh);
          const oldScale=.8+world.rand(i,2,slot)*.65;
          assert.equal(mesh.scale.x,oldScale*.5,'every mushroom is exactly 50% of its previous size');
          assert.equal(mesh.position.y,0,'mushroom base must sit on the ground');
        }
        if(type==='flower'){
          assert.equal(mesh.position.y,0,'flower stem must start at ground level');
          const slot=decor.children.indexOf(mesh);
          const oldScale=.8+world.rand(i,2,slot)*.65;
          assert.equal(mesh.scale.x,oldScale*.65,'flowers must be sized like wildflowers');
          assert.ok(['daisy','buttercup','pink_wildflower','blue_wildflower'].includes(mesh.userData.flowerSpecies));
          assert.equal(mesh.geometry,sharedGeometry);
          assert.equal(mesh.material,sharedMaterial);
        }
        return [type,mesh.userData.mushroomSpecies??mesh.userData.flowerSpecies??null,mesh.position.x,mesh.position.y,mesh.position.z,mesh.scale.x];
      });
      rows.push(chunk);
    }
    assert.deepEqual(created,[sharedGeometry,sharedMaterial],'no per-decoration resource allocation');
    return {rows,counts};
  }
  const first=snapshot(),second=snapshot();
  assert.deepEqual(first,second,'seed and chunk coordinates reproduce the same flora');
  assert.equal(Object.values(first.counts).reduce((a,b)=>a+b,0),14*25);
  assert.ok(first.counts.flower>0 && first.counts.mushroom>0);
  const species=new Set(first.rows.flat().filter(row=>row[0]==='mushroom').map(row=>row[1]));
  assert.deepEqual([...species].sort(),['boletus','death_cap','fly_agaric','milkcap'],
    'all four mushroom species must appear without new decoration slots');
  const flowerSpecies=new Set(first.rows.flat().filter(row=>row[0]==='flower').map(row=>row[1]));
  assert.deepEqual([...flowerSpecies].sort(),['blue_wildflower','buttercup','daisy','pink_wildflower'],
    'all four flower colors must appear deterministically');
  assert.ok(first.counts.grass>first.counts.flower,'avoid overwhelming the forest with bright decor');
});

test('rare frosty trees are seed-deterministic and purely cosmetic', () => {
  const {ctx,sharedGeometry} = fixture();
  const rareMaterial={kind:'shared-frost'};
  ctx.rareLeafMat=rareMaterial;
  const world=createWorld(ctx);
  let rareCount=0;
  for(let i=0;i<600;i++){
    const x=13+i*.99,z=7+i*1.27,id=`9,9:${i}`;
    const expectedRare=world.rand(x,z,702)>.985;
    world.makeTree(x,z,id);
    const tree=ctx.trees.get(id);
    assert.equal(tree.userData.rare,expectedRare);
    assert.equal(tree.userData.maxHp,7+Math.floor(world.rand(x,z,8)*5));
    assert.equal(tree.children.length,5);
    assert.ok(tree.children.every(child=>child.geometry===sharedGeometry));
    assert.ok(tree.children.slice(1).every(child => (child.material===rareMaterial)===expectedRare));
    if(expectedRare)rareCount++;
    ctx.scene.remove(tree);ctx.trees.delete(id);
    world.makeTree(x,z,id);
    assert.equal(ctx.trees.get(id).userData.rare,expectedRare);
    ctx.scene.remove(ctx.trees.get(id));ctx.trees.delete(id);
  }
  assert.ok(rareCount>1&&rareCount<40,`expected rare appearance, got ${rareCount}/600`);
});

test('birches have a consistent white-bark trunk and rounded shared canopy without changing tree rules', () => {
  const {ctx, created, sharedGeometry, sharedMaterial} = fixture();
  const birchGeo={kind:'rounded-crown'}, birchBark={kind:'white-bark'};
  const birchLeaves=[{kind:'light-green'},{kind:'green'},{kind:'yellow-green'}];
  ctx.birchLeafGeo=birchGeo;
  ctx.birchTrunkMat=birchBark;
  ctx.birchLeafMats=birchLeaves;
  const world=createWorld(ctx);
  let birches=0, regular=0, firstBirch=null;
  for(let i=0;i<450;i++){
    const x=6+i*.87,z=12+i*1.21,id=`8,5:${i}`;
    const expectedSpecies=world.rand(x,z,703)<.2?'birch':'conifer';
    world.makeTree(x,z,id);
    const tree=ctx.trees.get(id);
    assert.equal(tree.userData.species,expectedSpecies);
    assert.equal(tree.userData.id,id);
    assert.equal(tree.userData.h,7.5+world.rand(x,z,4)*6.5);
    assert.equal(tree.userData.scale,.9+world.rand(x,z,5)*.65);
    assert.equal(tree.userData.maxHp,7+Math.floor(world.rand(x,z,8)*5));
    assert.equal(tree.position.x,x);
    assert.equal(tree.position.z,z);
    assert.equal(tree.children.length,5,'birches must not increase per-tree mesh count');
    const trunk=tree.children[0],leaves=tree.children.slice(1);
    assert.equal(trunk.geometry,sharedGeometry);
    if(expectedSpecies==='birch'){
      birches++;
      firstBirch??={id,x,z};
      assert.equal(trunk.material,birchBark);
      assert.equal(trunk.scale.x,tree.userData.scale*.78);
      assert.ok(leaves.every(f=>f.geometry===birchGeo));
      assert.ok(leaves.every(f=>tree.userData.rare?f.material===sharedMaterial:birchLeaves.includes(f.material)));
      assert.ok(leaves.some(f=>f.position.x!==0),'birch canopy must branch away from the trunk');
    }else{
      regular++;
      assert.equal(trunk.material,sharedMaterial);
      assert.ok(leaves.every(f=>f.geometry===sharedGeometry));
    }
    const silhouette=tree.children.map(m=>[m.geometry,m.material,m.scale.x,m.scale.y,m.position.x,m.position.y,m.position.z]);
    ctx.scene.remove(tree);ctx.trees.delete(id);
    world.makeTree(x,z,id);
    assert.equal(ctx.trees.get(id).userData.species,expectedSpecies);
    assert.deepEqual(ctx.trees.get(id).children.map(m=>[m.geometry,m.material,m.scale.x,m.scale.y,m.position.x,m.position.y,m.position.z]),silhouette);
    ctx.scene.remove(ctx.trees.get(id));ctx.trees.delete(id);
  }
  assert.ok(birches>50 && birches<140,`expected around 20% birches, got ${birches}/450`);
  assert.ok(regular>0);
  assert.deepEqual(created,[sharedGeometry,sharedMaterial], 'no individual tree GPU assets');
  ctx.treeDamage.set(firstBirch.id,2);
  world.makeTree(firstBirch.x,firstBirch.z,firstBirch.id);
  assert.equal(ctx.trees.get(firstBirch.id).userData.hp,2,'damaged birch retains saved HP');
});
