import {FOREST_GRASS_PRESET} from './grass-generator-defaults.js';
// Standalone, deterministic grass layout/LOD. No Three.js dependency.
export const MAX_CLUMPS = 130000;
export const DEFAULT_GRASS_CONFIG = Object.freeze({
  seed: 7,
  mapSize: 150,          // ground plane, 50..300 m
  fieldSize: 70,         // grassy square, 30..100 m
  bladesPerClump: 5,
  trianglesPerBlade: 6,
  bladeDensity: 25,      // target individual blades/m²; spacing can limit it
  clumpGapMin: 0.25,     // metres between adjacent clump centres
  clumpGapMax: 0.55,
  bladeGapMin: 0.010,    // metres between blade roots inside a clump
  bladeGapMax: 0.055,
  minHeight: 0.25,
  maxHeight: 0.60,
  spread: 0.24,
  bladeWidth: 0.020,
  bladeAngleSpread: 360, // 0 = parallel, 360 = radial as before
  windDirection: 0,    // global azimuth in degrees
  windAlignment: 0,    // 0 = random/Voronoi orientation, 1 = global direction
  leanAngle: 26,      // degrees from vertical; softened close to the root
  bendAmount: 0.52,   // curved arc / drooping tip
  waveAmount: 0.14,   // fine lateral waviness, like flexible hair
  rootUpright: 0.82,  // preserves a smooth upright root tangent
  proceduralNormals: true,
  translucency: true,
  ambientOcclusion: true,
  translucencyIntensity: 0.5,
  aoIntensity: 0.45,
  wind: 0.30,
  lodDistance: 65,      // hide clumps after this distance in metres
  densityStart: 20,     // full density up to this distance
  densityReduction: 70, // percentage culled at lodDistance
  densityCurve: 2,     // late-falling density curve: pow(t, exponent)
  widthIncrease: 60,   // percentage extra blade width at lodDistance
  voronoiCells: 90,    // distributed Voronoi patch centres
  voronoiStrength: 0.8, // patch cohesion: density, height, direction and tint
  voronoiEdgeSoftness: 1.5, // soft transition near cell boundaries
  microGroupStrength: 0.85, // 0 = original placement, 1 = compact groups
  microGroupGapMin: 0.8,    // approximate spacing of microgroup centres, m
  microGroupGapMax: 1.6,
  microGroupRadius: 0.48,   // spread of clump roots within each microgroup, m
  groundTextureEnabled: true, // painted micrograss on the ground plane
  groundTextureType: 'micrograss', // micrograss | forest
  groundTextureScale: 4, // metres per repeated canvas tile
  ...FOREST_GRASS_PRESET, // user-selected defaults shared with the game
});

