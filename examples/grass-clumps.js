import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {makeGrassClumpGeometry} from '../src/grass-clump-geometry.js';
import {createGroundMicrograssTexture,createForestGroundTexture} from '../src/grass-ground-textures.js';
import {
  DEFAULT_GRASS_CONFIG, generateGrassClumps, generateBladeRoots,
  keepGrassClump, hashGrass, MAX_CLUMPS,
} from './grass-clumps-core.mjs';

const $ = id => document.getElementById(id);
const SLIDER_GROUPS = [
  ['Форма травы', [
    ['bladesPerClump', 'Травинок в пучке', 1, 10, 1, 'шт'],
    ['trianglesPerBlade', 'Треугольников на травинку', 1, 10, 1, 'шт'],
    ['minHeight', 'Минимальная высота пучка', .05, 2, .05, 'м'],
    ['maxHeight', 'Максимальная высота пучка', .05, 2, .05, 'м'],
    ['spread', 'Радиус раскрытия пучка', .03, .65, .01, 'м'],
    ['bladeWidth', 'Полуширина травинки', .004, .06, .002, 'м'],
    ['leanAngle', 'Наклон травинок', 0, 80, 1, '°'],
    ['bendAmount', 'Изгиб дугой / поникание', 0, 1, .01, '×'],
    ['waveAmount', 'Извилистость травинки', 0, 1, .01, '×'],
    ['rootUpright', 'Плавный выход из земли', 0, 1, .01, '×'],
    ['bladeAngleSpread', 'Угол разброса травинок', 0, 360, 1, '°'],
    ['windAlignment', 'Выравнивание пучков по ветру', 0, 1, .01, '×'],
    ['windDirection', 'Общее направление ветра', 0, 360, 1, '°'],
  ]],
  ['Освещение', [
    ['translucencyIntensity', 'Сила просвечивания на солнце', 0, 1.5, .05, '×'],
    ['aoIntensity', 'Затемнение у основания (AO)', 0, 1, .05, '×'],
  ]],
  ['Расстояния и плотность', [
    ['clumpGapMin', 'Мин. расстояние между пучками', 0, 1.50, .05, 'м'],
    ['clumpGapMax', 'Макс. расстояние между пучками', .15, 1.50, .05, 'м'],
    ['bladeGapMin', 'Мин. расстояние между травинками', 0, .20, .005, 'м'],
    ['bladeGapMax', 'Макс. расстояние между травинками', .005, .20, .005, 'м'],
    ['bladeDensity', 'Плотность (травинок/м²)', 1, 200, 1, 'шт/м²'],
    ['microGroupGapMin', 'Мин. шаг между группами пучков', .5, 5, .05, 'м'],
    ['microGroupGapMax', 'Макс. шаг между группами пучков', .5, 5, .05, 'м'],
    ['microGroupRadius', 'Радиус микрогруппы', .1, 1.5, .05, 'м'],
    ['microGroupStrength', 'Сила объединения в микрогруппы', 0, 1, .01, '×'],
    ['voronoiCells', 'Количество Voronoi-кластеров', 10, 300, 1, 'шт'],
    ['voronoiStrength', 'Сила Voronoi Clumping', 0, 1, .01, '×'],
    ['voronoiEdgeSoftness', 'Мягкость границ кластеров', .2, 4, .05, '×'],
  ]],
  ['Карта и оптимизация', [
    ['mapSize', 'Размер карты', 50, 300, 10, 'м'],
    ['fieldSize', 'Размер травяного поля', 30, 100, 10, 'м'],
    ['groundTextureScale', 'Масштаб рисунка микротравы', 2, 12, .5, 'м'],
    ['lodDistance', 'Дальность травы (LOD)', 30, 100, 5, 'м'],
    ['densityStart', 'Начало снижения плотности', 10, 30, 1, 'м'],
    ['densityReduction', 'Снижение плотности у края', 30, 100, 5, '%'],
    ['densityCurve', 'Резкость затухания плотности', 0, 2, .01, '×'],
    ['widthIncrease', 'Добавка ширины у края', 30, 500, 5, '%'],
    ['wind', 'Ветер', 0, 1, .05, '%'],
  ]],
];

