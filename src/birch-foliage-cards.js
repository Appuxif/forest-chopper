/**
 * Procedural birch (Betula pendula) foliage-card generator.
 * Ported from the standalone birch editor: same geometry, seed and default preset.
 * Three.js r170 (same CDN version as Forest Chopper).
 *
 * Browser only: creates two procedural CanvasTextures (bark and leaf atlas).
 * Generate a handful of seeded variants, then instance the resulting meshes in the forest.
 * Does not add anything to the game scene by itself.
 */
import * as THREE from 'https://esm.sh/three@0.170.0';
import {BIRCH_PRESET} from './tree-model-presets.js';
export {BIRCH_PRESET};

const clamp = THREE.MathUtils.clamp;
const between = (rng, a, b) => a + (b - a) * rng();

function random(seed) {
  let s = Math.floor(seed) >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normalized(v) {
  return v.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : v.normalize();
}
function pointOnLine(points, u) {
  const a = clamp(u, 0, 1) * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(a));
  return points[i].clone().lerp(points[i + 1], a - i);
}
function tangentOnLine(points, u) {
  const delta = 0.02;
  return normalized(pointOnLine(points, Math.min(1, u + delta))
    .sub(pointOnLine(points, Math.max(0, u - delta))));
}



// Combine tapered open tube segments in one BufferGeometry, one draw call per material.
function tubeBuilder() {
  const pos = [], uv = [], indices = [];
  function segment(a, b, ra, rb, sides, v0 = 0, v1 = 1) {
    if (a.distanceToSquared(b) < 1e-12) return;
    const axis = normalized(b.clone().sub(a));
    const side = normalized(new THREE.Vector3().crossVectors(
      axis, Math.abs(axis.y) < 0.90 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1),
    ));
    const other = normalized(new THREE.Vector3().crossVectors(axis, side));
    const first = pos.length / 3;
    for (let k = 0; k <= sides; k++) {
      const angle = k / sides * Math.PI * 2;
      const dir = side.clone().multiplyScalar(Math.cos(angle))
        .addScaledVector(other, Math.sin(angle));
      const p0 = a.clone().addScaledVector(dir, ra);
      const p1 = b.clone().addScaledVector(dir, rb);
      pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      uv.push(k / sides, v0, k / sides, v1);
    }
    for (let k = 0; k < sides; k++) {
      const i = first + 2 * k;
      indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  return {
    segment,
    triangles: () => indices.length / 3,
    geometry: () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(indices);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      return g;
    },
  };
}

// Bark markings and slight darkening near the base; no extra mesh polygons.
function barkTexture(p, rng) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const c = canvas.getContext('2d');
  c.fillStyle = p.barkColor;
  c.fillRect(0, 0, 512, 1024);
  for (let n = 0; n < 5500; n++) {
    const x = rng() * 512, y = rng() * 1024, r = rng();
    c.fillStyle = r < 0.65 ? 'rgba(53,61,57,.035)' : 'rgba(255,255,240,.13)';
    c.fillRect(x, y, between(rng, 0.8, 4), between(rng, 1, 15));
  }
  for (let n = 0; n < 195; n++) {
    const x = rng() * 512, y = rng() * 1024;
    let w = between(rng, 5, 67), h = between(rng, 0.8, 3.9);
    if (rng() < 0.16) {
      w = between(rng, 29, 128);
      h = between(rng, 3, 9);
    }
    c.fillStyle = p.barkMarkColor;
    c.globalAlpha = between(rng, 0.38, 0.88);
    c.beginPath();
    c.ellipse(x, y, w / 2, h / 2, between(rng, -0.07, 0.07), 0, 2 * Math.PI);
    c.fill();
    if (rng() < 0.25) {
      c.beginPath();
      c.ellipse(x + between(rng, -12, 12), y + 4, w * 0.3, h * 0.2, 0, 0, 2 * Math.PI);
      c.fill();
    }
  }
  c.globalAlpha = 1;
  const shade = c.createLinearGradient(0, 1024, 0, 460);
  shade.addColorStop(0, 'rgba(42,42,38,.36)');
  shade.addColorStop(1, 'rgba(42,42,38,0)');
  c.fillStyle = shade;
  c.fillRect(0, 0, 512, 1024);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Four different birch sprays in a 2x2 RGBA atlas; one quad per foliage card.
