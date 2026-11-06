// Shared material palette: GPU micrograss and collectible decorative tufts.
// Both sides of each classic grass ribbon must receive identical, muted
// green lighting. Lambert's DoubleSide normally flips normals on backfaces,
// making one side sunlit and the other nearly black. A shared world-up
// view-space normal keeps lighting identical from either camera side while
// preserving sunlight, shadows and the old green vertex/tint palette.
// Patch the common legacy material so standalone blades and clumps match.
export function applyClassicGrassTwoSidedLighting(shader) {
  if(typeof shader.fragmentShader!=='string')return;
  shader.fragmentShader=shader.fragmentShader.replace(
    '#include <normal_fragment_begin>',
    `#include <normal_fragment_begin>
    // View-space world-up normal, independent of gl_FrontFacing and blade yaw.
    // Never use abs(view-space normals): it changes with camera rotation.
    normal = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));`
  ).replace(
    '#include <lights_fragment_end>',
    `#include <lights_fragment_end>
    // Opaque deep-green foliage: prevent sun-facing ribbons turning lime.
    reflectedLight.directDiffuse *= 0.38;
    reflectedLight.indirectDiffuse *= 0.68;`
  );
}

// Optional deterministic palette. Hashing the instance's world position
// and blade slot gives each individual tuft blade a stable independent color,
// even when several blades share one InstancedMesh instance.
export function applyGrassRandomPalette(shader,uniforms) {
  shader.uniforms.fcGrassRandomColors=uniforms.fcGrassRandomColors;
  shader.uniforms.fcGrassYellowShare=uniforms.fcGrassYellowShare;
  shader.vertexShader=shader.vertexShader.replace('#include <common>',
    `#include <common>
    attribute float fcGrassBladeIndex;
    uniform float fcGrassRandomColors;
    uniform float fcGrassYellowShare;`
  ).replace('#include <color_vertex>',
    `#include <color_vertex>
    #ifdef USE_COLOR
    if(fcGrassRandomColors>0.5){
      // Stable world positions for both instanced decor and lone-item icons.
      vec2 fcPalettePosition;
      #ifdef USE_INSTANCING
        fcPalettePosition=instanceMatrix[3].xz;
      #else
        fcPalettePosition=modelMatrix[3].xz;
      #endif
      float fcPaletteSeed=fract(sin(
        dot(fcPalettePosition,vec2(12.9898,78.233))+
        fcGrassBladeIndex*19.19)*43758.5453);
      float fcFamily=fract(fcPaletteSeed*19.13+0.37);
      float fcShade=fract(fcPaletteSeed*37.79+0.11);
      // The fraction is adjustable at runtime, without tile rebuilding.
      vec3 fcGreen=mix(vec3(.045,.18,.035),
        vec3(.42,.65,.22),fcShade);
      vec3 fcDry=mix(vec3(.24,.115,.035),
        vec3(.84,.73,.32),fcShade);
      vec3 fcPalette=mix(fcGreen,fcDry,step(1.0-fcGrassYellowShare,fcFamily));
      // Preserve the original dark-root gradient in either palette.
      float fcRootDim=mix(.60,1.0,smoothstep(.01,.20,position.y));
      vColor.rgb=fcPalette*fcRootDim;
    }
    #endif`
  );
}



// Optional foliage lighting shared by GPU micrograss and collectible shrubs.
// All switches and strength settings are uniforms: toggling them never
// rebuilds a grass page or compiles a second shader/material variant.
// Procedural normals approximate curved blades from the original smooth
// vertex normals, but use the same normal on front/back faces.
export function makeGrassFoliageUniforms(){
  return {
    fcGrassFxNormals:{value:0},
    fcGrassFxTranslucency:{value:0},
    fcGrassFxAO:{value:0},
    fcGrassFxTranslucencyIntensity:{value:.075},
    fcGrassFxAOIntensity:{value:1},
    fcGrassFxSunDirection:{value:{x:.38,y:.89,z:.27}},
    fcGrassFxSunIntensity:{value:1},
  };
}
export function updateGrassFoliageUniforms(u,settings={},sun=null){
  u.fcGrassFxNormals.value=settings?.grassClusterProceduralNormals
    ?Math.max(0,Math.min(1,settings?.grassClusterNormalsIntensity??1)):0;
  u.fcGrassFxTranslucency.value=settings?.grassClusterTranslucency?1:0;
  u.fcGrassFxAO.value=settings?.grassClusterAO?1:0;
  u.fcGrassFxTranslucencyIntensity.value=
    Math.max(0,Math.min(1.5,settings?.grassClusterTranslucencyIntensity??.075));
  u.fcGrassFxAOIntensity.value=
    Math.max(0,Math.min(1,settings?.grassClusterAOIntensity??1));
  if(sun?.position){
    // DirectionalLight position follows the camera in the CSM setup.
    // The actual light direction is from target to the light, not from
    // world origin to sun.position (which changes while walking).
    const x=sun.position.x-(sun.target?.position?.x??0);
    const y=sun.position.y-(sun.target?.position?.y??0);
    const z=sun.position.z-(sun.target?.position?.z??0);
    const len=Math.hypot(x,y,z)||1;
    Object.assign(u.fcGrassFxSunDirection.value,{x:x/len,y:y/len,z:z/len});
    u.fcGrassFxSunIntensity.value=
      Math.max(0,Math.min(1,(sun.intensity??2)/2));
  }else u.fcGrassFxSunIntensity.value=1;
}

