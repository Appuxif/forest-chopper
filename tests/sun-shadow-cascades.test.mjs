import test from 'node:test';
import assert from 'node:assert/strict';
import {
 cascadeShadowConfig,cascadeShadowCoverage,cascadeTexelCenter,installSunShadowCascades,
 SUN_CASCADE_NEAR_DEFAULT,SUN_CASCADE_NEAR_MAP_DEFAULT,
} from '../src/sun-shadow-cascades.js';

test('two shadow layers have independent ranges, sizes and blend',()=>{
 const base=cascadeShadowConfig({quality:'balanced',shadowDistance:150});
 assert.deepEqual(base,{near:30,far:150,nearSize:2048,farSize:1024,blend:4,overlap:12,nearSoftness:1,farSoftness:1.5});
 assert.equal(SUN_CASCADE_NEAR_DEFAULT,30);
 assert.equal(SUN_CASCADE_NEAR_MAP_DEFAULT,2048);
 assert.deepEqual(cascadeShadowConfig({
  quality:'high',shadowDistance:100,shadowMapSize:512,
  sunNearShadowDistance:45,sunNearShadowMapSize:4096,
  sunCascadeBlendDistance:8,
 }),{near:45,far:100,nearSize:4096,farSize:512,blend:8,overlap:12,nearSoftness:1,farSoftness:1.5});
 assert.deepEqual(cascadeShadowConfig({quality:'low',shadowDistance:20,
  sunNearShadowDistance:60}),{near:50,far:60,nearSize:2048,farSize:512,blend:4,overlap:12,nearSoftness:1,farSoftness:1.5});
 assert.equal(cascadeShadowConfig({quality:'high'}).farSize,2048);
});

test('static shadow centre snaps to texel grid in light space',()=>{
 const length=Math.hypot(.4,.85,.35);
 const direction={x:.4/length,y:.85/length,z:.35/length};
 const a=cascadeTexelCenter(24.4,36.7,direction,72,2048);
 const b=cascadeTexelCenter(24.4001,36.7001,direction,72,2048);
 const planar=Math.hypot(direction.x,direction.z);
 const rx=direction.z/planar,rz=-direction.x/planar;
 const ux=-direction.y*direction.x/planar;
 const uz=-direction.y*direction.z/planar;
 for(const projection of [v=>v.x*rx+v.z*rz,v=>v.x*ux+v.y*planar+v.z*uz]){
  assert.ok(Math.abs(projection(a)-projection(b))<1e-8,
   'sub-pixel movement does not shift the directional shadow texture');
 }
 assert.deepEqual(cascadeTexelCenter(3,4,{x:0,y:1,z:0},60,1024),{x:3,y:0,z:4});
});

test('directional-light shader gates far/near contributions without doubling brightness',()=>{
 const shader='#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )\nDirectionalLight directionalLight;\ngetDirectionalLightInfo( directionalLight, directLight );\nRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n#endif';
 const mock={ShaderChunk:{lights_fragment_begin:shader,lights_pars_begin:'// lights'},
  ShaderLib:{lambert:{uniforms:{}},standard:{uniforms:{}},physical:{uniforms:{}}}};
 const installed=installSunShadowCascades(mock);
 assert.ok(mock.ShaderChunk.lights_fragment_begin.includes('sunCascadeNear'));
 assert.ok(mock.ShaderChunk.lights_fragment_begin.includes('UNROLLED_LOOP_INDEX == 0'));
 assert.ok(mock.ShaderChunk.lights_fragment_begin.includes('UNROLLED_LOOP_INDEX == 1'));
 assert.ok(mock.ShaderChunk.lights_fragment_begin.includes('1.0 - forestCascadeFactor'));
 assert.equal(mock.ShaderChunk.lights_pars_begin.includes('uniform float sunCascadeBlend'),true);
 installed.setRange(25,6);
 assert.equal(mock.ShaderLib.lambert.uniforms.sunCascadeNear.value,25);
 assert.equal(mock.ShaderLib.standard.uniforms.sunCascadeBlend.value,6);
 assert.equal(mock.ShaderLib.physical.uniforms.sunCascadeNear,
   mock.ShaderLib.lambert.uniforms.sunCascadeNear,'material shaders share live uniforms');
 assert.equal(installSunShadowCascades(mock),installed,'global shader patched only once');
});