function leavesTexture(p, seed) {
  const rng = random(seed + 12345);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const c = canvas.getContext('2d');
  const base = new THREE.Color(p.leafColor);
  const accent = new THREE.Color(p.leafAccent);
  const chooseColor = t => '#' + base.clone().lerp(accent, clamp(t, 0, 1)).getHexString();
  const drawLeaf = (x, y, len, wide, angle, color) => {
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, 0);
    c.bezierCurveTo(len * 0.22, -wide * 0.6, len * 0.60, -wide * 0.86, len, 0);
    c.bezierCurveTo(len * 0.65, wide * 0.54, len * 0.26, wide * 0.67, 0, 0);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(18,58,20,.32)';
    c.lineWidth = 0.9;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(len * 0.89, 0);
    c.stroke();
    c.restore();
  };
  for (let tile = 0; tile < 4; tile++) {
    const cx = (tile % 2) * 512, cy = Math.floor(tile / 2) * 512;
    c.save();
    c.beginPath();
    c.rect(cx + 3, cy + 3, 506, 506);
    c.clip();
    const tilt = between(rng, -24, 24), mid = cy + 250 + tilt;
    c.strokeStyle = '#585743';
    c.lineWidth = between(rng, 2.2, 4);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(cx + 26, mid + 24);
    c.bezierCurveTo(cx + 170, mid - 10, cx + 330, mid + 20, cx + 489, mid - 10);
    c.stroke();
    const amount = Math.max(3, Math.round(p.leafCount + between(rng, -2, 2)));
    for (let i = 0; i < amount; i++) {
      const t = (i + 0.3) / (amount + 0.1);
      const x = cx + 39 + t * 434;
      const y = mid + 24 - 34 * t + 8 * Math.sin(t * 6 * Math.PI);
      const sign = i % 2 === 0 ? -1 : 1;
      const spread = between(rng, 47, 112) * (1 - 0.23 * t);
      const xOff = between(rng, 15, 46);
      c.strokeStyle = '#555a3b';
      c.lineWidth = between(rng, 1.0, 1.8);
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + xOff * 0.35, y + sign * spread * 0.5, x + xOff, y + sign * spread);
      c.stroke();
      const leafSize = between(rng, 26, 49) * (1 - 0.12 * t);
      drawLeaf(x + xOff * 0.65, y + sign * spread * 0.70,
        leafSize, between(rng, 15, 30), sign * between(rng, 0.3, 0.95),
        chooseColor(between(rng, 0.08, 0.88)));
      if (rng() < 0.76) drawLeaf(x + xOff, y + sign * spread,
        leafSize * 0.78, between(rng, 12, 22),
        sign * between(rng, 0.2, 1.1) + 0.17, chooseColor(between(rng, 0.16, 0.9)));
      if (rng() < 0.39) drawLeaf(x + xOff * 0.52, y + sign * spread * 0.43,
        leafSize * 0.63, between(rng, 11, 19), -sign * 0.55,
        chooseColor(between(rng, 0.14, 0.9)));
    }
    c.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  return tex;
}

/**
 * Generate one procedural birch THREE.Group with bark, branch and foliage meshes.
 * @param {object} data - BIRCH_PRESET-shaped spec, or {params:{...}}.
 * @returns {THREE.Group} group with userData.stats and birchAtlas.
 */
