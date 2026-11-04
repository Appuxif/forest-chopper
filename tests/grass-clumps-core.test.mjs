import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GRASS_CONFIG, MAX_CLUMPS, alignClumpYaw,
  generateBladeRoots, generateGrassClumps, createMicroGroupField, grassLodFactor,
  grassWidthMultiplier, keepGrassClump, validateGrassConfig,
} from '../examples/grass-clumps-core.mjs';

test('exactly 1..10 blades per clump, exactly 1..10 triangles per blade', () => {
  for (let bladesPerClump = 1; bladesPerClump <= 10; bladesPerClump++) {
    for (const trianglesPerBlade of [1, 3, 6, 10]) {
      const result = generateGrassClumps({
        bladesPerClump, trianglesPerBlade, fieldSize: 30,
      });
      assert.equal(result.bladeCount, result.clumpCount * bladesPerClump);
      assert.equal(result.triangleCount, result.bladeCount * trianglesPerBlade);
      assert.equal(result.trianglesPerClump, trianglesPerBlade * bladesPerClump);
      assert.ok(result.clumpCount > 0);
    }
  }
});

test('a single height per clump, randomized between clumps', () => {
  const result = generateGrassClumps({ fieldSize: 30, minHeight: .3, maxHeight: .9 });
  const heights = new Set();
  for (const tile of result.tiles.values()) {
    for (const clump of tile.clumps) {
      assert.ok(clump.height >= .3 && clump.height <= .9);
      heights.add(clump.height);
    }
  }
  assert.ok(heights.size > 50);
  const level = generateGrassClumps({ fieldSize: 30, minHeight: .65, maxHeight: .65 });
  for (const tile of level.tiles.values())
    for (const clump of tile.clumps) assert.equal(clump.height, .65);
});

