// The same GPU displacement is applied to bark, branches and foliage.
// Only instanced render meshes use this shader; fallen tree originals stay rigid.
const WIND_VERTEX = [
  '#ifdef USE_INSTANCING',
  '  vec2 fcOrigin = instanceMatrix[3].xz;',
  '  float fcDist = length(fcOrigin - fcWindCenter);',
  '  float fcFade = 1.0 - smoothstep(23.0, 32.0, fcDist);',
  '  float fcHeight = clamp(transformed.y / FC_WIND_HEIGHT, 0.0, 1.0);',
  '  float fcCurve = fcHeight * fcHeight;',
  '  float fcPhase = dot(fcOrigin, vec2(0.17, 0.11));',
  '  float fcWave = sin(fcWindTime * 0.75 + fcPhase)',
  '    + 0.24 * sin(fcWindTime * 1.24 + fcPhase * 0.6);',
  '  float fcOffset = fcWindStrength * fcFade * fcCurve * fcWave;',
  '  transformed.x += fcOffset * 0.24;',
  '  transformed.z += fcOffset * 0.09;',
  '#endif',
].join('\n');

export function createTreeWindShader({motionQuery}={}) {
  const uniforms={
    fcWindTime:{value:0},fcWindStrength:{value:1},
    fcWindCenter:{value:{x:0,y:0}},
  };
  function decorate(material,baseHeight){
    const previous=material.onBeforeCompile?.bind(material);
    material.onBeforeCompile=shader=>{
      previous?.(shader);
      Object.assign(shader.uniforms,uniforms);
      shader.vertexShader=shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\nuniform float fcWindTime;\nuniform float fcWindStrength;\nuniform vec2 fcWindCenter;\n#define FC_WIND_HEIGHT '+baseHeight.toFixed(2)
      ).replace('#include <begin_vertex>','#include <begin_vertex>\n'+WIND_VERTEX);
    };
    material.customProgramCacheKey=()=> 'fc-tree-wind-v1:'+baseHeight;
    material.userData??={};
    material.userData.fcWindHeight=baseHeight;
    material.needsUpdate=true;
    return material;
  }
  function tick(now,x,z,enabled=true){
    uniforms.fcWindTime.value=now*.001;
    uniforms.fcWindCenter.value.x=x;
    uniforms.fcWindCenter.value.y=z;
    uniforms.fcWindStrength.value=(enabled&&!motionQuery?.matches)?1:0;
  }
  return {uniforms,decorate,tick};
}
