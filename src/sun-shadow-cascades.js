// Two-range directional shadows without two overlapping sun contributions.
// Cascades share light direction/color/intensity; the fragment shader selects
// the tighter map within nearDistance and the wider map further away.
// Each map includes all relevant geometry, including characters.
// All built-in lit materials receive the same uniforms through ShaderLib.
export const SUN_CASCADE_NEAR_DEFAULT=30;
export const SUN_CASCADE_NEAR_MAP_DEFAULT=2048;
export const SUN_CASCADE_BLEND_DEFAULT=4;
export const SUN_CASCADE_OVERLAP_DEFAULT=12;
export const SUN_NEAR_SHADOW_SOFTNESS_DEFAULT=1;
export const SUN_FAR_SHADOW_SOFTNESS_DEFAULT=1.5;

// Independent caster overlap and camera guard band. Blending light intensity
// does not magically populate a missing shadow map. Both frustums must contain
// the geometry that can cast across the fade region and into the opposite zone.
export function cascadeShadowCoverage({near,far,blend,overlap}){
 const halfFade=blend*.5;
 return {
  fadeStart:Math.max(0,near-halfFade),
  fadeEnd:near+halfFade,
  // Extra six metres keep canopy/built objects from clipping at the boundary.
  nearExtent:Math.min(far+12,near+halfFade+overlap+6),
  // Long projected shadows need their near casters in the far map too.
  farCasterStart:Math.max(0,near-halfFade-overlap-16),
 };
}

export function cascadeShadowConfig(settings={}){
 const near=Math.max(10,Math.min(60,settings.sunNearShadowDistance??SUN_CASCADE_NEAR_DEFAULT));
 const far=Math.max(60,Math.min(350,settings.shadowDistance??150));
 const nearSize=[1024,2048,4096].includes(settings.sunNearShadowMapSize)
  ?settings.sunNearShadowMapSize:SUN_CASCADE_NEAR_MAP_DEFAULT;
 const farDefault=({low:512,balanced:1024,high:2048})[settings.quality]??1024;
 const farSize=[512,1024,2048,4096].includes(settings.shadowMapSize)
  ?settings.shadowMapSize:farDefault;
 const blend=Math.max(0,Math.min(10,settings.sunCascadeBlendDistance??SUN_CASCADE_BLEND_DEFAULT));
 const overlap=Math.max(0,Math.min(40,settings.sunCascadeCasterOverlap??SUN_CASCADE_OVERLAP_DEFAULT));
 const nearSoftness=Math.max(0,Math.min(4,settings.sunNearShadowSoftness??SUN_NEAR_SHADOW_SOFTNESS_DEFAULT));
 const farSoftness=Math.max(0,Math.min(4,settings.sunFarShadowSoftness??SUN_FAR_SHADOW_SOFTNESS_DEFAULT));
 return {near:Math.min(near,Math.max(10,far-10)),far,nearSize,farSize,blend,
  overlap,nearSoftness,farSoftness};
}
export function cascadeTexelCenter(x,z,direction,span,resolution){
 const planar=Math.hypot(direction.x,direction.z);
 const texel=span/Math.max(1,resolution);
 if(planar<1e-6||!Number.isFinite(texel)||texel<=0)return {x,y:0,z};
 const rx=direction.z/planar,rz=-direction.x/planar;
 const ux=-direction.y*direction.x/planar,uy=planar,uz=-direction.y*direction.z/planar;
 const right=x*rx+z*rz, up=x*ux+z*uz;
 const dx=Math.round(right/texel)*texel-right;
 const dy=Math.round(up/texel)*texel-up;
 return {x:x+rx*dx+ux*dy,y:uy*dy,z:z+rz*dx+uz*dy};
}

export function installSunShadowCascades(THREE){
 const chunk=THREE.ShaderChunk;
 if(chunk.__forestSunCascades)return chunk.__forestSunCascades;
 // r170's built-in PCFSoftShadowMap ignores LightShadow.radius for the
 // 2D directional/spot shadow sampler. Scale its existing filter offsets by
 // shadowRadius, preserving the number of PCF taps and the original 1.0
 // behaviour. Point-light cube shadow sampling already uses shadowRadius.
 if(typeof chunk.shadowmap_pars_fragment==='string'){
  const shader=chunk.shadowmap_pars_fragment;
  const branch=shader.indexOf('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )');
  const end=shader.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )',branch);
  if(branch<0||end<branch)throw new Error('Three.js PCFSoft shader format changed');
  const before=shader.slice(0,branch),soft=shader.slice(branch,end),after=shader.slice(end);
  const offset=/float dx = texelSize\.x;\s*float dy = texelSize\.y;/;
  if(!offset.test(soft))throw new Error('Three.js PCFSoft texel offsets changed');
  chunk.shadowmap_pars_fragment=before+soft.replace(offset,
   'float dx = texelSize.x * shadowRadius;\n\t\t\tfloat dy = texelSize.y * shadowRadius;')+after;
 }
 const begin=chunk.lights_fragment_begin;
 const start=begin.indexOf('getDirectionalLightInfo( directionalLight, directLight );');
 if(start<0)throw new Error('Three.js directional lighting shader changed');
 const at=begin.indexOf('RE_Direct( directLight,',start);
 if(at<0)throw new Error('Three.js direct lighting shader changed');
 // The renderer orders two directional lights: index 0 is far, 1 near.
 // Fade the *light contribution* rather than overlapping two shadow samples.
 // vViewPosition is in camera space, so its length is in world metres.
 // A local block is essential: three.js unrolls the directional-light loop,
 // so a variable without block scope would be redeclared for every light.
 const gate=`{
    float forestCascadeFactor = smoothstep(
      max(0.0,sunCascadeNear - max(0.001,sunCascadeBlend) * 0.5),
      sunCascadeNear + max(0.001,sunCascadeBlend) * 0.5,
      length(vViewPosition));
    #if ( UNROLLED_LOOP_INDEX == 0 )
      directLight.color *= forestCascadeFactor;
    #elif ( UNROLLED_LOOP_INDEX == 1 )
      directLight.color *= (1.0 - forestCascadeFactor);
    #endif
  }
  `;
 chunk.lights_fragment_begin=begin.slice(0,at)+gate+begin.slice(at);
 chunk.lights_pars_begin='uniform float sunCascadeNear;\nuniform float sunCascadeBlend;\n'+chunk.lights_pars_begin;
 const nearUniform={value:SUN_CASCADE_NEAR_DEFAULT};
 const blendUniform={value:SUN_CASCADE_BLEND_DEFAULT};
 for(const key of ['lambert','phong','standard','physical','toon']){
  if(!THREE.ShaderLib?.[key]?.uniforms)continue;
  THREE.ShaderLib[key].uniforms.sunCascadeNear=nearUniform;
  THREE.ShaderLib[key].uniforms.sunCascadeBlend=blendUniform;
 }
 const api={
  setRange(near,blend){nearUniform.value=near;blendUniform.value=blend;},
  get near(){return nearUniform.value;},
  get blend(){return blendUniform.value;},
 };
 chunk.__forestSunCascades=api;
 return api;
}