test('deterministic on same seed, different on another seed', () => {
  const a = generateGrassClumps({ fieldSize: 30 });
  const b = generateGrassClumps({ fieldSize: 30 });
  const c = generateGrassClumps({ fieldSize: 30, seed: 8 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.tiles.values().next().value?.clumps, c.tiles.values().next().value?.clumps);
});

test('grass field constrained to 30..100m, map is separately 50..300m', () => {
  for (const fieldSize of [30, 50, 100]) {
    const result = generateGrassClumps({ fieldSize, mapSize: 300 }, 10);
    const half = fieldSize / 2;
    for (const tile of result.tiles.values()) {
      for (const c of tile.clumps) {
        assert.ok(c.x >= -half && c.x < half, 'x field boundary');
        assert.ok(c.z >= -half && c.z < half, 'z field boundary');
        assert.equal(tile.tx, Math.floor((c.x + half) / 10));
        assert.equal(tile.tz, Math.floor((c.z + half) / 10));
      }
    }
  }
  assert.equal(validateGrassConfig({ mapSize: 50, fieldSize: 30 }).mapSize, 50);
  assert.equal(validateGrassConfig({ mapSize: 300, fieldSize: 100 }).mapSize, 300);
});

test('clump min gap respected, random steps yield variable separation', () => {
  const config = { ...DEFAULT_GRASS_CONFIG, fieldSize: 30,
    clumpGapMin: .34, clumpGapMax: .71, bladeDensity: 50,
    microGroupStrength: 0 };
  const result = generateGrassClumps(config);
  const clumps = [...result.tiles.values()].flatMap(t => t.clumps);
  // Quadratic check is intentionally limited to a small 30m fixture.
  for (let i = 0; i < clumps.length; i++) {
    for (let j = i + 1; j < clumps.length; j++) {
      const d = Math.hypot(clumps[i].x - clumps[j].x, clumps[i].z - clumps[j].z);
      assert.ok(d >= config.clumpGapMin - 1e-7, 'min inter-clump gap violated');
    }
  }
  const xs = new Set(clumps.map(c => Math.round(c.x * 1000)));
  assert.ok(xs.size > 100, 'spacing should not be fixed on a square grid');
});

test('microgroups compact clumps into groups while preserving Voronoi generation and population', () => {
  const settings = { fieldSize: 30, mapSize: 50, seed: 19, bladeDensity: 45,
    microGroupRadius: .35, microGroupGapMin: 1.2, microGroupGapMax: 2.2 };
  const compact = generateGrassClumps({ ...settings, microGroupStrength: 1 });
  const original = generateGrassClumps({ ...settings, microGroupStrength: 0 });
  const compactClumps = [...compact.tiles.values()].flatMap(t => t.clumps);
  assert.ok(compact.microGroupCount > 50);
  assert.ok(compact.microGroupCount <= compact.microGroupCenters);
  assert.equal(original.microGroupCount, 0);
  assert.ok(Math.abs(compact.clumpCount - original.clumpCount) / original.clumpCount < .15);
  const field = createMicroGroupField(compact.config);
  let compactDist = 0, originalDist = 0, compared = 0;
  const originalClumps = [...original.tiles.values()].flatMap(t => t.clumps);
  for (const c of compactClumps) {
    assert.ok(c.x >= -15 && c.x < 15 && c.z >= -15 && c.z < 15);
    assert.ok(c.groupId >= 0 && c.groupId < field.count);
    const centre = field.nearest(c.x, c.z);
    compactDist += Math.hypot(c.x - centre.x, c.z - centre.z);
    compared++;
  }
  for (const c of originalClumps) {
    const centre = field.nearest(c.x, c.z);
    originalDist += Math.hypot(c.x - centre.x, c.z - centre.z);
  }
  assert.ok(compactDist / compared < originalDist / originalClumps.length * .75,
    'microgroups must concentrate clumps closer to shared group centres');
});

test('microgroup settings can be disabled or independently tuned', () => {
  const defaults = validateGrassConfig({ microGroupStrength: 0 });
  assert.equal(generateGrassClumps(defaults).microGroupCount, 0);
  assert.throws(() => validateGrassConfig({ microGroupGapMin: 2, microGroupGapMax: 1 }), RangeError);
  assert.throws(() => validateGrassConfig({ microGroupRadius: 0 }), RangeError);
});

test('blade roots obey min gap and each added blade neighbours at most max gap', () => {
  for (const [lo, hi] of [[.005, .03], [.02, .08], [.12, .12]]) {
    const roots = generateBladeRoots({ ...DEFAULT_GRASS_CONFIG,
      bladesPerClump: 10, bladeGapMin: lo, bladeGapMax: hi });
    assert.equal(roots.length, 10);
    for (let i = 0; i < roots.length; i++) {
      let nearest = Infinity;
      for (let j = 0; j < roots.length; j++) {
        if (i === j) continue;
        nearest = Math.min(nearest, Math.hypot(roots[i].x - roots[j].x, roots[i].z - roots[j].z));
      }
      assert.ok(nearest >= lo - 1e-7, 'min blade gap violated');
      assert.ok(nearest <= hi + 1e-7, 'max blade gap violated');
    }
  }
});

test('target density is a cap; low gaps enable target density, sparse gaps limit it', () => {
  const options = { fieldSize: 100, clumpGapMin: .15, clumpGapMax: .25, bladeDensity: 12 };
  const one = generateGrassClumps({ ...options, bladesPerClump: 1 });
  const ten = generateGrassClumps({ ...options, bladesPerClump: 10 });
  assert.ok(one.clumpCount > 8 * ten.clumpCount);
  assert.ok(Math.abs(one.bladeCount / 10000 - 12) < .5);
  assert.ok(Math.abs(ten.bladeCount / 10000 - 12) < 1);
  const sparse = generateGrassClumps({ ...options, clumpGapMin: 1.1, clumpGapMax: 1.4 });
  assert.ok(sparse.bladeCount < one.bladeCount);
});

test('LOD keeps near grass; farther instances are culled with deterministic probability', () => {
  const cfg = validateGrassConfig({ densityStart: 15, lodDistance: 65,
    densityReduction: 80, widthIncrease: 60 });
  assert.equal(grassLodFactor(5, cfg), 0);
  assert.equal(grassLodFactor(15, cfg), 0);
  assert.equal(grassLodFactor(65, cfg), 1);
  assert.equal(keepGrassClump(10, 0, cfg), true);
  assert.equal(keepGrassClump(65, .79, cfg), false);
  assert.equal(keepGrassClump(65, .85, cfg), true);
  assert.equal(keepGrassClump(66, 1, cfg), false);
  assert.equal(grassWidthMultiplier(10, cfg), 1);
  assert.ok(Math.abs(grassWidthMultiplier(65, cfg) - 1.6) < 1e-9);
  assert.ok(grassWidthMultiplier(40, cfg) > 1);
});

test('configuration rejects nonsensical counts, distances and map extents', () => {
  for (const invalid of [
    { bladesPerClump: 0 }, { bladesPerClump: 11 },
    { trianglesPerBlade: 0 }, { trianglesPerBlade: 11 },
    { minHeight: 1.1, maxHeight: .3 },
    { mapSize: 49 }, { mapSize: 301 }, { fieldSize: 20 },
    { fieldSize: 100, mapSize: 50 },
    { clumpGapMin: .8, clumpGapMax: .3 },
    { bladeGapMin: .09, bladeGapMax: .02 },
    { bladeDensity: 0 }, { seed: NaN },
    { densityStart: 9 }, { lodDistance: 101 },
    { widthIncrease: 501 }, { densityReduction: 10 },
  ]) assert.throws(() => validateGrassConfig(invalid), RangeError);
});

test('dense 100m field is bounded by CPU instance budget', () => {
  const result = generateGrassClumps({
    fieldSize: 100, mapSize: 300, bladesPerClump: 1,
    bladeDensity: 50, clumpGapMin: .15, clumpGapMax: .15,
  });
  assert.ok(result.clumpCount <= MAX_CLUMPS + MAX_CLUMPS * .015);
  assert.ok(result.clumpCount >= MAX_CLUMPS * .97);
});

test('ground cover choices validate while preserving the existing default', () => {
  assert.equal(validateGrassConfig({}).groundTextureType, 'forest');
  assert.equal(validateGrassConfig({ groundTextureType: 'forest' }).groundTextureType, 'forest');
  for (const invalid of ['mud', '', null, 42]) {
    assert.throws(() => validateGrassConfig({ groundTextureType: invalid }), RangeError);
  }
});

test('blade spread and wind direction settings are validated', () => {
  for (const angle of [0, 30, 180, 360]) {
    assert.equal(validateGrassConfig({ bladeAngleSpread: angle }).bladeAngleSpread, angle);
  }
  for (const invalid of [
    { bladeAngleSpread: -1 }, { bladeAngleSpread: 361 },
    { windDirection: -1 }, { windDirection: 361 },
    { windAlignment: -.01 }, { windAlignment: 1.01 },
  ]) assert.throws(() => validateGrassConfig(invalid), RangeError);
});

test('wind alignment smoothly turns all puffs to a shared heading', () => {
  const config = { fieldSize: 30, windDirection: 120, windAlignment: 1 };
  const model = generateGrassClumps(config);
  const desiredYaw = 120 * Math.PI / 180;
  for (const tile of model.tiles.values()) {
    for (const tuft of tile.clumps) {
      const difference = Math.atan2(Math.sin(tuft.yaw - desiredYaw),
        Math.cos(tuft.yaw - desiredYaw));
      assert.ok(Math.abs(difference) < 1e-9, 'wind should orient every clump');
    }
  }
  assert.equal(alignClumpYaw(2.7, 90, 0), 2.7);
  const midway = alignClumpYaw(0, 90, .5);
  assert.ok(Math.abs(midway - Math.PI / 4) < 1e-9);
});
