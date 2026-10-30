// A soft, tileable forest-floor color variation, with no pixel-level grass strokes.
// Generated once and shared by the entire ground plane; existing trail covers it.
export const GROUND_TEXTURE_SIZE = 256;
export const GROUND_TILE_METERS = 28;

// Ground-only, procedural density shadows: no extra shadow render pass or
// per-blade shadow map. Shared clearings match the instanced grass shader.
export function enableGrassDensityShadows(THREE, material) {
  const uniforms={
    fcGroundGrassDensity:{value:25},
    fcGroundGrassClearings:{value:Array.from({length:24},()=>new THREE.Vector4())},
  };
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec2 fcGroundPosition;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nfcGroundPosition=(modelMatrix*vec4(transformed,1.0)).xz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
      `#include <common>
      varying vec2 fcGroundPosition;
      uniform float fcGroundGrassDensity;
      uniform vec4 fcGroundGrassClearings[24];
      float fcGrassHash(vec2 p) {
        return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);
      }
      float fcGrassNoise(vec2 p) {
        vec2 cell=floor(p),f=fract(p);
        f=f*f*(3.0-2.0*f);
        return mix(mix(fcGrassHash(cell),fcGrassHash(cell+vec2(1.,0.)),f.x),
          mix(fcGrassHash(cell+vec2(0.,1.)),fcGrassHash(cell+1.),f.x),f.y);
      }`)
      .replace('#include <map_fragment>',
        `#include <map_fragment>
        // Small-scale overlapping blades create an uneven soft ground shadow.
        float fcCoverage=0.48*fcGrassNoise(fcGroundPosition*1.9)
          +0.52*fcGrassNoise(fcGroundPosition*4.3);
        float fcShadow=clamp((fcCoverage-0.28)*0.36,0.,0.22)
          *clamp(fcGroundGrassDensity/25.,0.,1.5);
        fcShadow*=smoothstep(1.68,2.1,abs(fcGroundPosition.y));
        for(int i=0;i<24;++i){
          vec4 area=fcGroundGrassClearings[i];
          if(area.w>0.5){
            fcShadow*=smoothstep(area.z-0.16,area.z+0.16,
              distance(fcGroundPosition,area.xy));
          }
        }
        diffuseColor.rgb*=1.0-fcShadow;`);
  };
  material.userData.grassDensityUniforms=uniforms;
  return uniforms;
}

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