export function hashGrass(seed, a, b, channel = 0) {
  let h = (seed | 0) ^ Math.imul((a | 0), 0x1b873593) ^
    Math.imul((b | 0), 0x85ebca6b) ^
    Math.imul(channel + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function validateGrassConfig(input = {}) {
  const c = { ...DEFAULT_GRASS_CONFIG, ...input };
  const within = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
  if (!Number.isSafeInteger(c.seed)) throw new RangeError('seed must be an integer');
  for (const [key, min, max] of [
    ['mapSize', 50, 300], ['fieldSize', 30, 100], ['bladeDensity', 1, 200],
    ['clumpGapMin', 0, 1.5], ['clumpGapMax', .15, 1.5],
    ['bladeGapMin', 0, .2], ['bladeGapMax', .005, .2],
    ['minHeight', .05, 2], ['maxHeight', .05, 2],
    ['spread', .03, .65], ['bladeWidth', .004, .06], ['wind', 0, 1],
    ['bladeAngleSpread', 0, 360], ['windDirection', 0, 360], ['windAlignment', 0, 1],
    ['leanAngle', 0, 80], ['bendAmount', 0, 1],
    ['waveAmount', 0, 1], ['rootUpright', 0, 1],
    ['translucencyIntensity', 0, 1.5], ['aoIntensity', 0, 1],
    ['lodDistance', 30, 100], ['densityStart', 10, 30],
    ['densityReduction', 30, 100], ['densityCurve', 0, 2], ['widthIncrease', 30, 500],
    ['voronoiCells', 10, 300], ['voronoiStrength', 0, 1],
    ['voronoiEdgeSoftness', .2, 4],
    ['microGroupStrength', 0, 1],
    ['microGroupGapMin', .5, 5], ['microGroupGapMax', .5, 5],
    ['microGroupRadius', .1, 1.5],
    ['groundTextureScale', 2, 12],
  ]) {
    if (!within(c[key], min, max)) throw new RangeError(key + ' must be ' + min + '..' + max);
  }
  for (const key of ['proceduralNormals', 'translucency', 'ambientOcclusion', 'groundTextureEnabled']) {
    if (typeof c[key] !== 'boolean') throw new TypeError(key + ' must be boolean');
  }
  if (!['micrograss', 'forest'].includes(c.groundTextureType))
    throw new RangeError('groundTextureType must be micrograss or forest');
  if (c.fieldSize > c.mapSize) throw new RangeError('grass field cannot exceed map');
  if (!Number.isInteger(c.bladesPerClump) || !within(c.bladesPerClump, 1, 10))
    throw new RangeError('bladesPerClump must be 1..10');
  if (!Number.isInteger(c.trianglesPerBlade) || !within(c.trianglesPerBlade, 1, 10))
    throw new RangeError('trianglesPerBlade must be 1..10');
  if (!Number.isInteger(c.voronoiCells)) throw new RangeError('voronoiCells must be an integer');
  if (c.minHeight > c.maxHeight) throw new RangeError('minHeight exceeds maxHeight');
  if (c.clumpGapMin > c.clumpGapMax) throw new RangeError('clump gap min exceeds max');
  if (c.bladeGapMin > c.bladeGapMax) throw new RangeError('blade gap min exceeds max');
  if (c.microGroupGapMin > c.microGroupGapMax) throw new RangeError('microgroup gap min exceeds max');
  return c;
}

const clamp01 = v => Math.max(0, Math.min(1, v));

// Preserve the Voronoi direction when alignment is off, smoothly rotate
// clumps toward one global wind azimuth when it is enabled.
export function alignClumpYaw(yaw, windDirection, alignment) {
  const windYaw = windDirection * Math.PI / 180;
  return yaw + Math.atan2(Math.sin(windYaw - yaw), Math.cos(windYaw - yaw)) * alignment;
}


export function grassLodFactor(distance, config) {
  const c = config;
  return c.densityCurve === 0 ? 0 : Math.pow(clamp01((distance - c.densityStart) /
    Math.max(.001, c.lodDistance - c.densityStart)), c.densityCurve);
}

// CPU LOD: actually remove instances (and triangles), not just hide in the vertex shader.
export function keepGrassClump(distance, random, config) {
  if (distance > config.lodDistance) return false;
  return random >= config.densityReduction / 100 * grassLodFactor(distance, config);
}
export function grassWidthMultiplier(distance, config) {
  return 1 + config.widthIncrease / 100 * grassLodFactor(distance, config);
}

// Nearest-neighbour spacing: every new blade root is placed at a random
// min..max distance from an existing root, rejecting anything closer than min.
// Guaranteed fallback extends the rightmost point when a dense knot is blocked.
export function generateBladeRoots(config) {
  const { seed, bladesPerClump, bladeGapMin: lo, bladeGapMax: hi } = config;
  const roots = [{ x: 0, z: 0 }];
  for (let i = 1; i < bladesPerClump; i++) {
    let chosen = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const anchor = roots[Math.floor(hashGrass(seed, i, attempt, 101) * roots.length)];
      const angle = hashGrass(seed, i, attempt, 102) * Math.PI * 2;
      const gap = lo + hashGrass(seed, i, attempt, 103) * (hi - lo);
      const x = anchor.x + Math.cos(angle) * gap;
      const z = anchor.z + Math.sin(angle) * gap;
      if (roots.every(p => (p.x - x) ** 2 + (p.z - z) ** 2 >= (lo - 1e-9) ** 2)) {
        chosen = { x, z };
        break;
      }
    }
    if (!chosen) {
      const anchor = roots.reduce((a, b) => a.x > b.x ? a : b);
      chosen = { x: anchor.x + hi, z: anchor.z };
    }
    roots.push(chosen);
  }
  // Centre all roots around the clump origin for natural radial spread.
  const cx = roots.reduce((s, r) => s + r.x, 0) / roots.length;
  const cz = roots.reduce((s, r) => s + r.z, 0) / roots.length;
  return roots.map(r => ({ x: r.x - cx, z: r.z - cz }));
}

// The quasi-uniform seeds make a small set of natural patches rather than a
// visible square grid. A spatial hash accelerates nearest/second-nearest search:
// each query stops once unvisited buckets cannot contain a closer seed.
export function generateVoronoiSeeds(config) {
  const seeds = [];
  const { seed, fieldSize, voronoiCells } = config;
  const phaseX = hashGrass(seed, 0, 0, 700);
  const phaseZ = hashGrass(seed, 0, 0, 701);
  for (let i = 0; i < voronoiCells; i++) {
    const u = (phaseX + (i + .5) * .7548776662466927) % 1;
    const v = (phaseZ + (i + .5) * .5698402909980532) % 1;
    seeds.push({
      x: (u - .5) * fieldSize,
      z: (v - .5) * fieldSize,
      height: hashGrass(seed, i, 0, 702),
      yaw: hashGrass(seed, i, 0, 703) * Math.PI * 2,
      density: .75 + hashGrass(seed, i, 0, 704) * .55,
      tint: hashGrass(seed, i, 0, 705),
    });
  }
  return seeds;
}

export function createVoronoiField(config) {
  const seeds = generateVoronoiSeeds(config);
  const side = Math.max(2, Math.ceil(Math.sqrt(seeds.length)));
  const cellSize = config.fieldSize / side;
  const half = config.fieldSize / 2;
  const buckets = Array.from({ length: side * side }, () => []);
  const cellIndex = n => Math.max(0, Math.min(side - 1, Math.floor((n + half) / cellSize)));
  for (const seed of seeds) buckets[cellIndex(seed.z) * side + cellIndex(seed.x)].push(seed);
  const edgeWidth = config.fieldSize / Math.sqrt(seeds.length) *
    .20 * config.voronoiEdgeSoftness;
  return {
    seeds,
    sample(x, z) {
      const bx = cellIndex(x), bz = cellIndex(z);
      let nearest = null, second = null, d1 = Infinity, d2 = Infinity;
      for (let ring = 0; ring < side; ring++) {
        const x0 = Math.max(0, bx - ring), x1 = Math.min(side - 1, bx + ring);
        const z0 = Math.max(0, bz - ring), z1 = Math.min(side - 1, bz + ring);
        for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
          if (Math.max(Math.abs(gx - bx), Math.abs(gz - bz)) !== ring) continue;
          for (const seed of buckets[gz * side + gx]) {
            const dist2 = (x - seed.x) ** 2 + (z - seed.z) ** 2;
            if (dist2 < d1) { d2 = d1; second = nearest; d1 = dist2; nearest = seed; }
            else if (dist2 < d2) { d2 = dist2; second = seed; }
          }
        }
        if (d2 < Infinity) {
          // Lower bound to any point in an as-yet unvisited bucket.
          const margins = [];
          if (x0 > 0) margins.push(x - (x0 * cellSize - half));
          if (x1 < side - 1) margins.push((x1 + 1) * cellSize - half - x);
          if (z0 > 0) margins.push(z - (z0 * cellSize - half));
          if (z1 < side - 1) margins.push((z1 + 1) * cellSize - half - z);
          if (!margins.length || Math.min(...margins) ** 2 >= d2) break;
        }
      }
      if (!nearest) return { seed: null, influence: 0, interior: 0 };
      const delta = Math.max(0, Math.sqrt(d2) - Math.sqrt(d1));
      const t = Math.min(1, delta / Math.max(.001, edgeWidth));
      const interior = t * t * (3 - 2 * t);
      return { seed: nearest, second, interior, influence: interior * config.voronoiStrength };
    },
  };
}