export function createBirch(data = BIRCH_PRESET) {
  const p = data.params ?? data;
  const seed = Math.floor(Number(p.seed) || 0);
  const rng = random(seed);
  const H = clamp(+p.trunkHeight, 3, 20);
  const R = clamp(+p.trunkRadius, 0.07, 0.7);
  const cap = clamp(Math.round(+p.maxTriangles), 600, 25000);
  const bark = tubeBuilder(), branches = tubeBuilder(), shots = tubeBuilder();
  const trunkAt = t => new THREE.Vector3(
    Math.sin(t * 2.4) * p.trunkCurve * t, H * t,
    Math.sin(t * 3.5 + 1) * p.trunkCurve * t * 0.4,
  );
  const trunkSeg = 12;
  for (let k = 0; k < trunkSeg; k++) {
    const u = k / trunkSeg, v = (k + 1) / trunkSeg;
    bark.segment(trunkAt(u), trunkAt(v),
      R * Math.pow(1 - u, 0.82), Math.max(0.004, R * Math.pow(1 - v, 0.82)),
      10, 1 - v, 1 - u);
  }
  const n = Math.round(clamp(+p.branchCount, 4, 125));
  const start = clamp(+p.branchStartHeight, 0.3, H * 0.8);
  const woodBudget = Math.max(240, Math.floor(cap * 0.56));
  const targets = [], shoots = [];
  let madeBranches = 0;
  for (let k = 0; k < n; k++) {
    const t = Math.pow((k + 0.12) / n, 0.91);
    const y = start + (H * 0.95 - start) * t;
    const origin = trunkAt(y / H);
    const az = k * 2.39996323 + between(rng, -0.58, 0.58);
    const radial = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const side = new THREE.Vector3(-radial.z, 0, radial.x);
    const pitch = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(p.branchPitch, p.branchTopPitch, t));
    const len = (+p.branchLength) * Math.pow(Math.max(0.07, 1 - t), 0.72)
      * between(rng, 0.79, 1.16);
    const points = [];
    for (let j = 0; j <= 5; j++) {
      const u = j / 5;
      const pos = origin.clone().addScaledVector(radial, len * u * Math.cos(pitch));
      pos.y += len * (u * Math.sin(pitch) - p.branchDroop * (0.08 * u + 0.78 * u * u));
      pos.addScaledVector(side, len * p.branchCurve * Math.sin(u * Math.PI * 0.85)
        * between(rng, -0.12, 0.12));
      points.push(pos);
    }
    const sides = 5, r0 = Math.max(0.007, R * (0.33 * (1 - t) + 0.09));
    if (bark.triangles() + branches.triangles() + 5 * sides * 2 > woodBudget) continue;
    for (let j = 0; j < 5; j++) {
      const u = j / 5, v = (j + 1) / 5;
      branches.segment(points[j], points[j + 1],
        Math.max(0.002, r0 * (1 - u) ** 1.2),
        Math.max(0.001, r0 * (1 - v) ** 1.2), sides, u, v);
    }
    madeBranches++;
    const shootCount = Math.round(clamp(+p.shootsPerBranch, 0, 20));
    for (let j = 0; j < shootCount; j++) {
      const u = clamp(0.43 + (j + 0.45) / Math.max(1, shootCount) * 0.48
        + between(rng, -0.035, 0.035), 0.36, 0.97);
      const base = pointOnLine(points, u), axis = tangentOnLine(points, u);
      const pairSide = j % 2 === 0 ? 1 : -1, divergence = between(rng, 0.27, 0.84);
      const vdir = normalized(axis.clone().multiplyScalar(between(rng, 0.45, 0.76))
        .addScaledVector(side, pairSide * divergence)
        .add(new THREE.Vector3(0, -p.shootDroop * 0.55, 0)));
      const length = (+p.shootLength) * between(rng, 0.72, 1.23) * (1 - 0.24 * t);
      const path = [base];
      for (let q = 1; q <= 4; q++) {
        const w = q / 4, pt = base.clone().addScaledVector(vdir, length * w);
        pt.y -= length * (+p.shootDroop) * 0.32 * w * w;
        path.push(pt);
      }
      shoots.push({path, base, angle: between(rng, -1, 1)});
      if (p.showShootWood === true && bark.triangles() + branches.triangles()
        + shots.triangles() + 24 <= woodBudget) {
        const rr = Math.max(0.0014, r0 * 0.16 * (1 - u));
        for (let q = 0; q < 4; q++) shots.segment(path[q], path[q + 1],
          Math.max(0.00065, rr * (1 - q / 4)),
          Math.max(0.0004, rr * (1 - (q + 1) / 4)), 3);
      }
      if (p.showFoliage !== false) {
        const cards = Math.round(clamp(+p.cardsPerShoot, 1, 12));
        for (let q = 0; q < cards; q++) {
          const v = 0.05 + (q + 0.35) / cards * 0.74;
          targets.push({path, at: v, variant: Math.floor(rng() * 4), twist: between(rng, -1, 1)});
        }
      }
    }
  }

  const coords = [], uvs = [], indices = [];
  const perTarget = p.cardCrossed === false ? 2 : 4;
  const woodTri = bark.triangles() + branches.triangles() + shots.triangles();
  const limit = Math.max(0, Math.floor((cap - woodTri) / perTarget));
  const selected = targets.length > limit
    ? targets.filter((_, i) => Math.floor((i + 1) * limit / targets.length)
        > Math.floor(i * limit / targets.length))
    : targets;
  function addCard(target, theta) {
    const dir = tangentOnLine(target.path, target.at);
    const loc = pointOnLine(target.path, target.at);
    let vertical = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y);
    if (vertical.lengthSq() < 0.01)
      vertical = new THREE.Vector3(1, 0, 0).addScaledVector(dir, -dir.x);
    vertical.normalize().applyAxisAngle(dir, theta);
    const len = +p.shootLength * +p.cardLengthScale * 0.52 * (1 - target.at * 0.4);
    const width = +p.shootLength * +p.cardWidthScale * 0.36;
    const first = coords.length / 3;
    const center = loc.clone().addScaledVector(dir, len * 0.38);
    const P = [
      center.clone().addScaledVector(dir, -len * 0.5).addScaledVector(vertical, -width * 0.5),
      center.clone().addScaledVector(dir, len * 0.5).addScaledVector(vertical, -width * 0.5),
      center.clone().addScaledVector(dir, len * 0.5).addScaledVector(vertical, width * 0.5),
      center.clone().addScaledVector(dir, -len * 0.5).addScaledVector(vertical, width * 0.5),
    ];
    for (const v of P) coords.push(v.x, v.y, v.z);
    const x = target.variant % 2, y = Math.floor(target.variant / 2), pad = 0.008;
    const u0 = (x + pad) * 0.5, u1 = (x + 1 - pad) * 0.5;
    const v0 = (y + pad) * 0.5, v1 = (y + 1 - pad) * 0.5;
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  for (const target of selected) {
    const twist = THREE.MathUtils.degToRad(target.twist * p.cardTwist);
    addCard(target, twist);
    if (p.cardCrossed !== false) addCard(target, twist + Math.PI / 2);
  }

  const group = new THREE.Group();
  group.name = data.name || 'Birch Foliage Cards';
  const barkMap = barkTexture(p, random(seed + 200));
  const leafMap = leavesTexture(p, seed);
  const trunk = new THREE.Mesh(bark.geometry(),
    new THREE.MeshStandardMaterial({map: barkMap, roughness: 1, metalness: 0, side: THREE.DoubleSide}));
  trunk.name = 'Ствол · кора';
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  const woodColor = new THREE.Color(p.woodColor || '#514c40');
  const branchMesh = new THREE.Mesh(branches.geometry(),
    new THREE.MeshStandardMaterial({color: woodColor, roughness: 1, side: THREE.DoubleSide}));
  branchMesh.name = 'Основные ветви';
  branchMesh.castShadow = true;
  group.add(branchMesh);
  if (shots.triangles()) {
    const twigs = new THREE.Mesh(shots.geometry(),
      new THREE.MeshStandardMaterial({color: woodColor, roughness: 1, side: THREE.DoubleSide}));
    twigs.name = 'Видимые свисающие побеги';
    twigs.castShadow = true;
    group.add(twigs);
  }
  if (indices.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const foliage = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: leafMap,
      alphaTest: clamp(+p.cardAlphaTest, 0.05, 0.9),
      alphaToCoverage: true,
      transparent: false,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
      depthWrite: true,
    }));
    foliage.name = 'Листва · Foliage Cards';
    foliage.castShadow = false;
    foliage.receiveShadow = false;
    group.add(foliage);
  } else {
    leafMap.dispose();
  }
  group.userData.stats = {
    triangles: woodTri + indices.length / 3,
    trunk: bark.triangles(),
    branches: branches.triangles(),
    shootWood: shots.triangles(),
    foliage: indices.length / 3,
    cards: indices.length / 6,
    shoots: shoots.length,
    mainBranches: madeBranches,
    cap,
  };
  // Exposes atlas to editors only; foliage material owns/disposes this texture.
  if (indices.length) group.birchAtlas = leafMap;
  return group;
}

/** Dispose resources created by this one tree (not shared/instanced resources). */
export function disposeBirch(tree) {
  if (!tree) return;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  tree.traverse(object => {
    if (!object.isMesh) return;
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      materials.add(material);
      if (material.map) textures.add(material.map);
    }
  });
  geometries.forEach(v => v.dispose());
  materials.forEach(v => v.dispose());
  textures.forEach(v => v.dispose());
}
