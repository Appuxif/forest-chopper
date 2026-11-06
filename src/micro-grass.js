// Low-poly, static grass carpet: cached instanced tiles with two distance LODs.
import {gladesForTile,gladeAtPoint,gladeDensity} from './grass-glades.js?v=20261031-ponds1';
import {lakesNearTile,lakeNormalized} from './lakes.js';
import {WorldLRU,WORLD_PRIORITY} from './world-task-scheduler.js';
import {generateClusteredGrassTile,GRASS_CLUSTER_DEFAULTS as CLUSTER_DEFAULT_KEYS} from './grass-clustering.js';
import {makeClassicGrassClumpGeometry} from './classic-grass-clump-geometry.js';
import {applyClassicGrassTwoSidedLighting,applyGrassRandomPalette,makeGrassFoliageUniforms,updateGrassFoliageUniforms,applyGrassFoliageEffects} from './grass-palette.js?v=20261106-stable-procedural-normals1';
import {grassDistanceDensity} from './grass-density-lod.js';
import {createGrassBakedAOAtlas} from './grass-baked-ao.js?v=20261106-classic-grass-only1';
export {grassDistanceDensity} from './grass-density-lod.js';
// One shared geometry/material per LOD, no individual scene objects per tuft,
// and no full-ring matrix uploads whenever the player walks a meter.
export const MICRO_GRASS_CELL = 1.1;
export const MICRO_GRASS_RADIUS = 26;
export const MICRO_GRASS_PER_CELL = 9;
export const MICRO_GRASS_MAX_RADIUS = 100;
export const MICRO_GRASS_NIGHT_RADIUS = 30;
// Blend the night cap smoothly across dusk/dawn. Quantization prevents
// thousands of near-identical streaming radii during a lighting transition.
export function effectiveGrassRadius(dayRadius,nightBlend=0){
  const day=Math.max(12,Math.min(MICRO_GRASS_MAX_RADIUS,dayRadius));
  const t=Math.max(0,Math.min(1,nightBlend));
  return Math.round(day+(Math.min(day,MICRO_GRASS_NIGHT_RADIUS)-day)*t);
}

export const MICRO_GRASS_MAX_DENSITY = 50;
const NEAR_TILE = 12;
const FAR_TILE = 24;
const NEAR_END = 26;
// Stable instance priorities and a smooth per-blade distance profile; the CPU
// still skips distant instances using conservative page-level bounds.
const FAR_DENSITY_MIN = .38;
const GRASS_CULL_MARGIN = 2.5;
const GRASS_DENSITY_BLEND = .045;
const REBUILD_DISTANCE = 4;
const MAX_UNUSED_TILES = 8;
const GRASS_ACTOR_SLOTS = 6; // local player, two fading footprints, three nearby guests
const GRASS_TRAIL_LIFETIME = 450; // milliseconds; grass springs back after passage
const GRASS_INTERACTION_RADIUS = 1.05;
const GRASS_CLEARING_SLOTS = 24; // nearest campfires, signs, benches and logs

