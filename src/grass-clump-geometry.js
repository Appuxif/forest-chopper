// Shared editor/game blade mesh: identical triangles, curves, roots and normals.
import {generateBladeRoots,hashGrass} from './grass-clumps-core.mjs';

export function makeGrassClumpGeometry(THREE, config) {
  const roots = generateBladeRoots(config);
  const positions = [], colors = [], centres = [], indices = [];
  const progress = [], tangents = [], acrosses = [], grassSide = [], grassAO = [], grassDir = [], grassCentreX = [], grassCentreZ = [];

  for (let blade = 0; blade < config.bladesPerClump; blade++) {
    const root = roots[blade];
    // 0° = every blade bends along one local axis. 360° = the original
    // evenly distributed radial clump, including its small natural jitter.
    const sector = config.bladeAngleSpread * Math.PI / 180;
    const fullCircle = config.bladeAngleSpread === 360;
    const slot = fullCircle ? blade / config.bladesPerClump :
      config.bladesPerClump === 1 ? 0 :
      blade / (config.bladesPerClump - 1) - .5;
    const jitter = (hashGrass(config.seed, blade, 0, 11) - .5) *
      .48 * (sector / (Math.PI * 2));
    const angle = sector * slot + jitter;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const tx = -dz, tz = dx;
    const variance = .72 + hashGrass(config.seed, blade, 0, 13) * .56;
    const phase = hashGrass(config.seed, blade, 0, 14) * Math.PI * 2;
    const width = config.bladeWidth * (.78 + hashGrass(config.seed, blade, 0, 15) * .44);
    const tilt = config.leanAngle * Math.PI / 180 *
      (.73 + hashGrass(config.seed, blade, 0, 16) * .54);
    const sinTilt = Math.sin(tilt), cosTilt = Math.cos(tilt);
    const bend = config.bendAmount * (.8 + hashGrass(config.seed, blade, 0, 17) * .4);

    // Curved centreline: near-vertical at the root, gradually leaning
    // and arching outward. A small, tapered sideways wave makes it look
    // like flexible hair rather than a rigid triangular tooth.
    function spine(t) {
      const t2 = t * t, t3 = t2 * t;
      const rootEase = config.rootUpright;
      const spread = config.spread * variance * (rootEase * t2 * (3 - 2 * t) +
        (1 - rootEase) * t);
      const lean = sinTilt * .52 * ((1 - rootEase) * .24 * t +
        (.72 + .62 * bend) * t2);
      const arch = bend * .16 * t3;
      const lateral = config.waveAmount * .14 *
        (Math.sin(t * 3.2 * Math.PI + phase) - Math.sin(phase)) * t2;
      const forward = spread + lean + arch;
      const rise = Math.max(.03 * t,
        t - (1 - cosTilt) * .37 * t2 - bend * .23 * t3);
      return {
        x: root.x + dx * forward + tx * lateral,
        y: rise,
        z: root.z + dz * forward + tz * lateral,
      };
    }

    const base = positions.length / 3;
    const steps = Math.ceil(config.trianglesPerBlade / 2);
    // Preserve exactly 1..10 triangles per blade by using an indexed strip.
    // Odd triangle counts previously ended with a *single* zero-width tip
    // vertex, which shimmered without MSAA. Start those strips with one
    // centred root instead: the final vertices then form a full tip pair,
    // with exactly the same number of vertices and triangles.
    const oddStrip = config.trianglesPerBlade % 2 !== 0;
    for (let k = 0; k < config.trianglesPerBlade + 2; k++) {
      const t = oddStrip ? (k === 0 ? 0 : Math.ceil(k / 2) / steps) :
        Math.floor(k / 2) / steps;
      const side = oddStrip
        ? (k === 0 ? 0 : (k % 2 === 0 ? 1 : -1))
        : (k % 2 === 0 ? -1 : 1);
      const c = spine(t);
      const near = spine(Math.max(0, t - .015));
      const far = spine(Math.min(1, t + .015));
      let gx = far.x - near.x, gy = far.y - near.y, gz = far.z - near.z;
      const inv = 1 / Math.max(1e-6, Math.hypot(gx, gy, gz));
      gx *= inv; gy *= inv; gz *= inv;

      // Keep a controllable amount of width at the very tip to avoid
      // sub-pixel slivers that shimmer on mobile devices without antialiasing.
      // 0 = former needle profile (but odd strips keep their paired tip).
      // 1 = constant width at the top; no extra triangles or alpha overdraw.
      const rootTaper = .20 + .80 * Math.min(1, t / .15);
      const tipTaper = config.tipWidth + (1 - config.tipWidth) *
        Math.pow(Math.max(0, 1 - t), .70);
      const w = width * rootTaper * tipTaper;
      positions.push(c.x + tx * w * side, c.y, c.z + tz * w * side);
      centres.push(c.x, c.z);
      progress.push(t);
      tangents.push(gx, gy, gz);
      acrosses.push(tx, 0, tz);
      grassSide.push(side);
      grassAO.push(.52 + .48 * Math.pow(t, .65));
      grassDir.push(dx, dz);
      grassCentreX.push(c.x);
      grassCentreZ.push(c.z);
      const tone = .43 + .58 * t;
      colors.push(tone * .92, tone, tone * .72);
    }
    for (let k = 0; k < config.trianglesPerBlade; k++) {
      if (k % 2 === 0) indices.push(base + k, base + k + 1, base + k + 2);
      else indices.push(base + k + 1, base + k, base + k + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('fcBladeCentre', new THREE.Float32BufferAttribute(centres, 2));
  geo.setAttribute('fcBladeProgress', new THREE.Float32BufferAttribute(progress, 1));
  geo.setAttribute('fcBladeTangent', new THREE.Float32BufferAttribute(tangents, 3));
  geo.setAttribute('fcBladeAcross', new THREE.Float32BufferAttribute(acrosses, 3));
  // Legacy aliases keep game shaders/tests compatible while the new
  // geometry uses the same shape as the editor.
  geo.setAttribute('fcGrassDirection', new THREE.Float32BufferAttribute(grassDir, 2));
  geo.setAttribute('fcGrassRibbonSide', new THREE.Float32BufferAttribute(grassSide, 1));
  geo.setAttribute('fcGrassAO', new THREE.Float32BufferAttribute(grassAO, 1));
  geo.setAttribute('fcGrassCenterX', new THREE.Float32BufferAttribute(grassCentreX, 1));
  geo.setAttribute('fcGrassCenterZ', new THREE.Float32BufferAttribute(grassCentreZ, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals(); // fallback when procedural normals are off
  return geo;
}

// Thin leaves must not become black on one side and white on the other.
// MeshBasicMaterial avoids Lambert's opposing front/back lighting while our
// vertex-computed illumination adds stable, symmetric two-sided shading.
