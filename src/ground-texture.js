// A soft, tileable forest-floor color variation, with no pixel-level grass strokes.
// Generated once and shared by the entire ground plane; existing trail covers it.
export const GROUND_TEXTURE_SIZE = 256;
export const GROUND_TILE_METERS = 28;

export function createGroundTexture(THREE, doc = document, renderer = null) {
  const size = GROUND_TEXTURE_SIZE;
  const canvas = doc.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#547340';
  g.fillRect(0, 0, size, size);

  let state = 0x5c47a1b3;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  // Broad, translucent, low-contrast color clouds. Wrap edge-crossing
  // patches onto opposite borders for a seamless ground tile.
  for (let i = 0; i < 55; i++) {
    const x = random() * size, y = random() * size;
    const radius = 24 + random() * 44;
    const pale = random() < .48;
    const center = pale ? 'rgba(144,173,94,0.15)' : 'rgba(31,63,28,0.14)';
    const edge = pale ? 'rgba(144,173,94,0)' : 'rgba(31,63,28,0)';
    for (const dx of [-size,0,size]) for (const dy of [-size,0,size]) {
      const cx = x+dx, cy = y+dy;
      if (cx+radius < 0 || cx-radius > size ||
          cy+radius < 0 || cy-radius > size) continue;
      const gradient = g.createRadialGradient(cx,cy,0,cx,cy,radius);
      gradient.addColorStop(0,center);
      gradient.addColorStop(1,edge);
      g.fillStyle = gradient;
      g.fillRect(cx-radius,cy-radius,radius*2,radius*2);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2000 / GROUND_TILE_METERS, 2000 / GROUND_TILE_METERS);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (renderer) texture.anisotropy = Math.min(4,renderer.capabilities.getMaxAnisotropy());
  return texture;
}