// Stable integer hash, independent of generated world chunks and player movement.
function hash(seed, x, z, channel) {
  let n = (seed | 0) ^ Math.imul(x, 0x1b873593) ^
    Math.imul(z, 0x85ebca6b) ^ Math.imul(channel + 1, 0xc2b2ae35);
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const smooth = x => x*x*(3-2*x);
function field(seed, x, z) {
  // Smooth, world-space density variation on a 14 m scale, never cell squares.
  const px = x/14, pz = z/14, ax = Math.floor(px), az = Math.floor(pz);
  const u = smooth(px-ax), v = smooth(pz-az);
  const a = hash(seed,ax,az,91), b = hash(seed,ax+1,az,91);
  const c = hash(seed,ax,az+1,91), d = hash(seed,ax+1,az+1,91);
  return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;
}

// Progressive low-discrepancy positions fill each cached tile evenly, without
// repeating the small 1.1 m placement grid. This is a cheap blue-noise-like
// approximation, not an expensive runtime Poisson-disc solver.
export function generateGrassTile(seed, tileX, tileZ, tileSize, density, tier, clusterConfig=CLUSTER_DEFAULT_KEYS) {
  const x0 = tileX * tileSize, z0 = tileZ * tileSize;
  clusterConfig??=CLUSTER_DEFAULT_KEYS;
  // Glades replace local grass density (including when the player's slider
  // is low), so generate enough candidates for the densest overlapping glade.
  const glades=gladesForTile(seed,x0,z0,tileSize);
  const nearbyLakes=lakesNearTile(seed,x0,z0,tileSize);
  const patchState={kind:0,weight:0};
    const densityConfig={...clusterConfig,
      // Legacy density slider stays meaningful with geometric clumps.
      // 30 is its original reference point (100% of the authored density).
      grassClusterDensity:clusterConfig.grassClusterDensity*density/30};
    const grouped=generateClusteredGrassTile(seed,tileX,tileZ,tileSize,densityConfig,(x,z)=>{
      if(Math.abs(z)<1.75)return false;
      gladeAtPoint(x,z,glades,patchState);
      if(patchState.kind===5&&patchState.weight>.15)return false;
      if(nearbyLakes.some(lake=>{
        const u=lakeNormalized(lake,x,z);return u!==null&&u<.97;
      }))return false;
      const local=gladeDensity(patchState.kind);
      if(local!==null){
        const factor=1+(local-density)*(patchState.weight/Math.max(density,1));
        if(hash(seed,Math.floor(x*100),Math.floor(z*100),850)>=
          Math.max(0,Math.min(1,factor)))return false;
      }
      return {patchKind:patchState.kind,patchWeight:patchState.weight};
    },tier);
    // Keep the original biomes/colors in the classic ribbon material.
    for(const tuft of grouped)tuft.biome=field(seed,tuft.x,tuft.z);
    return grouped;
}

// One instanced classic-ribbon material for every graphics preset.
function makeMaterial(THREE, player, near, simple=false) {
  // Preserve the original Lambert palette, LOD and actor interaction.
  const uniforms={
    fcGrassPlayer:{value:player},
    fcGrassFade:{value:new THREE.Vector4(-2,-1,19,26)},
    fcGrassSizeRange:{value:new THREE.Vector2(1,7)},
    fcGrassWidth:{value:1},
    fcGrassRandomColors:{value:0},
    fcGrassYellowShare:{value:.05},
    ...makeGrassFoliageUniforms(),
    fcGrassWindTime:{value:0},
    fcGrassWindSpeed:{value:0},
    fcGrassDensityLod:{value:new THREE.Vector4(NEAR_END,50,.30,.005)},
    fcGrassDensityShape:{value:new THREE.Vector2(.25,1)},
    fcGrassMinDensity:{value:FAR_DENSITY_MIN},
    fcGrassTurnRange:{value:new THREE.Vector2(-Math.PI/6,Math.PI/6)},
    fcGrassClearings:{value:Array.from({length:GRASS_CLEARING_SLOTS},
      ()=>new THREE.Vector4(0,0,0,0))},
    ...(near ? {fcGrassActors:{value:Array.from({length:GRASS_ACTOR_SLOTS},
      ()=>new THREE.Vector4(0,0,0,0))}} : {}),
  };
  const material=new THREE.MeshLambertMaterial({
    color:0xffffff,vertexColors:true,side:THREE.DoubleSide,depthWrite:true,
  });
  material.customProgramCacheKey=()=>`grass-classic-${near?'near':'far'}-${simple?'simple':'full'}-wind-foliage-v5`;
  if(simple){
    // Lightweight shader for low-end devices: only width correction.
    // No actor, clearing, biome or glade loops from the full shader.
    material.onBeforeCompile=shader=>{
      shader.uniforms.fcGrassPlayer=uniforms.fcGrassPlayer;
      shader.uniforms.fcGrassWidth=uniforms.fcGrassWidth;
      shader.uniforms.fcGrassWindTime=uniforms.fcGrassWindTime;
      shader.uniforms.fcGrassWindSpeed=uniforms.fcGrassWindSpeed;
      shader.uniforms.fcGrassDensityLod=uniforms.fcGrassDensityLod;
      shader.uniforms.fcGrassDensityShape=uniforms.fcGrassDensityShape;
      shader.uniforms.fcGrassMinDensity=uniforms.fcGrassMinDensity;
      shader.uniforms.fcGrassTurnRange=uniforms.fcGrassTurnRange;
      shader.vertexShader=shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
uniform vec2 fcGrassPlayer;
uniform float fcGrassWidth;
uniform float fcGrassWindTime;
uniform float fcGrassWindSpeed;
uniform vec4 fcGrassDensityLod;
uniform vec2 fcGrassDensityShape;
uniform float fcGrassMinDensity;
attribute float fcGrassCenterX;
attribute float fcGrassCenterZ;
attribute float fcGrassPriority;
uniform vec2 fcGrassTurnRange;`,
      ).replace('#include <begin_vertex>',`#include <begin_vertex>
#ifdef USE_INSTANCING
  float fcDistance = length(instanceMatrix[3].xz - fcGrassPlayer);
  float fcDistanceT = clamp((fcDistance-fcGrassDensityLod.x) /
    max(fcGrassDensityLod.y-fcGrassDensityLod.x,0.001),0.0,1.0);
  float fcNear = fcDistanceT*fcDistanceT*fcDistanceT;
  float fcFar = (fcGrassDensityShape.y-fcDistanceT)*(fcGrassDensityShape.y-fcDistanceT);
  float fcDenominator = fcNear + (fcGrassDensityShape.x+fcGrassDensityLod.w)*fcFar;
  float fcWidthT = fcDenominator > 0.0 ?
    clamp(fcNear / fcDenominator,0.0,1.0) : 0.0;
  float fcWidthLod = 1.0 + fcWidthT * fcGrassDensityLod.z;
  float fcCoverage = mix(1.0,fcGrassMinDensity,fcWidthT);
  float fcBladeFade = smoothstep(fcGrassPriority-0.045,fcGrassPriority,fcCoverage);
  transformed.x = fcGrassCenterX +
    (transformed.x - fcGrassCenterX) * fcGrassWidth * fcWidthLod;
  transformed.z = fcGrassCenterZ +
    (transformed.z - fcGrassCenterZ) * fcGrassWidth * fcWidthLod;
  // Legacy direction spread is shared with the full-quality shader.
  float fcTurnRandom=fract(21.12345*fract(dot(
    instanceMatrix[3].xz,vec2(.1031,.11369)))+
    fcGrassBladeIndex*.61803398875);
  float fcTurn=mix(fcGrassTurnRange.x,fcGrassTurnRange.y,fcTurnRandom);
  float fcCos=cos(fcTurn),fcSin=sin(fcTurn),fcPrevX=transformed.x;
  transformed.x=fcPrevX*fcCos-transformed.z*fcSin;
  transformed.z=fcPrevX*fcSin+transformed.z*fcCos;
  // Classic grass wind: root remains fixed, only tips sway.
  float fcSwayMask=smoothstep(.015,.24,position.y);
  fcSwayMask*=fcSwayMask;
  float fcWindPhase=fcGrassWindTime*(.8+2.0*fcGrassWindSpeed)+
    instanceMatrix[3].x*.31+instanceMatrix[3].z*.19;
  transformed.x+=sin(fcWindPhase)*fcGrassWindSpeed*.035*fcSwayMask;
  transformed.z+=cos(fcWindPhase*.67)*fcGrassWindSpeed*.022*fcSwayMask;
  transformed *= fcBladeFade;
#endif`);
      applyGrassRandomPalette(shader,uniforms);
      applyClassicGrassTwoSidedLighting(shader);
      applyGrassFoliageEffects(shader,uniforms);
    };
    material.userData.grassUniforms=uniforms;
    return material;
  }
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\nuniform vec2 fcGrassPlayer;\nuniform vec4 fcGrassFade;\nuniform vec2 fcGrassSizeRange;\nuniform float fcGrassWidth;\nuniform float fcGrassWindTime;\nuniform float fcGrassWindSpeed;\nuniform vec4 fcGrassDensityLod;\nuniform vec2 fcGrassDensityShape;\nuniform float fcGrassMinDensity;\nuniform vec2 fcGrassTurnRange;\nattribute float fcGrassCenterX;\nattribute float fcGrassCenterZ;\nattribute float fcGrassPriority;\nattribute vec2 fcGrassProfile;\nuniform vec4 fcGrassClearings[24];`
      + (near ? '\nuniform vec4 fcGrassActors[6];' : ''),
    ).replace('#include <color_vertex>', `#include <color_vertex>
    // Old dark-root gradient and lighter distant foliage.
    vColor.rgb *= mix(${near ? '0.53' : '0.68'},1.0,
      smoothstep(0.0,0.21,position.y));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float fcDistance = length(instanceMatrix[3].xz - fcGrassPlayer);
  float fcFadeIn = smoothstep(fcGrassFade.x, fcGrassFade.y, fcDistance);
  float fcFadeOut = 1.0 - smoothstep(fcGrassFade.z, fcGrassFade.w, fcDistance);
  // Cheap spatial hash per instance: random stable size without tile rebuilds.
  float fcRandom = fract(52.9829189 * fract(dot(
    instanceMatrix[3].xz,vec2(0.06711056,0.00583715))));
  float fcSize = mix(fcGrassSizeRange.x,fcGrassSizeRange.y,fcRandom);
  // Distance LOD lowers the actual instance count on the CPU. Widen only
  // the remaining ribbons, never their height; same transition in both tiers.
  float fcDistanceT = clamp((fcDistance-fcGrassDensityLod.x) /
    max(fcGrassDensityLod.y-fcGrassDensityLod.x,0.001),0.0,1.0);
  float fcNear = fcDistanceT*fcDistanceT*fcDistanceT;
  float fcFar = (fcGrassDensityShape.y-fcDistanceT)*(fcGrassDensityShape.y-fcDistanceT);
  float fcDenominator = fcNear + (fcGrassDensityShape.x+fcGrassDensityLod.w)*fcFar;
  float fcDensityT = fcDenominator > 0.0 ?
    clamp(fcNear / fcDenominator,0.0,1.0) : 0.0;
  float fcWidthLod = 1.0 + fcDensityT * fcGrassDensityLod.z;
  float fcCoverage = mix(1.0,fcGrassMinDensity,fcDensityT);
  float fcBladeFade = smoothstep(fcGrassPriority-0.045,fcGrassPriority,fcCoverage);
  transformed.x = fcGrassCenterX + (transformed.x - fcGrassCenterX) * fcGrassWidth * fcWidthLod;
  transformed.z = fcGrassCenterZ + (transformed.z - fcGrassCenterZ) * fcGrassWidth * fcWidthLod;
  float fcTurnRandom = fract(21.12345 * fract(dot(
    instanceMatrix[3].xz,vec2(0.1031,0.11369)))+
    fcGrassBladeIndex*.61803398875);
  float fcTurn = mix(fcGrassTurnRange.x, fcGrassTurnRange.y, fcTurnRandom);
  float fcCos = cos(fcTurn), fcSin = sin(fcTurn);
  float fcOriginalX = transformed.x;
  transformed.x = fcOriginalX * fcCos - transformed.z * fcSin;
  transformed.z = fcOriginalX * fcSin + transformed.z * fcCos;
  // Same gentle shader wind as the lightweight material.
  // Absolute roots stay fixed; no vertex buffer uploads.
  float fcSwayMask=smoothstep(.015,.24,position.y);
  fcSwayMask*=fcSwayMask;
  float fcWindPhase=fcGrassWindTime*(.8+2.0*fcGrassWindSpeed)+
    instanceMatrix[3].x*.31+instanceMatrix[3].z*.19;
  transformed.x+=sin(fcWindPhase)*fcGrassWindSpeed*.035*fcSwayMask;
  transformed.z+=cos(fcWindPhase*.67)*fcGrassWindSpeed*.022*fcSwayMask;
  // Dither whole blades through LOD transitions instead of shrinking them:
  // the expected coverage stays constant instead of creating a thin-grass ring.
  float fcVisibilityRandom = fract(17.2194 * fract(dot(
    instanceMatrix[3].xz,vec2(0.13713,0.1729))));
  float fcVisibility = step(fcVisibilityRandom,clamp(fcFadeIn*fcFadeOut,0.0,1.0));
  // Clear the ground under built objects without regenerating instanced tiles.
  // xy = world-space centre, z = radius, w = enabled.
  for (int j=0; j<24; ++j) {
    vec4 clearing=fcGrassClearings[j];
    if(clearing.w>0.5 && distance(instanceMatrix[3].xz,clearing.xy)<clearing.z){
      fcVisibility=0.0;
    }
  }
  transformed *= fcVisibility * fcSize * fcBladeFade;
  ${near ? `
  // Shader-only interaction: push blade tips away from a nearby character.
  // All instances keep their original bases, without physics or tile rebuilds.
  // Previous positions linger for 450ms at diminishing strength.
  vec2 fcPush = vec2(0.0);
  float fcStrongest = 0.0;
  for (int i = 0; i < 6; ++i) {
    vec4 fcActor = fcGrassActors[i]; // xy = world position, z = radius, w = strength
    if (fcActor.w <= 0.001) continue;
    vec2 fcDelta = instanceMatrix[3].xz - fcActor.xy;
    if (abs(fcDelta.x) >= fcActor.z || abs(fcDelta.y) >= fcActor.z) continue;
    float fcActorDistance = length(fcDelta);
    float fcInfluence = fcActor.w * (1.0 - smoothstep(0.12,fcActor.z,fcActorDistance));
    if (fcInfluence > fcStrongest) {
      fcStrongest = fcInfluence;
      fcPush = fcDelta / max(fcActorDistance,0.001) * fcInfluence * 0.38;
    }
  }
  // Original vertex height gives a cheap bend mask; roots stay planted.
  float fcTip = smoothstep(0.018,0.19,position.y);
  fcTip *= fcTip;
  float fcInstanceScale = max(length(instanceMatrix[0].xyz),0.01);
  transformed.x += dot(fcPush,instanceMatrix[0].xz) /
    (fcInstanceScale * fcInstanceScale) * fcTip;
  transformed.z += dot(fcPush,instanceMatrix[2].xz) /
    (fcInstanceScale * fcInstanceScale) * fcTip;
  transformed.y -= 0.075 * fcStrongest * fcTip / fcInstanceScale;
  ` : ''}
#endif`);
    applyGrassRandomPalette(shader,uniforms);
    applyClassicGrassTwoSidedLighting(shader);
    applyGrassFoliageEffects(shader,uniforms);
  };
  material.userData.grassUniforms=uniforms;
  return material;
}

