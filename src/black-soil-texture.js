// Procedural black, cloddy soil: tileable colour + height/bump map.
// No external assets, per-frame CPU work, additional meshes or polygons.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fade = x => x * x * (3 - 2 * x);

function hash(ix, iy, seed, period) {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  let h = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function periodicNoise(x, y, period, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const tx = fade(x - ix), ty = fade(y - iy);
  const a = hash(ix, iy, seed, period);
  const b = hash(ix + 1, iy, seed, period);
  const c = hash(ix, iy + 1, seed, period);
  const d = hash(ix + 1, iy + 1, seed, period);
  return (a + (b - a) * tx) * (1 - ty) +
    (c + (d - c) * tx) * ty;
}

// Pure deterministic pixels so the material can be validated in Node.
export function buildBlackSoilPixels(size = 512) {
  const color = new Uint8ClampedArray(size * size * 4);
  const height = new Uint8ClampedArray(size * size * 4);
  const elevations = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const broad = periodicNoise(u * 5, v * 5, 5, 7);
      const clods = periodicNoise(u * 23, v * 23, 23, 89);
      const pores = periodicNoise(u * 78, v * 78, 78, 421);
      const grit = periodicNoise(u * 169, v * 169, 169, 991);
      const ridges = Math.pow(1 - Math.abs(2 * clods - 1), 2.1);
      const grain = grit - .5;
      // Deep pits between lumps, rounded clods and fine volcanic grit.
      const h = clamp(.14 + .28 * broad + .34 * ridges +
        .20 * pores + grain * .12, 0, 1);
      elevations[y * size + x] = h;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x, p = idx * 4;
      const h = elevations[idx];
      const left = elevations[y * size + (x + size - 1) % size];
      const right = elevations[y * size + (x + 1) % size];
      const up = elevations[((y + size - 1) % size) * size + x];
      const down = elevations[((y + 1) % size) * size + x];
      // An understated baked top-left highlight shows the relief even
      // when running on cheap devices with minimal dynamic lighting.
      const slope = clamp((left - right + up - down) * 19, -7, 7);
      const value = clamp(10 + h * 32 + slope, 8, 51);
      color[p] = value + 2;
      color[p + 1] = value + 1;
      color[p + 2] = value;
      color[p + 3] = 255;
      const gray = Math.round(20 + h * 214);
      height[p] = height[p + 1] = height[p + 2] = gray;
      height[p + 3] = 255;
    }
  }
  return {color, height};
}

export function createBlackSoilGroundTextures(THREE, renderer, doc = document) {
  const size = 512;
  const {color, height} = buildBlackSoilPixels(size);
  function textureFromPixels(pixels, isColor) {
    const canvas = doc.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', {alpha: false});
    const data = ctx.createImageData(size, size);
    data.data.set(pixels);
    ctx.putImageData(data, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }
  return {
    map: textureFromPixels(color, true),
    bumpMap: textureFromPixels(height, false),
    bumpScale: .065,
  };
}
