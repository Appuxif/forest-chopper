// A soft, tileable forest-floor color variation, with no pixel-level grass strokes.
// Generated once and shared by the entire ground plane; existing trail covers it.
export const GROUND_TEXTURE_SIZE = 256;
export const GROUND_TILE_METERS = 28;

// Worker-baked grass contact AO, sampled from a moving atlas of already baked
// geometry tiles. No CPU root-stamping or sun-shadow passes on game frames.
export function enableGrassDensityShadows(THREE, material) {
  const uniforms={
    fcGroundGrassDensity:{value:25},
    fcGroundGrassShadowMap:{value:null},
    fcGroundGrassShadowIntensity:{value:.8},
    fcGroundGrassShadowRadius:{value:.5},
    fcGroundGrassShadowSoftness:{value:50},
    fcGroundGrassShadowEdgeFade:{value:1},
    fcGroundGrassShadowPatch:{value:new THREE.Vector3(0,0,0)},
    fcGroundGrassClearings:{value:Array.from({length:24},()=>new THREE.Vector4())},
  };
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>',
      '#include <common>\nattribute vec2 fcShoreData;\nvarying vec2 fcShoreMask;\nvarying vec2 fcGroundPosition;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nfcGroundPosition=(modelMatrix*vec4(transformed,1.0)).xz;\nfcShoreMask=fcShoreData;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
      `#include <common>
      varying vec2 fcGroundPosition;
      varying vec2 fcShoreMask;
      uniform float fcGroundGrassDensity;
      uniform sampler2D fcGroundGrassShadowMap;
      uniform float fcGroundGrassShadowIntensity;
      uniform float fcGroundGrassShadowRadius;
      uniform float fcGroundGrassShadowSoftness;
      uniform float fcGroundGrassShadowEdgeFade;
      uniform vec3 fcGroundGrassShadowPatch;
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
        // World-aligned sand on the pond floor and banks. Fragment noise is
        // subtle enough to feel granular without creating moving patterns.
        float fcSand=clamp(fcShoreMask.x,0.0,1.0);
        if(fcSand>0.001){
          float fcBroad=fcGrassNoise(fcGroundPosition*0.65)-0.5;
          float fcGrain=fcGrassNoise(fcGroundPosition*7.5)-0.5;
          float fcFine=fcGrassHash(floor(fcGroundPosition*15.0))-0.5;
          vec3 fcBeach=vec3(.54,.43,.26)
            +fcBroad*vec3(.09,.08,.06)
            +fcGrain*vec3(.065,.055,.038)
            +fcFine*vec3(.025,.022,.018);
          float fcWet=clamp(fcShoreMask.y,0.0,1.0);
          fcBeach*=1.0-.24*fcWet;
          diffuseColor.rgb=mix(diffuseColor.rgb,fcBeach,fcSand);
        }
        // Distance field baked once per generated grass geometry tile in a
        // Worker. Radius/intensity/softness are cheap real-time uniforms.
        if(fcGroundGrassShadowPatch.z>0.0&&fcGroundGrassShadowIntensity>0.0&&
            fcGroundGrassShadowRadius>0.001){
          vec2 fcUV=(fcGroundPosition-fcGroundGrassShadowPatch.xy)/
            fcGroundGrassShadowPatch.z;
          if(all(greaterThanEqual(fcUV,vec2(0.0)))&&
             all(lessThanEqual(fcUV,vec2(1.0)))){
            // Encoded distance is in metres / 1.0; 255 means no nearby root.
            float fcDistance=texture2D(fcGroundGrassShadowMap,fcUV).r;
            float fcT=clamp(fcDistance/max(0.001,fcGroundGrassShadowRadius),0.0,1.0);
            float fcPower=mix(.55,4.0,clamp(fcGroundGrassShadowSoftness/100.0,0.0,1.0));
            float fcShadow=pow(max(0.0,1.0-fcT*fcT),fcPower);
            vec2 fcEdge=min(fcUV,vec2(1.0)-fcUV);
            float fcFade=smoothstep(0.0,0.045,min(fcEdge.x,fcEdge.y));
            fcShadow*=mix(1.0,fcFade,fcGroundGrassShadowEdgeFade);
            fcShadow*=1.0-clamp(fcShoreMask.x,0.0,1.0)*.98;
            for(int i=0;i<24;++i){
              vec4 area=fcGroundGrassClearings[i];
              if(area.w>0.5)fcShadow*=smoothstep(area.z-.16,area.z+.16,
                distance(fcGroundPosition,area.xy));
            }
            diffuseColor.rgb*=1.0-fcGroundGrassShadowIntensity*fcShadow;
          }
        }`);
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