export function createMicroGrass(ctx) {
  const THREE=ctx.THREE,playerUniform=new THREE.Vector2();
  const getClusterConfig=()=>({...Object.fromEntries(
    Object.keys(CLUSTER_DEFAULT_KEYS).map(key=>
      [key,ctx.settings?.[key]??CLUSTER_DEFAULT_KEYS[key]]))});
  let clusterConfig=getClusterConfig();
  const tileConfigKeys=new Set([
    'grassClusterDensity','grassClusterGapMin','grassClusterGapMax',
    'grassClusterMinHeight','grassClusterMaxHeight','grassClusterCells',
    'grassClusterStrength','grassClusterSoftness','grassClusterMicroGapMin',
    'grassClusterMicroGapMax','grassClusterMicroRadius',
    'grassClusterMicroStrength','grassClusterWindAlignment','grassClusterWindDirection',
  ]);
  const dataSignature=c=>JSON.stringify(c&&Object.entries(c)
    .filter(([key])=>tileConfigKeys.has(key)));
  let clusterSignature=dataSignature(clusterConfig);
  // Built once per camera render. Axis-aligned tile bounds are noticeably
  // tighter than Three.js's enclosing InstancedMesh bounding spheres.
  const cameraFrustum=THREE.Frustum&&THREE.Matrix4?new THREE.Frustum():null;
  const clipMatrix=cameraFrustum?new THREE.Matrix4():null;
  const dummy=new THREE.Object3D(),tint=new THREE.Color();

  const aoAtlas=createGrassBakedAOAtlas(THREE,
    ctx.ground?.material?.userData?.grassDensityUniforms);
  let aoConfigSignature='',aoRevision=0;
  const aoConfig=()=>({
    enabled:ctx.settings?.grassAOEnabled!==false,
    resolution:ctx.settings?.grassAOResolution??128,
    sampling:ctx.settings?.grassAORootSampling??100,
  });
  const aoSignature=()=>JSON.stringify([
    ctx.seed,aoConfig().enabled,aoConfig().resolution,aoConfig().sampling,
    clusterSignature,currentGeometrySignature,lastDensity,
  ]);

  const near={
    tier:'near',size:NEAR_TILE,
    geometry:makeClassicGrassClumpGeometry(THREE,clusterConfig,'near',
      ctx.settings?.grassTriangles??6),
    material:makeMaterial(THREE,playerUniform,true,false),
    active:new Map(),unused:[],
  };
  const far={
    tier:'far',size:FAR_TILE,
    geometry:makeClassicGrassClumpGeometry(THREE,clusterConfig,'far',
      ctx.settings?.grassTriangles??6),
    material:makeMaterial(THREE,playerUniform,false,false),
    active:new Map(),unused:[],
  };
  let lastX=Infinity,lastZ=Infinity,lastSeed=null,lastDensity=null,lastRadius=null;
  const sampleCache=new WorldLRU(20*1024*1024);
  let streamingEpoch=0;
  for(const layer of [near,far]){
    layer.pending=new Set();layer.desired=new Set();
  }
  let currentTriangles=ctx.settings?.grassTriangles??6,currentInteraction=true;
  let currentGeometrySignature='';
  // Only root placement and azimuth change the classic ribbon geometry.
  // Curved-editor tilt/bend/wave controls are intentionally ignored.
  const geometrySignature=()=>JSON.stringify([
    clusterConfig.grassClusterBlades,
    clusterConfig.grassClusterBladeGapMin,clusterConfig.grassClusterBladeGapMax]);
  currentGeometrySignature=geometrySignature();
  let generatedTiles=0,cacheHits=0;
  const grassTrail=[];
  let lastTrailX=ctx.px,lastTrailZ=ctx.pz,lastTrailAt=-Infinity;
  const nearbyGuests=[];
  const clearings=[];
  function updateClearings(x,z){
    clearings.length=0;
    for(const group of ctx.chunks?.values?.()??[])
      for(const area of group.userData?.grassClearings??[])clearings.push(area);
    for(const bench of ctx.crafting?.items?.values?.()??[])
      clearings.push({x:bench.x,z:bench.z,radius:1.55});
    for(const log of ctx.placed??[])
      if(log.level===0||log.height===0)clearings.push({x:log.x,z:log.z,radius:1.15});
    clearings.sort((a,b)=>
      (a.x-x)**2+(a.z-z)**2-(b.x-x)**2-(b.z-z)**2);
    const groundUniforms=ctx.ground?.material?.userData?.grassDensityUniforms;
    if(groundUniforms){
      const slots=groundUniforms.fcGroundGrassClearings.value;
      for(let i=0;i<slots.length;i++){
        const area=clearings[i];
        if(area)slots[i].set(area.x,area.z,area.radius,1);
        else slots[i].w=0;
      }
    }
    for(const layer of [near,far]){
      const slots=layer.material.userData.grassUniforms.fcGrassClearings.value;
      for(let i=0;i<slots.length;i++){
        const area=clearings[i];
        if(area)slots[i].set(area.x,area.z,area.radius,1);
        else slots[i].w=0;
      }
    }
  }
  function updateGrassActors(x,z) {
    // Called every rendered frame, independently of tile generation.
    const now=performance.now();
    // Reset the interaction trail after teleports / connecting to a new world.
    if (Math.hypot(x-lastTrailX,z-lastTrailZ)>5) {
      grassTrail.length=0;
      lastTrailX=x;lastTrailZ=z;
    }
    if (now-lastTrailAt>=85 && Math.hypot(x-lastTrailX,z-lastTrailZ)>.18) {
      grassTrail.unshift({x:lastTrailX,z:lastTrailZ,at:now});
      grassTrail.length=Math.min(2,grassTrail.length);
      lastTrailX=x;lastTrailZ=z;lastTrailAt=now;
    }
    while(grassTrail.length && now-grassTrail[grassTrail.length-1].at>GRASS_TRAIL_LIFETIME)
      grassTrail.pop();

    const actors=near.material.userData.grassUniforms.fcGrassActors.value;
    actors[0].set(x,z,GRASS_INTERACTION_RADIUS,1);
    for(let i=1;i<=2;i++){
      const sample=grassTrail[i-1];
      if(sample){
        const strength=Math.max(0,1-(now-sample.at)/GRASS_TRAIL_LIFETIME);
        actors[i].set(sample.x,sample.z,GRASS_INTERACTION_RADIUS,strength*.72);
      }else actors[i].w=0;
    }
    // Remote players use their interpolated rendered positions, not network targets.
    nearbyGuests.length=0;
    for(const avatar of ctx.avatars.values()){
      const p=avatar.group.position;
      const distanceSq=(p.x-x)**2+(p.z-z)**2;
      if(distanceSq>(NEAR_END+3)**2)continue;
      nearbyGuests.push({x:p.x,z:p.z,distanceSq});
    }
    nearbyGuests.sort((a,b)=>a.distanceSq-b.distanceSq);
    for(let i=0;i<3;i++){
      const guest=nearbyGuests[i],slot=actors[i+3];
      if(guest)slot.set(guest.x,guest.z,GRASS_INTERACTION_RADIUS,1);
      else slot.w=0;
    }
  }
  function disposePage(mesh){
    mesh.geometry.dispose(); // per-page profile buffer and cloned geometry
    mesh.dispose();          // instance buffers; shared material is preserved
  }
  function release(layer,record) {
    ctx.scene.remove(record.mesh);
    if(layer===near)ctx.worldStreamer?.cancel(
      'grassAO:'+record.tileX+','+record.tileZ);
    if(layer.unused.length<MAX_UNUSED_TILES){
      layer.unused.push(record.mesh);
    }else{
      disposePage(record.mesh);
    }
  }
  function createPage(layer,x,z,seed,density,samples=null){
    samples??=generateGrassTile(seed,x,z,layer.size,density,layer.tier,clusterConfig);
    const baked=samples?.samples?samples.ao:null;
    if(samples?.samples)samples=samples.samples;
    const packed=samples instanceof Float32Array;
    const count=packed?samples.length/9:samples.length;
    if(!count)return null;
    let mesh=layer.unused.pop();
    if(mesh && mesh.instanceMatrix.count<count){
      disposePage(mesh);
      mesh=null;
    }
    if(!mesh){
      const capacity=Math.ceil(count*1.08);
      // One draw per tile; the priority is static and sorted once per page.
      const geometry=layer.geometry.clone();
      geometry.setAttribute('fcGrassProfile',
        new THREE.InstancedBufferAttribute(new Float32Array(capacity*2),2));
      geometry.setAttribute('fcGrassPriority',
        new THREE.InstancedBufferAttribute(new Float32Array(capacity),1));
      mesh=new THREE.InstancedMesh(geometry,layer.material,capacity);
    }
    mesh.count=count;
    mesh.receiveShadow=true; // Trees, characters, and fire shade visible grass.
    mesh.visible=true; // A pooled page may have been culled last frame.
    const profile=mesh.geometry.getAttribute('fcGrassProfile');
    const priorities=mesh.geometry.getAttribute('fcGrassPriority');
    // A deterministic, seed-based shuffle: each prefix has a stable, evenly
    // distributed collection of positions instead of a moving random subset.
    const sampleOrder=new Uint32Array(count);
    const sortKeys=new Float64Array(count);
    for(let i=0;i<count;i++){
      sampleOrder[i]=i;
      sortKeys[i]=hash(seed,x,z,i+7391);
    }
    sampleOrder.sort((a,b)=>sortKeys[a]-sortKeys[b]);
    mesh.frustumCulled=true; // Cull entire fixed world-space page.
    mesh.userData.microGrass=true;
    mesh.userData.grassTier=layer.tier;
    let minY=Infinity,maxY=-Infinity;
    for(let i=0;i<count;i++){
      const source=sampleOrder[i],j=source*9;
      const x=packed?samples[j]:samples[source].x;
      const z=packed?samples[j+2]:samples[source].z;
      const y=packed?samples[j+1]:ctx.terrain.heightAt(x,z);
      minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      const angle=packed?samples[j+3]:(samples[source].yaw??samples[source].angle);
      const scale=packed?samples[j+4]:(samples[source].height??samples[source].scale);
      const tintValue=packed?samples[j+5]:samples[source].tint;
      const biome=packed?samples[j+6]:samples[source].biome;
      const patchKind=packed?samples[j+7]:samples[source].patchKind;
      const patchWeight=packed?samples[j+8]:samples[source].patchWeight;
      dummy.position.set(x,y,z);
      dummy.rotation.set(0,angle,0);
      // Original ribbon sizing; the height range controls tuft scale.
      const min=clusterConfig.grassClusterMinHeight;
      const max=clusterConfig.grassClusterMaxHeight;
      const normalized=Math.max(0,Math.min(1,(scale-min)/Math.max(.001,max-min)));
      const average=(min+max)*.5;
      dummy.scale.setScalar((.82+.40*normalized)*(average/.525));
      dummy.updateMatrix();
      mesh.setMatrixAt(i,dummy.matrix);
      profile.setXY(i,patchKind,patchWeight);
      priorities.array[i]=(i+.5)/count;
      // Shared old palette for individual blades AND grouped old blades.
      tint.setHSL(.278+biome*.034,.39+tintValue*.13,
        .355+tintValue*.067);
      mesh.setColorAt(i,tint);
    }
    mesh.instanceMatrix.needsUpdate=true;
    profile.needsUpdate=true;
    priorities.needsUpdate=true;
    if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    mesh.computeBoundingSphere();
    // Leave culling margin for the experimental 8x shader scaling.
    if(mesh.boundingSphere)mesh.boundingSphere.radius += 2;
    // The shader can stretch blades up to 8×. Expand y bounds enough for
    // the tallest setting and interaction bending, without the very large
    // height radius of an enclosing sphere.
    const bounds=THREE.Box3&&THREE.Vector3
      ?new THREE.Box3(new THREE.Vector3(x*layer.size-GRASS_CULL_MARGIN,
        minY-.5,z*layer.size-GRASS_CULL_MARGIN),
        new THREE.Vector3((x+1)*layer.size+GRASS_CULL_MARGIN,
          maxY+3.5,(z+1)*layer.size+GRASS_CULL_MARGIN)):null;
    ctx.scene.add(mesh);
    generatedTiles++;
    const validBake=layer===near&&baked?.configKey===aoConfigSignature;
    if(validBake)aoAtlas?.ready(baked);
    return {mesh,bounds,tileX:x,tileZ:z,tileSize:layer.size,
      fullCount:count,samples:layer===near?samples:null,
      aoSignature:validBake?aoConfigSignature:null};
  }
  function intersects(tileX,tileZ,size,x,z,radius) {
    const a=tileX*size,b=tileZ*size;
    const dx=Math.max(a-x,0,x-a-size),dz=Math.max(b-z,0,z-b-size);
    return dx*dx+dz*dz<radius*radius;
  }
  function syncLayer(layer,x,z,radius,seed,density,refresh){
    const keep=new Set();
    if(radius>0){
      const startX=Math.floor((x-radius)/layer.size);
      const endX=Math.floor((x+radius)/layer.size);
      const startZ=Math.floor((z-radius)/layer.size);
      const endZ=Math.floor((z+radius)/layer.size);
      for(let tx=startX;tx<=endX;tx++)for(let tz=startZ;tz<=endZ;tz++){
        if(intersects(tx,tz,layer.size,x,z,radius))keep.add(tx+','+tz);
      }
    }
    layer.desired=keep;
    for(const [key,record] of layer.active){
      if(!refresh&&keep.has(key))continue;
      release(layer,record);layer.active.delete(key);
    }
    for(const key of [...layer.pending]){
      if(!refresh&&keep.has(key))continue;
      ctx.worldStreamer?.cancel('grass:'+layer.tier+':'+key);
      layer.pending.delete(key);
    }
    const sorted=[...keep].filter(key=>!layer.active.has(key)&&!layer.pending.has(key))
      .map(key=>{
        const [tx,tz]=key.split(',').map(Number);
        return {key,tx,tz,d:Math.hypot((tx+.5)*layer.size-x,
          (tz+.5)*layer.size-z)};
      }).sort((a,b)=>a.d-b.d);
    for(const {key,tx,tz,d} of sorted){
      const cacheKey=[seed,layer.tier,tx,tz,density,clusterSignature].join('/');
      const cached=sampleCache.get(cacheKey);
      if(cached){
        cacheHits++;
        const page=createPage(layer,tx,tz,seed,density,cached);
        if(page)layer.active.set(key,page);
        continue;
      }
      if(!ctx.worldStreamer){
        // The sync fallback should also reuse tile samples on dawn instead
        // of regenerating grass locations after a night-time cull.
        const samples=generateGrassTile(seed,tx,tz,layer.size,density,layer.tier,clusterConfig);
        sampleCache.put(cacheKey,samples,samples.length*80);
        const page=createPage(layer,tx,tz,seed,density,samples);
        if(page)layer.active.set(key,page);
        continue;
      }
      layer.pending.add(key);
      const epoch=streamingEpoch;
      const payload={seed,tx,tz,size:layer.size,density,tier:layer.tier,clusterConfig,
        ao:layer===near?{...aoConfig(),configKey:aoSignature()}:null};
      ctx.worldStreamer.schedule({
        key:'grass:'+layer.tier+':'+key,kind:'grass',payload,
        priority:d<20?WORLD_PRIORITY.near:d<55?WORLD_PRIORITY.visible:WORLD_PRIORITY.background,
        fallback:()=>generateGrassTile(seed,tx,tz,layer.size,density,layer.tier,clusterConfig),
        apply:samples=>{
          layer.pending.delete(key);
          if(epoch!==streamingEpoch||!layer.desired.has(key)||
             layer.active.has(key))return;
          const packedSamples=samples?.samples??samples;
          if(packedSamples instanceof Float32Array)
            sampleCache.put(cacheKey,packedSamples,packedSamples.byteLength);
          const page=createPage(layer,tx,tz,seed,density,samples);
          if(page)layer.active.set(key,page);
        },
      });
    }
  }
  function updateVisibility(){
    const camera=ctx.camera;
    const useFrustum=!!(cameraFrustum&&camera?.projectionMatrix&&camera?.matrixWorldInverse);
    if(useFrustum){
      camera.updateMatrixWorld?.();
      clipMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      cameraFrustum.setFromProjectionMatrix(clipMatrix);
    }
    const radius=lastRadius??MICRO_GRASS_RADIUS;
    // Classic blade and classic clump share the same dev LOD parameters.
    const nearEnd=ctx.settings?.grassFullDensityDistance??NEAR_END;
    const minDensity=(ctx.settings?.grassFarDensityPercent??38)/100;
    const sharpness=ctx.settings?.grassDensitySharpness??.005;
    const coefficient=ctx.settings?.grassDensityCoefficient??.25;
    const offset=ctx.settings?.grassDensityOffset??1;
    for(const layer of [near,far]){
      for(const record of layer.active.values()){
        const {mesh,bounds}=record;
        // Each blade makes its own stable world-space density decision.
        // Draw a safe superset using the *nearest* point of this page,
        // never its centre: crossing the edge cannot suddenly reveal a
        // whole chunk. Instance priority is ordered, so prefixes are stable.
        const size=layer.size;
        const minX=record.tileX*size,maxX=(record.tileX+1)*size;
        const minZ=record.tileZ*size,maxZ=(record.tileZ+1)*size;
        const dx=Math.max(minX-ctx.px,0,ctx.px-maxX);
        const dz=Math.max(minZ-ctx.pz,0,ctx.pz-maxZ);
        // Nonmonotonic curves cannot use page-nearest conservative culling.
        // Negative coefficient sums may also reverse the curve, so keep all
        // instances in the CPU draw and let each blade handle its visibility.
        const maxCoverage=offset<1||coefficient+sharpness<0 ? 1 :
          grassDistanceDensity(Math.hypot(dx,dz),radius,{
            nearEnd,minDensity,sharpness,coefficient,offset,
          });
        // Keep the proven dev CPU page-prefix optimization unchanged.
        // Legacy shader performs its own near/far dithered transition.
        mesh.count=Math.min(record.fullCount,
          Math.ceil(record.fullCount*(maxCoverage+GRASS_DENSITY_BLEND)));
        // Only the camera's visible page subset is sent to the renderer.
        mesh.visible=mesh.count>0&&(!useFrustum||!bounds||cameraFrustum.intersectsBox(bounds));
        // Profiler scene inventory should still count resident tiles even
        // though these are explicitly hidden from the current camera.
        mesh.userData.microGrassFrustumHidden=!mesh.visible;
      }
    }
  }
  function refreshAO(x,z){
    const config=aoConfig();
    const signature=aoSignature();
    if(signature!==aoConfigSignature){
      aoConfigSignature=signature;
      aoRevision++;
      aoAtlas?.invalidate();
      for(const record of near.active.values()){
        record.aoSignature=null;
        ctx.worldStreamer?.cancel('grassAO:'+record.tileX+','+record.tileZ);
      }
    }
    if(config.enabled&&aoAtlas&&ctx.worldStreamer?.enabled){
      for(const record of near.active.values()){
        if(record.aoSignature===signature)continue;
        const {tileX:tx,tileZ:tz,samples}=record;
        // Revisiting previously streamed areas reuses an already baked tile;
        // never bake the same AO map again while it is still in the LRU.
        if(aoAtlas.has(tx,tz)){
          record.aoSignature=signature;
          continue;
        }
        record.aoSignature=signature;
        const ticket=aoRevision;
        ctx.worldStreamer.schedule({
          key:'grassAO:'+tx+','+tz,kind:'grassAO',
          priority:WORLD_PRIORITY.prefetch,
          payload:{samples,tx,tz,size:NEAR_TILE,
            clusterConfig,ao:{...config,configKey:signature}},
          // If Worker is unavailable we skip optional AO, rather than
          // freezing the game thread to synchronously bake thousands of roots.
          fallback:()=>null,
          apply:baked=>{
            if(ticket!==aoRevision||!near.active.has(tx+','+tz))return;
            if(baked){
              aoAtlas.ready(baked);
            }else record.aoSignature=null;
          },
        });
      }
    }
    aoAtlas?.tick(x,z,{
      enabled:config.enabled,
      radius:(ctx.settings?.grassAOShadowRadius??50)/100,
      intensity:(ctx.settings?.grassAOIntensity??80)/100,
      softness:ctx.settings?.grassAOSoftness??50,
      resolution:config.resolution,
      windowTiles:ctx.settings?.grassAOAtlasTiles??5,
      sampling:config.sampling,
      cacheTiles:ctx.settings?.grassAOCacheTiles??64,
      tilesPerFrame:ctx.settings?.grassAOTilesPerFrame??2,
      uploadsPerSecond:ctx.settings?.grassAOUploadsPerSecond??8,
      edgeFade:ctx.settings?.grassAOEdgeFade!==false,
    });
  }
  function tick() {
    ctx.updateGrassGroundCover?.();
    const x=ctx.px,z=ctx.pz;
    const nextClusterConfig=getClusterConfig();
    const nextClusterSignature=dataSignature(nextClusterConfig);
    const clusterChanged=nextClusterSignature!==clusterSignature;
    clusterConfig=nextClusterConfig;
    clusterSignature=nextClusterSignature;
    const triangles=ctx.settings?.grassTriangles??6;
    const interaction=ctx.settings?.grassInteraction!==false;
    const nextGeometrySignature=geometrySignature();
    if(triangles!==currentTriangles||interaction!==currentInteraction||
       nextGeometrySignature!==currentGeometrySignature){
      streamingEpoch++;
      for(const layer of [near,far]){
        for(const record of layer.active.values())release(layer,record);
        layer.active.clear();
        for(const mesh of layer.unused)disposePage(mesh);
        layer.unused.length=0;
        layer.geometry.dispose();layer.material.dispose();
        layer.geometry=makeClassicGrassClumpGeometry(
          THREE,clusterConfig,layer.tier,triangles);
        layer.material=makeMaterial(THREE,playerUniform,layer===near,!interaction);
      }
      currentTriangles=triangles;currentInteraction=interaction;
      currentGeometrySignature=nextGeometrySignature;
      lastDensity=null;
    }
    playerUniform.set(x,z);
    updateGrassActors(x,z);
    updateClearings(x,z);
    // Size range and width are shader uniforms: no tile rebuild or GPU reupload.
    // Classic blade appearance uses the same size/width/rotation settings
    // whether blades are independent or arranged into pouches.
    const minSize=Math.max(1,Math.min(8,ctx.settings?.grassMinSize ?? 1));
    const maxSize=Math.max(minSize,Math.min(8,ctx.settings?.grassMaxSize ?? 7));
    const width=Math.max(.25,Math.min(4,ctx.settings?.grassWidth ?? 1));
    const minTurn=Math.max(-90,Math.min(0,ctx.settings?.grassTurnMin ?? -30));
    const maxTurn=Math.max(0,Math.min(90,ctx.settings?.grassTurnMax ?? 30));
    const lodNear=ctx.settings?.grassFullDensityDistance??NEAR_END;
    const lodWidth=(ctx.settings?.grassFarWidthBonus??30)/100;
    const lodSharpness=ctx.settings?.grassDensitySharpness??.005;
    const lodRadius=effectiveGrassRadius(
      ctx.settings?.grassDistance??MICRO_GRASS_RADIUS,
      ctx.terrain?.nightBlend??0);
    for(const layer of [near,far]){
      const u=layer.material.userData.grassUniforms;
      u.fcGrassSizeRange.value.set(minSize,maxSize);
      u.fcGrassWindSpeed.value=ctx.settings?.windEnabled===false
        ?0:clusterConfig.grassClusterWindSpeed;
      // No experimental clump-only shading uniforms or bend controls.
      u.fcGrassWindTime.value=performance.now()/1000;
      u.fcGrassRandomColors.value=ctx.settings?.grassRandomColors?1:0;
      u.fcGrassYellowShare.value=(ctx.settings?.grassYellowPercent??5)/100;
      updateGrassFoliageUniforms(u,ctx.settings,ctx.sun);
      u.fcGrassWidth.value=width;
      u.fcGrassTurnRange.value.set(minTurn*Math.PI/180,maxTurn*Math.PI/180);
      u.fcGrassDensityLod.value.set(
        lodNear,Math.max(lodNear+1,lodRadius-2),lodWidth,lodSharpness);
      u.fcGrassDensityShape.value.set(
        ctx.settings?.grassDensityCoefficient??.25,
        ctx.settings?.grassDensityOffset??1);
      u.fcGrassMinDensity.value=(ctx.settings?.grassFarDensityPercent??38)/100;
    }
    // Do not generate/draw pages hidden by the 30m deep-night fog. The
    // ordinary grass slider remains a daytime setting; no GPU-only fade.
    const radius=effectiveGrassRadius(
      ctx.settings?.grassDistance??MICRO_GRASS_RADIUS,
      ctx.terrain?.nightBlend??0);
    const density=Math.max(1,Math.min(MICRO_GRASS_MAX_DENSITY,
      ctx.settings?.grassDensity??30));
    if(ctx.ground?.material?.userData?.grassDensityUniforms)
      ctx.ground.material.userData.grassDensityUniforms.fcGroundGrassDensity.value=density;
    const cutoff=Math.min(radius,NEAR_END);
    // Reuse the original classic near/far LOD dither and fade.
    near.material.userData.grassUniforms.fcGrassFade.value.set(
      -2,-1,Math.max(3,cutoff-7),cutoff);
    far.material.userData.grassUniforms.fcGrassFade.value.set(
      NEAR_END-7,NEAR_END,Math.max(NEAR_END,radius-5),radius);
    const refreshData=lastSeed!==ctx.seed||lastDensity!==density||clusterChanged;
    const radiusChanged=lastRadius!==radius;
    if(refreshData)streamingEpoch++;
    if(!refreshData&&!radiusChanged&&Math.abs(x-lastX)<REBUILD_DISTANCE&&
      Math.abs(z-lastZ)<REBUILD_DISTANCE){
      refreshAO(x,z);
      return false;
    }
    lastX=x;lastZ=z;lastSeed=ctx.seed;lastDensity=density;lastRadius=radius;
    // Radius-only changes reuse existing InstancedMeshes and cached tiles.
    // Rebuild their instance matrices only if seed/density/geometry changes.
    syncLayer(near,x,z,cutoff+REBUILD_DISTANCE,ctx.seed,density,refreshData);
    syncLayer(far,x,z,radius>NEAR_END?radius+REBUILD_DISTANCE:0,
      ctx.seed,density,refreshData);
    refreshAO(x,z);
    return true;
  }
  tick();
  return {
    tick,updateVisibility,
    get count(){let sum=0;for(const layer of [near,far])
      for(const record of layer.active.values())sum+=record.mesh.count;
      return sum;},
    get tiles(){return near.active.size+far.active.size;},
    get visibleRadius(){return lastRadius;},
    get nearPending(){return near.pending.size;},
    get nearDesired(){return near.desired.size;},
    get generatedTiles(){return generatedTiles;},
    get cacheHits(){return cacheHits;},
    get mesh(){return near.active.values().next().value?.mesh??null;},
    get bakedAO(){return aoAtlas?.metrics??null;},
    dispose(){
      aoAtlas?.dispose();
      streamingEpoch++;
      for(const layer of [near,far]){
        for(const key of layer.pending)
          ctx.worldStreamer?.cancel('grass:'+layer.tier+':'+key);
        layer.pending.clear();
        for(const record of layer.active.values())release(layer,record);
        layer.active.clear();
        for(const mesh of layer.unused)disposePage(mesh);
        layer.unused.length=0;
        layer.geometry.dispose();
        layer.material.dispose();
      }
    },
  };
}