export function applyGrassFoliageEffects(shader,u){
  Object.assign(shader.uniforms,u);
  shader.vertexShader=shader.vertexShader.replace('#include <common>',
    `#include <common>
varying float vFcGrassRootExposure;`
  ).replace('#include <color_vertex>',
    `#include <color_vertex>
vFcGrassRootExposure=smoothstep(.02,.28,position.y);`
  );
  if(typeof shader.fragmentShader!=='string')return;
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
    `#include <common>
uniform float fcGrassFxNormals;
uniform float fcGrassFxTranslucency;
uniform float fcGrassFxAO;
uniform float fcGrassFxTranslucencyIntensity;
uniform float fcGrassFxAOIntensity;
uniform float fcGrassFxSunIntensity;
uniform vec3 fcGrassFxSunDirection;
varying float vFcGrassRootExposure;`
  ).replace(
    // Reuse the symmetrical normal already installed by the classic grass
    // shader, rather than restoring DoubleSide front/back flipping.
    'normal = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));',
    `normal = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
if(fcGrassFxNormals>0.0){
  // The old sign(dot(vNormal, up)) branch was unstable for nearly
  // vertical ribbons: dot ~= 0, and camera-space rounding could
  // abruptly flip the lateral normal while rotating the camera.
  // Keep the lateral component continuous in view space and bias it
  // towards world-up for the same lighting on front/back faces.
  vec3 fcSmooth=normalize(vNormal);
  vec3 fcLateral=fcSmooth-normal*dot(fcSmooth,normal);
  vec3 fcProceduralNormal=normalize(normal*.94+fcLateral*.55);
  normal=normalize(mix(normal,fcProceduralNormal,fcGrassFxNormals));
}`
  ).replace('#include <color_fragment>',
    `#include <color_fragment>
if(fcGrassFxAO>.5){
  float fcRootAO=(1.0-vFcGrassRootExposure);
  diffuseColor.rgb*=1.0-.40*fcGrassFxAOIntensity*fcRootAO*fcRootAO;
}`
  );
  // Visible yellow-green transmitted light when the sun is BEHIND grass.
  // Project both vectors on the ground plane: high-noon sun otherwise
  // nearly kills the effect when the player looks horizontally.
  const output=shader.fragmentShader.includes('#include <opaque_fragment>')
    ?'#include <opaque_fragment>':'#include <output_fragment>';
  shader.fragmentShader=shader.fragmentShader.replace(output,
    `if(fcGrassFxTranslucency>.5){
  vec3 fcUpView=normalize(mat3(viewMatrix)*vec3(0.0,1.0,0.0));
  vec3 fcSunView=normalize(mat3(viewMatrix)*fcGrassFxSunDirection);
  vec3 fcToBlade=-normalize(vViewPosition);
  vec3 fcSunHorizontal=fcSunView-fcUpView*dot(fcSunView,fcUpView);
  vec3 fcViewHorizontal=fcToBlade-fcUpView*dot(fcToBlade,fcUpView);
  float fcAzimuth=dot(fcSunHorizontal,fcViewHorizontal)/
    max(length(fcSunHorizontal)*length(fcViewHorizontal),0.001);
  float fcBacklight=smoothstep(0.10,0.92,fcAzimuth);
  float fcTransmission=fcBacklight*
    (0.35+0.65*vFcGrassRootExposure)*fcGrassFxSunIntensity*
    fcGrassFxTranslucencyIntensity;
  // Subtle at default strength, clearly noticeable when facing the sun.
  outgoingLight+=diffuseColor.rgb*vec3(0.52,1.25,0.38)*
    (fcTransmission*1.08);
}
`+output
  );
}