test('far sun cascade accepts 350m and preserves independent near map settings',()=>{
 const full=cascadeShadowConfig({
  shadowDistance:350,shadowMapSize:512,
  shadowRefreshSeconds:20,sunNearShadowDistance:30,
  sunNearShadowMapSize:4096,
 });
 assert.equal(full.far,350);
 assert.equal(full.farSize,512);
 assert.equal(full.near,30);
 assert.equal(full.nearSize,4096);
 assert.equal('nearRefresh' in full,false,'near cascade is always live');
 assert.equal(cascadeShadowConfig({shadowDistance:500}).far,350);
 assert.equal(cascadeShadowConfig({shadowDistance:40}).far,60);
});


test('fade and caster overlap are independent, including user case 10/10/60',()=>{
 const cfg=cascadeShadowConfig({
  sunNearShadowDistance:10,sunCascadeBlendDistance:10,
  sunCascadeCasterOverlap:12,shadowDistance:60,
 });
 const coverage=cascadeShadowCoverage(cfg);
 assert.deepEqual(coverage,{fadeStart:5,fadeEnd:15,nearExtent:33,farCasterStart:0});
 assert.ok(coverage.nearExtent>coverage.fadeEnd,'near shadow frustum covers the whole fade');
 assert.equal(coverage.farCasterStart,0,'far map retains inner casters at short near radii');
 const without=cascadeShadowCoverage(cascadeShadowConfig({
  sunNearShadowDistance:30,sunCascadeBlendDistance:10,
  sunCascadeCasterOverlap:0,shadowDistance:150,
 }));
 const withOverlap=cascadeShadowCoverage(cascadeShadowConfig({
  sunNearShadowDistance:30,sunCascadeBlendDistance:10,
  sunCascadeCasterOverlap:30,shadowDistance:150,
 }));
 assert.ok(withOverlap.nearExtent>without.nearExtent);
 assert.ok(withOverlap.farCasterStart<without.farCasterStart);
 assert.equal(cascadeShadowConfig({sunCascadeCasterOverlap:100}).overlap,40);
 assert.equal(cascadeShadowConfig({sunNearShadowSoftness:0}).nearSoftness,0);
 assert.equal(cascadeShadowConfig({sunFarShadowSoftness:0}).farSoftness,0);
 assert.equal(cascadeShadowConfig({sunNearShadowSoftness:4,
  sunFarShadowSoftness:3}).nearSoftness,4);
 assert.equal(cascadeShadowConfig({sunNearShadowSoftness:4,
  sunFarShadowSoftness:3}).farSoftness,3);
});

test('PCFSoft shader patch respects shadow.radius while keeping the same lookup count',()=>{
 const pcf="#if defined( SHADOWMAP_TYPE_PCF )\nvec2 other = vec2( 1.0 );\n#elif defined( SHADOWMAP_TYPE_PCF_SOFT )\nvec2 texelSize = vec2( 1.0 ) / shadowMapSize;\nfloat dx = texelSize.x;\nfloat dy = texelSize.y;\nshadow = texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx, dy ), shadowCoord.z );\n#elif defined( SHADOWMAP_TYPE_VSM )\nshadow = 1.0;\n#endif";
 const light="getDirectionalLightInfo( directionalLight, directLight );\nRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";
 const mock={ShaderChunk:{lights_fragment_begin:light,lights_pars_begin:'// lights',
  shadowmap_pars_fragment:pcf},ShaderLib:{standard:{uniforms:{}}}};
 const patched=installSunShadowCascades(mock);
 assert.equal(mock.ShaderChunk.shadowmap_pars_fragment.includes('float dx = texelSize.x * shadowRadius;'),true);
 assert.equal(mock.ShaderChunk.shadowmap_pars_fragment.includes('float dy = texelSize.y * shadowRadius;'),true);
 assert.equal((mock.ShaderChunk.shadowmap_pars_fragment.match(/texture2DCompare/g)??[]).length,1);
 assert.equal(installSunShadowCascades(mock),patched,'no double shader patch');
});