// Second level of clustering, nested under the large-scale Voronoi patches:
// grass blade -> clump -> small group of clumps -> Voronoi region.
// Group locations form a jittered, staggered lattice. Each original clump
// candidate is pulled toward a random disk point around its nearest group.
// This preserves the total candidate count and the CPU LOD instance budget.
export function createMicroGroupField(config) {
  const {
    seed, fieldSize, microGroupGapMin, microGroupGapMax,
    microGroupRadius, microGroupStrength,
  } = config;
  const half = fieldSize / 2;
  const averageStep = (microGroupGapMin + microGroupGapMax) / 2;
  const side = Math.max(1, Math.round(fieldSize / averageStep));
  const cell = fieldSize / side;
  const jitter = Math.min(cell * .37, Math.max(0, (cell - microGroupGapMin) / 2));
  const centres = new Array(side * side);
  for (let iz = 0; iz < side; iz++) {
    for (let ix = 0; ix < side; ix++) {
      const id = iz * side + ix;
      const stagger = (iz % 2) * .28;
      // Staggered rows prevent the square-grid "pathways" of early prototypes.
      const px = (ix + .5 + stagger + (hashGrass(seed, ix, iz, 901) - .5) * 2 * jitter / cell) % side;
      const pz = iz + .5 + (hashGrass(seed, ix, iz, 902) - .5) * 2 * jitter / cell;
      centres[id] = {
        id, x: px * cell - half, z: pz * cell - half,
        radius: microGroupRadius * (.8 + .4 * hashGrass(seed, ix, iz, 903)),
      };
    }
  }

  return {
    count: centres.length,
    nearest(x, z) {
      const gx = Math.max(0, Math.min(side - 1, Math.floor((x + half) / cell)));
      const gz = Math.max(0, Math.min(side - 1, Math.floor((z + half) / cell)));
      let best = null, bestDistance = Infinity;
      // Each centre is confined to its own grid bucket (plus small stagger);
      // a local search avoids O(clumps * all groups) distance comparisons.
      for (let iz = Math.max(0, gz - 2); iz <= Math.min(side - 1, gz + 2); iz++) {
        for (let ix = Math.max(0, gx - 2); ix <= Math.min(side - 1, gx + 2); ix++) {
          const candidate = centres[iz * side + ix];
          const d2 = (x - candidate.x) ** 2 + (z - candidate.z) ** 2;
          if (d2 < bestDistance) {
            bestDistance = d2;
            best = candidate;
          }
        }
      }
      return best;
    },
    place(x, z, row, col) {
      const group = this.nearest(x, z);
      const angle = hashGrass(seed, row, col, 904) * Math.PI * 2;
      // Uniformly filled disk, not a hard ring of blades.
      const distance = Math.sqrt(hashGrass(seed, row, col, 905)) * group.radius;
      const targetX = group.x + Math.cos(angle) * distance;
      const targetZ = group.z + Math.sin(angle) * distance;
      const strength = microGroupStrength;
      return {
        x: Math.max(-half, Math.min(half - 1e-7, x + (targetX - x) * strength)),
        z: Math.max(-half, Math.min(half - 1e-7, z + (targetZ - z) * strength)),
        groupId: group.id,
      };
    },
  };
}