const visualCheckboxes = ['proceduralNormals', 'translucency', 'ambientOcclusion', 'groundTextureEnabled'];
const sliders = new Map(), sliderUnit = new Map();
for (const [heading, descriptors] of SLIDER_GROUPS) {
  const h = document.createElement('h2');
  h.textContent = heading;
  $('sliders').append(h);
  for (const [id, title, min, max, step, unit] of descriptors) {
    const label = document.createElement('label');
    label.className = 'setting';
    const line = document.createElement('span');
    const caption = document.createElement('span');
    caption.textContent = title;
    const output = document.createElement('output');
    output.id = 'v-' + id;
    output.htmlFor = id;
    line.append(caption, output);
    const input = document.createElement('input');
    Object.assign(input, { id, type: 'range', min: String(min), max: String(max), step: String(step) });
    input.value = DEFAULT_GRASS_CONFIG[id];
    label.append(line, input);
    $('sliders').append(label);
    sliders.set(id, input);
    sliderUnit.set(id, unit);
  }
}

const geometryKeys = new Set([
  'bladesPerClump','trianglesPerBlade','minHeight','maxHeight','spread','bladeWidth',
  'clumpGapMin','clumpGapMax','bladeGapMin','bladeGapMax','bladeDensity','fieldSize',
  'voronoiCells','voronoiStrength','voronoiEdgeSoftness',
  'microGroupGapMin','microGroupGapMax','microGroupRadius','microGroupStrength',
  'leanAngle','bendAmount','waveAmount','rootUpright',
  'bladeAngleSpread','windAlignment','windDirection',
]);
const canvas = $('canvas');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc0b1);
scene.fog = new THREE.Fog(0x9fc0b1, 40, 350);
const camera = new THREE.PerspectiveCamera(65, 1, .05, 900);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'default' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = .12;
controls.minDistance = .5;
controls.maxDistance = 500;
controls.maxPolarAngle = Math.PI * .495;
controls.target.set(0, .22, 0);
camera.position.set(0, 2, 7);
controls.update();

scene.add(new THREE.HemisphereLight(0xd9f4e8, 0x385035, 2.4));
const sun = new THREE.DirectionalLight(0xfff4d4, 2.5);
sun.position.set(-20, 38, 22);
scene.add(sun);

let ground = null, fieldPlane = null, grid = null, geometry = null;
const records = [];
let lastModel = null, buildTime = 0, lodTime = 0, rebuildTimer = null;
let grassUniforms = null;
const dummy = new THREE.Object3D(), color = new THREE.Color();
let currentConfig = { ...DEFAULT_GRASS_CONFIG };
let lodDirty = true, visibleInstances = 0;
const frustum = new THREE.Frustum(), clip = new THREE.Matrix4();
const lastCamera = new THREE.Vector2(Infinity, Infinity);
let lastLodUpdateAt = -Infinity, lastRenderMetricAt = performance.now(), renderedFrames = 0;
let fps = 0;

function showError(error) {
  console.error(error);
  $('error').textContent = String(error && error.message || error);
  $('error').style.display = 'block';
}
function renderValues() {
  for (const [id, slider] of sliders) {
    const v = Number(slider.value);
    const unit = sliderUnit.get(id);
    const label = (unit === '%' ? (id === 'wind' ? v * 100 : v).toFixed(0) : (
      unit === 'м' ? v.toFixed(v < .1 ? 3 : 2) : String(v)
    )) + ' ' + unit;
    $('v-' + id).textContent = label;
  }
}
function getConfig() {
  const values = { seed: Number($('seed').value) || 0 };
  for (const [id, input] of sliders) values[id] = Number(input.value);
  for (const id of visualCheckboxes) values[id] = $(id).checked;
  values.groundTextureType = $('groundTextureType').value;
  return values;
}
const SETTINGS_KEY = 'forest-chopper:grass-clumps-settings:v1';

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      ...getConfig(),
      grid: $('grid').checked,
      limitDpr: $('limitDpr').checked,
    }));
  } catch (_) { /* Storage may be disabled in private browsing. */ }
}

function restoreSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return;
    for (const [id, input] of sliders) {
      if (typeof saved[id] !== 'number' || !Number.isFinite(saved[id])) continue;
      const value = saved[id];
      if (value >= +input.min && value <= +input.max) input.value = String(value);
    }
    if (Number.isSafeInteger(saved.seed)) $('seed').value = saved.seed;
    if (typeof saved.grid === 'boolean') $('grid').checked = saved.grid;
    if (typeof saved.limitDpr === 'boolean') $('limitDpr').checked = saved.limitDpr;
    if (['micrograss', 'forest'].includes(saved.groundTextureType))
      $('groundTextureType').value = saved.groundTextureType;
    for (const id of visualCheckboxes) {
      if (typeof saved[id] === 'boolean') $(id).checked = saved[id];
    }
    // Validate dependent ranges without dispatching events before first render.
    enforceBounds();
  } catch (_) { /* Missing/corrupt storage falls back to defaults. */ }
}

function enforceBounds(changed) {
  for (const [lo, hi] of [
    ['minHeight', 'maxHeight'], ['clumpGapMin', 'clumpGapMax'],
    ['bladeGapMin', 'bladeGapMax'],
    ['microGroupGapMin', 'microGroupGapMax'],
  ]) {
    if (+sliders.get(lo).value > +sliders.get(hi).value) {
      if (changed === hi) sliders.get(lo).value = sliders.get(hi).value;
      else sliders.get(hi).value = sliders.get(lo).value;
    }
  }
  if (+sliders.get('fieldSize').value > +sliders.get('mapSize').value) {
    if (changed === 'mapSize') sliders.get('fieldSize').value = sliders.get('mapSize').value;
    else sliders.get('mapSize').value = sliders.get('fieldSize').value;
  }
}

const grassMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff, vertexColors: true,
  side: THREE.DoubleSide, toneMapped: false,
});

function updateGrassShader(config = currentConfig) {
  if (!grassUniforms) return;
  grassUniforms.wind.value = config.wind;
  grassUniforms.start.value = config.densityStart;
  grassUniforms.end.value = config.lodDistance;
  grassUniforms.width.value = config.widthIncrease / 100;
  grassUniforms.curve.value = config.densityCurve;
  grassUniforms.proceduralNormals.value = config.proceduralNormals ? 1 : 0;
  grassUniforms.translucency.value = config.translucency ? 1 : 0;
  grassUniforms.ambientOcclusion.value = config.ambientOcclusion ? 1 : 0;
  grassUniforms.translucencyIntensity.value = config.translucencyIntensity;
  grassUniforms.aoIntensity.value = config.aoIntensity;
}