// Variable step rows: every X/Z step is randomly min..max. Rows are separated
// by >= min, so even staggered clumps never violate the minimum spacing.
// Density is a separate upper budget: thinning may increase visible gaps.
export function generateGrassClumps(input, tileSize = 10) {
  const config = validateGrassConfig(input);
  if (!Number.isFinite(tileSize) || tileSize <= 0) throw new RangeError('invalid tile size');
  const {
    seed, fieldSize, clumpGapMin: lo, clumpGapMax: hi,
    bladeDensity, bladesPerClump, minHeight, maxHeight, trianglesPerBlade,
  } = config;
  const half = fieldSize / 2;
  const meanStep = (lo + hi) / 2;
  const expectedPositions = fieldSize ** 2 / meanStep ** 2;
  const target = Math.min(MAX_CLUMPS * .97, fieldSize ** 2 * bladeDensity / bladesPerClump);
  const probability = Math.min(1, target / expectedPositions);
  const tiles = new Map();
  const voronoi = config.voronoiStrength > 0 ? createVoronoiField(config) : null;
  const microgroups = config.microGroupStrength > 0 ? createMicroGroupField(config) : null;
  const occupiedMicrogroups = new Set();
  let count = 0, row = 0;
  const maxRows = Math.ceil(fieldSize / Math.max(lo, .01)) + 2;
  let z = -half + hashGrass(seed, -1, 0, 300) * meanStep;
  while (z < half && row < maxRows) {
    let col = 0;
    let x = -half + hashGrass(seed, row, -1, 301) * meanStep;
    const maxCols = Math.ceil(fieldSize / Math.max(lo, .01)) + 2;
    while (x < half && col < maxCols) {
      const grouped = microgroups ? microgroups.place(x, z, row, col) : null;
      const px = grouped?.x ?? x, pz = grouped?.z ?? z;
      const patch = voronoi ? voronoi.sample(px, pz) : null;
      const influence = patch?.influence ?? 0;
      // Blend the fertility of the nearest TWO Voronoi regions. Never
      // reduce density just because a point is on their shared boundary:
      // that created conspicuous winding empty "roads" between clumps.
      const borderMix = patch ? (1 - patch.interior) * .5 : 0;
      const fertility = patch
        ? patch.seed.density * (1 - borderMix) +
          (patch.second?.density ?? patch.seed.density) * borderMix
        : 1;
      const densityFactor = 1 + (fertility - 1) * config.voronoiStrength;
      if (hashGrass(seed, row, col, 302) < Math.min(1, probability * densityFactor)) {
        const randomHeight = hashGrass(seed, row, col, 303);
        const heightBlend = influence * .87;
        const height = minHeight + (randomHeight * (1 - heightBlend) +
          (patch?.seed.height ?? randomHeight) * heightBlend) * (maxHeight - minHeight);
        const randomYaw = hashGrass(seed, row, col, 304) * Math.PI * 2;
        // Shortest-arc angle interpolation avoids a seam at 0/2π.
        const targetYaw = patch?.seed.yaw ?? randomYaw;
        const voronoiYaw = randomYaw + Math.atan2(Math.sin(targetYaw - randomYaw),
          Math.cos(targetYaw - randomYaw)) * influence * .85;
        const yaw = alignClumpYaw(voronoiYaw, config.windDirection, config.windAlignment);
        const randomTint = hashGrass(seed, row, col, 305);
        const tint = randomTint * (1 - influence * .65) +
          (patch?.seed.tint ?? randomTint) * influence * .65;
        const lod = hashGrass(seed, row, col, 306);
        const tx = Math.floor((px + half) / tileSize);
        const tz = Math.floor((pz + half) / tileSize);
        const key = tx + ',' + tz;
        let tile = tiles.get(key);
        if (!tile) {
          tile = { tx, tz, clumps: [] };
          tiles.set(key, tile);
        }
        tile.clumps.push({ x: px, z: pz, height, yaw, tint, lod, groupId: grouped?.groupId ?? null });
        if (grouped) occupiedMicrogroups.add(grouped.groupId);
        count++;
      }
      x += Math.max(.001, lo + hashGrass(seed, row, col, 307) * (hi - lo));
      col++;
    }
    z += Math.max(.001, lo + hashGrass(seed, row, 0, 308) * (hi - lo));
    row++;
  }
  return {
    config, tiles, clumpCount: count,
    bladeCount: count * bladesPerClump,
    meanStep, requestedClumps: Math.round(fieldSize ** 2 * bladeDensity / bladesPerClump),
    maxClumps: MAX_CLUMPS,
    microGroupCount: occupiedMicrogroups.size,
    microGroupCenters: microgroups?.count ?? 0,
    trianglesPerClump: bladesPerClump * trianglesPerBlade,
    triangleCount: count * bladesPerClump * trianglesPerBlade,
  };
}