grassMaterial.onBeforeCompile = shader => {
  grassUniforms = {
    time: { value: 0 },
    wind: { value: currentConfig.wind },
    camera: { value: new THREE.Vector2(camera.position.x, camera.position.z) },
    cameraWorld: { value: camera.position.clone() },
    sunWorld: { value: sun.position.clone().normalize() },
    start: { value: currentConfig.densityStart },
    end: { value: currentConfig.lodDistance },
    width: { value: currentConfig.widthIncrease / 100 },
    curve: { value: currentConfig.densityCurve },
    proceduralNormals: { value: currentConfig.proceduralNormals ? 1 : 0 },
    translucency: { value: currentConfig.translucency ? 1 : 0 },
    ambientOcclusion: { value: currentConfig.ambientOcclusion ? 1 : 0 },
    translucencyIntensity: { value: currentConfig.translucencyIntensity },
    aoIntensity: { value: currentConfig.aoIntensity },
  };
  Object.assign(shader.uniforms, {
    fcGrassTime: grassUniforms.time,
    fcGrassWind: grassUniforms.wind,
    fcGrassCamera: grassUniforms.camera,
    fcCameraWorld: grassUniforms.cameraWorld,
    fcSunWorld: grassUniforms.sunWorld,
    fcGrassStart: grassUniforms.start,
    fcGrassEnd: grassUniforms.end,
    fcGrassWidthMax: grassUniforms.width,
    fcGrassCurve: grassUniforms.curve,
    fcProceduralNormals: grassUniforms.proceduralNormals,
    fcTranslucency: grassUniforms.translucency,
    fcAO: grassUniforms.ambientOcclusion,
    fcTranslucencyIntensity: grassUniforms.translucencyIntensity,
    fcAOIntensity: grassUniforms.aoIntensity,
  });

  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', [
      '#include <common>',
      'uniform float fcGrassTime;',
      'uniform float fcGrassWind;',
      'uniform vec2 fcGrassCamera;',
      'uniform vec3 fcCameraWorld;',
      'uniform vec3 fcSunWorld;',
      'uniform float fcGrassStart;',
      'uniform float fcGrassEnd;',
      'uniform float fcGrassWidthMax;',
      'uniform float fcGrassCurve;',
      'attribute vec2 fcBladeCentre;',
      'attribute float fcBladeProgress;',
      'attribute vec3 fcBladeTangent;',
      'attribute vec3 fcBladeAcross;',
      'varying float vFcBladeProgress;',
      'varying float vFcSmoothLight;',
      'varying float vFcFlatLight;',
      'varying float vFcBackLight;',
    ].join('\n'))
    .replace('#include <begin_vertex>', [
      '#include <begin_vertex>',
      'vFcBladeProgress = fcBladeProgress;',
      '#ifdef USE_INSTANCING',
      '  float fcDist = length(instanceMatrix[3].xz - fcGrassCamera);',
      '  float fcT = clamp((fcDist-fcGrassStart) / max(.001,fcGrassEnd-fcGrassStart),0.0,1.0);',
      '  fcT = fcGrassCurve < 0.005 ? 0.0 : pow(fcT, fcGrassCurve);',
      '  float fcWidth = 1.0 + fcT * fcGrassWidthMax;',
      '  transformed.xz = fcBladeCentre + (transformed.xz - fcBladeCentre) * fcWidth;',
      '  float fcWave = sin(fcGrassTime * 1.35 + instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.21);',
      '  float fcWave2 = sin(fcGrassTime * 0.79 + instanceMatrix[3].z * 0.37);',
      '  float fcTipWeight = fcBladeProgress * fcBladeProgress;',
      '  transformed.x += fcGrassWind * fcWave * fcTipWeight * 0.085;',
      '  transformed.z += fcGrassWind * fcWave2 * fcTipWeight * 0.056;',
      '#endif',
      // Computed once per vertex rather than per fragment for mobile GPUs.
      // Use ABS of the N.L term: either face of a thin leaf gets the same light.
      'vec3 fcSmoothN = normalize(cross(fcBladeAcross, fcBladeTangent));',
      'vec3 fcFlatN = normalize(cross(fcBladeAcross, vec3(0.0, 1.0, 0.0)));',
      'vec4 fcWorldP = vec4(transformed, 1.0);',
      '#ifdef USE_INSTANCING',
      '  fcSmoothN = normalize(mat3(instanceMatrix) * fcSmoothN);',
      '  fcFlatN = normalize(mat3(instanceMatrix) * fcFlatN);',
      '  fcWorldP = instanceMatrix * fcWorldP;',
      '#endif',
      'fcSmoothN = normalize(mat3(modelMatrix) * fcSmoothN);',
      'fcFlatN = normalize(mat3(modelMatrix) * fcFlatN);',
      'fcWorldP = modelMatrix * fcWorldP;',
      'vFcSmoothLight = abs(dot(fcSmoothN, normalize(fcSunWorld)));',
      'vFcFlatLight = abs(dot(fcFlatN, normalize(fcSunWorld)));',
      'vFcBackLight = max(dot(-normalize(fcCameraWorld - fcWorldP.xyz),',
      '  normalize(fcSunWorld)), 0.0);',
    ].join('\n'));

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', [
      '#include <common>',
      'uniform float fcProceduralNormals;',
      'uniform float fcTranslucency;',
      'uniform float fcAO;',
      'uniform float fcTranslucencyIntensity;',
      'uniform float fcAOIntensity;',
      'varying float vFcBladeProgress;',
      'varying float vFcSmoothLight;',
      'varying float vFcFlatLight;',
      'varying float vFcBackLight;',
    ].join('\n'))
    .replace('#include <color_fragment>', [
      '#include <color_fragment>',
      // Off: flatter, more uniform lighting. On: bent leaf normals visibly
      // influence the brightness along its length (no hard dark backface).
      'float fcFlat = 0.70 + 0.23 * vFcFlatLight;',
      'float fcCurved = 0.52 + 0.46 * vFcSmoothLight;',
      'float fcLight = mix(fcFlat, fcCurved, fcProceduralNormals);',
      // Transmission brightens the top of the blades, stronger when the
      // sun is behind them. It never replaces their green pigment with white.
      'if (fcTranslucency > 0.5) {',
      '  float fcTransmission = (0.20 + 0.48 * vFcBackLight) *',
      '    (0.30 + 0.70 * vFcBladeProgress);',
      '  fcLight += fcTranslucencyIntensity * fcTransmission;',
      '}',
      // Cheap height-gradient AO, noticeable beyond just the root vertex.
      'if (fcAO > 0.5) {',
      '  float fcRootShade = pow(1.0 - vFcBladeProgress, 1.4);',
      '  fcLight *= 1.0 - 0.88 * fcAOIntensity * fcRootShade;',
      '}',
      'diffuseColor.rgb *= clamp(fcLight, 0.22, 1.14);',
    ].join('\n'));
};
grassMaterial.customProgramCacheKey = () => 'fc-grass-clumps-symmetric-leaf-light-v4';

// Tileable, hand-painted-style micrograss. CanvasTexture is generated once;
// no download, external images, extra mesh or per-frame work.
let micrograssTexture = null;
let forestGroundTexture = null;
function getGroundTexture(type) {
  if (type === 'forest') {
    if (!forestGroundTexture) forestGroundTexture = createForestGroundTexture(THREE,renderer);
    return forestGroundTexture;
  }
  if (!micrograssTexture) micrograssTexture = createGroundMicrograssTexture(THREE,renderer);
  return micrograssTexture;
}
function groundAppearance(config, isField) {
  if (!config.groundTextureEnabled) {
    return { map: null, color: isField ? 0x597844 : 0x526747 };
  }
  const forest = config.groundTextureType === 'forest';
  return {
    map: getGroundTexture(config.groundTextureType),
    color: forest ? (isField ? 0xe7d9c8 : 0xc7b8a5) :
      (isField ? 0xf6ffe8 : 0xe0eccf),
  };
}

function makeGroundPlane(size, y, config, isField) {
  const geometry = new THREE.PlaneGeometry(size, size);
  // World-aligned UVs make the map and grassy area texture seamless.
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) - .5) * size / config.groundTextureScale,
      (uv.getY(i) - .5) * size / config.groundTextureScale);
  }
  uv.needsUpdate = true;
  const appearance = groundAppearance(config, isField);
  const material = new THREE.MeshLambertMaterial({
    map: appearance.map,
    color: appearance.color,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

function updateGroundAppearance(config) {
  for (const [plane, isField] of [[ground, false], [fieldPlane, true]]) {
    if (!plane) continue;
    const appearance = groundAppearance(config, isField);
    plane.material.map = appearance.map;
    plane.material.color.setHex(appearance.color);
    plane.material.needsUpdate = true;
  }
}

function disposePlane(plane) {
  if (!plane) return;
  scene.remove(plane);
  plane.geometry.dispose();
  plane.material.dispose();
}
function replaceGround(config) {
  disposePlane(ground);
  disposePlane(fieldPlane);
  disposePlane(grid);
  ground = makeGroundPlane(config.mapSize, -.025, config, false);
  scene.add(ground);
  fieldPlane = makeGroundPlane(config.fieldSize, -.014, config, true);
  scene.add(fieldPlane);
  grid = new THREE.GridHelper(config.mapSize, config.mapSize, 0xabc19d, 0xb0caa7);
  grid.position.y = .003;
  for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
    material.transparent = true;
    material.opacity = .22;
    material.depthWrite = false;
  }
  grid.visible = $('grid').checked;
  scene.add(grid);
  scene.fog.near = Math.max(40, config.mapSize * .22);
  scene.fog.far = Math.max(170, config.mapSize * 1.85);
}

function disposeMeshes() {
  for (const r of records) {
    scene.remove(r.mesh);
    r.mesh.dispose(); // instance buffers; geometry and material are shared
  }
  records.length = 0;
  if (geometry) geometry.dispose();
  geometry = null;
}

function rebuild() {
  try {
    const start = performance.now();
    const model = generateGrassClumps(getConfig());
    const { config } = model;
    disposeMeshes();
    geometry = makeGrassClumpGeometry(THREE, config);
    replaceGround(config);
    currentConfig = config;
    const half = config.fieldSize / 2;
    for (const tile of model.tiles.values()) {
      const count = tile.clumps.length;
      if (!count) continue;
      const mesh = new THREE.InstancedMesh(geometry, grassMaterial, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Allocate color buffer once. LOD compacts BOTH matrices and colors.
      mesh.setColorAt(0, new THREE.Color(0xffffff));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      const matrices = new Float32Array(count * 16);
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const tuft = tile.clumps[i];
        dummy.position.set(tuft.x, 0, tuft.z);
        dummy.rotation.set(0, tuft.yaw, 0);
        dummy.scale.set(1, tuft.height, 1); // shared height for ALL blades
        dummy.updateMatrix();
        matrices.set(dummy.matrix.elements, i * 16);
        color.setHSL(.285 + (tuft.tint - .5) * .067,
          .46 + tuft.tint * .15, .55 + tuft.tint * .12);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      const cx = (tile.tx + .5) * 10 - half, cz = (tile.tz + .5) * 10 - half;
      // Permanent bounds cover the FULL tile and the maximum curled/wind-
      // expanded blades, even when the currently visible instance set changes.
      mesh.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(cx, config.maxHeight * .5, cz),
        Math.SQRT2 * 5 + config.maxHeight + config.spread * 2 +
          config.bladesPerClump * config.bladeGapMax + 2.0, // arch + lean + wind
      );
      mesh.frustumCulled = true; // Three.js skips entire off-screen tiles
      mesh.count = 0;
      mesh.visible = false;
      mesh.userData.grassClumpTile = [tile.tx, tile.tz];
      scene.add(mesh);
      records.push({ mesh, clumps: tile.clumps, matrices, colors, cx, cz, count: 0 });
    }
    lastModel = model;
    updateGrassShader(config);
    lodDirty = true;
    refreshLOD(true);
    buildTime = Math.round(performance.now() - start);
    $('error').style.display = 'none';
  } catch (error) {
    showError(error);
  }
}

function refreshLOD(force = false) {
  const now = performance.now();
  const x = camera.position.x, z = camera.position.z;
  if (!force && !lodDirty && Math.hypot(x - lastCamera.x, z - lastCamera.y) < .9) return;
  if (!force && now - lastLodUpdateAt < 130) return;
  const started = performance.now();
  const range = currentConfig.lodDistance;
  let total = 0;
  for (const r of records) {
    // Fast tile distance test: only scan per-instance data inside LOD range.
    const dx = Math.max(0, Math.abs(x - r.cx) - 5);
    const dz = Math.max(0, Math.abs(z - r.cz) - 5);
    if (dx * dx + dz * dz > range * range) {
      r.mesh.count = 0;
      r.mesh.visible = false;
      r.count = 0;
      continue;
    }
    let kept = 0;
    const matrixDest = r.mesh.instanceMatrix.array;
    const colorDest = r.mesh.instanceColor.array;
    for (let i = 0; i < r.clumps.length; i++) {
      const tuft = r.clumps[i];
      const distance = Math.hypot(tuft.x - x, tuft.z - z);
      if (!keepGrassClump(distance, tuft.lod, currentConfig)) continue;
      matrixDest.set(r.matrices.subarray(i * 16, i * 16 + 16), kept * 16);
      colorDest.set(r.colors.subarray(i * 3, i * 3 + 3), kept * 3);
      kept++;
    }
    r.mesh.count = kept;
    r.mesh.visible = kept > 0;
    r.count = kept;
    // Actual GPU uploads only when this tile's instance data was rewritten.
    if (kept) {
      r.mesh.instanceMatrix.needsUpdate = true;
      r.mesh.instanceColor.needsUpdate = true;
    }
    total += kept;
  }
  visibleInstances = total;
  lodTime = Math.round((performance.now() - started) * 10) / 10;
  lastCamera.set(x, z);
  lastLodUpdateAt = now;
  lodDirty = false;
}

function queueRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, 180);
}

function setCamera(overview) {
  const size = Number(sliders.get('mapSize').value);
  controls.target.set(0, .25, 0);
  if (overview) camera.position.set(size * .08, size * .95, size * .08);
  else camera.position.set(0, 2, 7);
  controls.update();
  lodDirty = true;
}

for (const [id, slider] of sliders) {
  slider.addEventListener('input', () => {
    enforceBounds(id);
    renderValues();
    saveSettings();
    if (geometryKeys.has(id)) queueRebuild();
    else if (id === 'mapSize' || id === 'groundTextureScale') {
      const config = getConfig();
      currentConfig.mapSize = config.mapSize;
      currentConfig.groundTextureScale = config.groundTextureScale;
      replaceGround(config);
      if (+sliders.get('fieldSize').value !== lastModel?.config.fieldSize) queueRebuild();
    } else {
      currentConfig[id] = Number(slider.value);
      updateGrassShader();
      if (id !== 'wind' && id !== 'widthIncrease') lodDirty = true;
    }
  });
}
for (const id of visualCheckboxes) {
  $(id).addEventListener('change', () => {
    currentConfig[id] = $(id).checked;
    if (id === 'groundTextureEnabled') updateGroundAppearance(currentConfig);
    updateGrassShader();
    saveSettings();
  });
}
$('groundTextureType').addEventListener('change', () => {
  currentConfig.groundTextureType = $('groundTextureType').value;
  updateGroundAppearance(currentConfig);
  saveSettings();
});
$('seed').addEventListener('change', () => { saveSettings(); queueRebuild(); });
$('random-seed').addEventListener('click', () => {
  $('seed').value = Math.floor(Math.random() * 1000000);
  saveSettings();
  queueRebuild();
});
$('grid').addEventListener('change', () => { if (grid) grid.visible = $('grid').checked; saveSettings(); });
$('limitDpr').addEventListener('change', () => { resize(); saveSettings(); });
$('camera-close').addEventListener('click', () => setCamera(false));
$('camera-overview').addEventListener('click', () => setCamera(true));
$('export-settings').addEventListener('click', () => {
  const settings = {
    ...getConfig(),
    grid: $('grid').checked,
    limitDpr: $('limitDpr').checked,
  };
  const json = JSON.stringify(settings, null, 2) + '\n';
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'forest-chopper-grass-' + settings.seed + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('panel-toggle').addEventListener('click', () => {
  const collapsed = $('panel').classList.toggle('collapsed');
  $('panel-toggle').textContent = collapsed ? 'Показать параметры' : 'Скрыть параметры';
});
$('reset').addEventListener('click', () => {
  for (const [id, input] of sliders) input.value = DEFAULT_GRASS_CONFIG[id];
  $('seed').value = DEFAULT_GRASS_CONFIG.seed;
  $('grid').checked = false;
  $('limitDpr').checked = true;
  for (const id of visualCheckboxes) $(id).checked = DEFAULT_GRASS_CONFIG[id];
  $('groundTextureType').value = DEFAULT_GRASS_CONFIG.groundTextureType;
  saveSettings();
  renderValues();
  rebuild();
  setCamera(false);
});

function resize() {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const ratio = $('limitDpr').checked ? Math.min(devicePixelRatio || 1, 1.5) : (devicePixelRatio || 1);
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(canvas);
restoreSettings();
resize();
renderValues();
rebuild();

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const time = clock.getElapsedTime();
  refreshLOD();
  if (grassUniforms) {
    grassUniforms.time.value = time;
    grassUniforms.camera.value.set(camera.position.x, camera.position.z);
    grassUniforms.cameraWorld.value.copy(camera.position);
    grassUniforms.sunWorld.value.copy(sun.position).normalize();
  }
  controls.update();
  renderer.render(scene, camera);
  renderedFrames++;
  const now = performance.now();
  if (now - lastRenderMetricAt >= 650) {
    fps = Math.round(renderedFrames * 1000 / (now - lastRenderMetricAt));
    renderedFrames = 0;
    lastRenderMetricAt = now;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let frustumTiles = 0, frustumClumps = 0;
    for (const r of records) {
      if (r.mesh.visible && frustum.intersectsSphere(r.mesh.boundingSphere)) {
        frustumTiles++;
        frustumClumps += r.count;
      }
    }
    const render = renderer.info.render;
    const fmt = n => (n || 0).toLocaleString('ru-RU');
    $('metrics').textContent = [
      'FPS              ' + fps,
      'Draw calls       ' + fmt(render.calls),
      'Треугольники     ' + fmt(render.triangles),
      'Meshes (сцена)   ' + fmt(records.length + 2 + (grid?.visible ? 1 : 0)),
      '',
      'В поле пучков    ' + fmt(lastModel?.clumpCount),
      'В поле травинок  ' + fmt(lastModel?.bladeCount),
      'Микрогрупп        ' + fmt(lastModel?.microGroupCount),
      'Пучков/группу     ' + (lastModel?.microGroupCount
        ? (lastModel.clumpCount / lastModel.microGroupCount).toFixed(1) : '—'),
      'Полных трис      ' + fmt(lastModel?.triangleCount),
      'Инстансов в LOD  ' + fmt(visibleInstances),
      'Инстансов кадр   ' + fmt(frustumClumps),
      'Тайлов в кадре   ' + frustumTiles + ' / ' + records.length,
      'Ограничение      ' + fmt(MAX_CLUMPS) + ' пучков',
      'Генерация        ' + buildTime + ' мс',
      'LOD CPU          ' + lodTime.toFixed(1) + ' мс',
    ].join('\n');
  }
}
animate();
