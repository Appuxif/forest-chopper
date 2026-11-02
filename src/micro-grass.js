// Low-poly, static grass carpet: cached instanced tiles with two distance LODs.
import {gladesForTile,gladeAtPoint,gladeDensity} from './grass-glades.js?v=20261031-ponds1';
import {lakesNearTile,lakeNormalized} from './lakes.js';
import {WorldLRU,WORLD_PRIORITY} from './world-task-scheduler.js';
// One shared geometry/material per LOD, no individual scene objects per tuft,
// and no full-ring matrix uploads whenever the player walks a meter.
export const MICRO_GRASS_CELL = 1.1;
export const MICRO_GRASS_RADIUS = 26;
export const MICRO_GRASS_PER_CELL = 9;
export const MICRO_GRASS_MAX_RADIUS = 100;
export const MICRO_GRASS_MAX_DENSITY = 50;
const NEAR_TILE = 12;
const FAR_TILE = 24;
const NEAR_END = 26;
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
export function generateGrassTile(seed, tileX, tileZ, tileSize, density, tier) {
  const list = [];
  const x0 = tileX * tileSize, z0 = tileZ * tileSize;
  const far = tier === 'far';
  // Glades replace local grass density (including when the player's slider
  // is low), so generate enough candidates for the densest overlapping glade.
  const glades=gladesForTile(seed,x0,z0,tileSize);
  const nearbyLakes=lakesNearTile(seed,x0,z0,tileSize);
  const maxGladeDensity=glades.some(g=>g.kind===2) ? 46
    : glades.some(g=>g.kind===3) ? 42 : 0;
  const samplingDensity=Math.max(density,maxGladeDensity);
  // Equal grass coverage across LODs; far blades only use fewer segments.
  const lodFactor=1;
  const candidates = Math.ceil(tileSize*tileSize*samplingDensity /
    (MICRO_GRASS_CELL*MICRO_GRASS_CELL)*lodFactor*1.08);
  const patchState={kind:0,weight:0};
  // Each tile gets an independent phase; the same pattern never jumps as the
  // player moves, and increasing density adds detail instead of making clumps.
  const phaseX = hash(seed, tileX, tileZ, far ? 311 : 301);
  const phaseZ = hash(seed, tileX, tileZ, far ? 312 : 302);
  for (let i = 0; i < candidates; i++) {
    // Irrational steps fill a tile more uniformly than clustered random points.
    const u = (phaseX + (i + .5) * .7548776662466927) % 1;
    const v = (phaseZ + (i + .5) * .5698402909980532) % 1;
    const x = x0 + u * tileSize, z = z0 + v * tileSize;
    if (Math.abs(z) < 1.75) continue; // preserve the existing clear trail
    gladeAtPoint(x,z,glades,patchState);
    if(patchState.kind===5&&patchState.weight>.15)continue;
    // Avoid generating tens of thousands of blades on the sandy lakebed.
    if(nearbyLakes.some(lake=>{
      const u=lakeNormalized(lake,x,z);
      return u!==null&&u<.97;
    }))continue;
    const requestedDensity=gladeDensity(patchState.kind);
    const localDensity=requestedDensity===null ? density
      : density+(requestedDensity-density)*patchState.weight;
    if(hash(seed,tileX,tileZ,i+840)>localDensity/samplingDensity)continue;
    const biome=field(seed,x,z);
    // Soft biome-scale variation, including through the glade boundary.
    if(hash(seed,tileX,tileZ,i+740) > .79 + biome*.19)continue;
    const variation = hash(seed,tileX,tileZ,i+1300);
    list.push({
      x,z,
      // Shared base lean. Per-blade yaw variation comes from a GPU uniform.
      angle: .66,
      scale: .82 + variation * .40,
      tint: hash(seed,tileX,tileZ,i+3300),
      biome,
      patchKind:patchState.kind,
      patchWeight:patchState.weight,
    });
  }
  return list;
}

// One thin curved blade per instance, not a multi-leaf bush.
// Near: a smooth three-section ribbon; distant: two sections.
// All blades use the same two cached geometries, with world-aligned lean.
function makeTuftGeometry(THREE, tier, triangles=6) {
  const near = tier === 'near';
  const segments = triangles===1?1:triangles===3?2:(near?3:2);
  const positions = [], colors = [],centerXs = [];
  const bendAt = t => .105 * t * t;
  const point = (t, side) => {
    const bend = bendAt(t);
    const height = .24 *
      (t - .13 * Math.pow(t, 4)); // gently drooping tip
    const halfWidth = .0065 * (1 - t) ** .8;
    return [bend + side * halfWidth, .008 + height, 0];
  };
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments, t1 = (i + 1) / segments;
    const a = point(t0,-1), b = point(t0,1);
    const c = point(t1,-1), d = point(t1,1);
    positions.push(...a,...c,...b);
    centerXs.push(bendAt(t0),bendAt(t1),bendAt(t0));
    if((triangles===3&&i===0)||(triangles===1)){
      // One triangle at the lowest tiers; keep the silhouette tapering.
    }else{
      positions.push(...b,...c,...d);
      centerXs.push(bendAt(t0),bendAt(t1),bendAt(t1));
    }
    // Dark roots blend with the ground; sunlit tips stay readable even
    // where the forest-floor texture has a similar hue.
    const low=.77 + t0*.38, high=.77 + t1*.38;
    const shades=((triangles===3&&i===0)||triangles===1)
      ?[low,high,low]:[low,high,low,low,high,high];
    for (const shade of shades)
      colors.push(shade*.93,shade*1.04,shade*.88);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  // Vertex centerline lets width change without stretching the grass's curl.
  geometry.setAttribute('fcGrassCenterX',new THREE.Float32BufferAttribute(centerXs,1));
  geometry.computeVertexNormals();
  return geometry;
}

// Animate neither position nor wind: just GPU-side smooth size falloff at LOD
// boundaries. Updated uniform does not rewrite any instance data on movement.
function makeMaterial(THREE, player, near, simple=false) {
  const uniforms={
    fcGrassPlayer:{value:player},
    fcGrassFade:{value:new THREE.Vector4(-2,-1,19,26)},
    fcGrassSizeRange:{value:new THREE.Vector2(1,7)},
    fcGrassWidth:{value:1},
    fcGrassTurnRange:{value:new THREE.Vector2(-Math.PI/6,Math.PI/6)},
    fcGrassClearings:{value:Array.from({length:GRASS_CLEARING_SLOTS},
      ()=>new THREE.Vector4(0,0,0,0))},
    ...(near ? {fcGrassActors:{value:Array.from({length:GRASS_ACTOR_SLOTS},
      ()=>new THREE.Vector4(0,0,0,0))}} : {}),
  };
  const material=new THREE.MeshLambertMaterial({
    color:0xffffff,vertexColors:true,side:THREE.DoubleSide,depthWrite:true,
  });
  if(simple){
    // Cheap unmodified Lambert shader: no actor, clearing or glade loops.
    material.userData.grassUniforms=uniforms;
    return material;
  }
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nuniform vec2 fcGrassPlayer;\nuniform vec4 fcGrassFade;\nuniform vec2 fcGrassSizeRange;\nuniform float fcGrassWidth;\nuniform vec2 fcGrassTurnRange;\nattribute float fcGrassCenterX;\nattribute vec2 fcGrassProfile;\nuniform vec4 fcGrassClearings[24];'
      + (near ? '\nuniform vec4 fcGrassActors[6];' : ''),
    ).replace('#include <color_vertex>', `#include <color_vertex>
    // Height-based ambient occlusion: dark roots, open illuminated tips.
    // Far LOD uses a weaker gradient to avoid heavy dark bands at distance.
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
  // A glade profile overrides global settings only within its boundary.
  if(fcGrassProfile.x > 1.5){
    float fcGladeSize = fcGrassProfile.x < 2.5
      ? mix(5.0,7.0,fcRandom) : mix(1.0,4.0,fcRandom);
    fcSize=mix(fcSize,fcGladeSize,fcGrassProfile.y);
  }
  transformed.x = fcGrassCenterX + (transformed.x - fcGrassCenterX) * fcGrassWidth;
  float fcTurnRandom = fract(21.12345 * fract(dot(
    instanceMatrix[3].xz,vec2(0.1031,0.11369))));
  float fcTurn = mix(fcGrassTurnRange.x, fcGrassTurnRange.y, fcTurnRandom);
  float fcCos = cos(fcTurn), fcSin = sin(fcTurn);
  float fcOriginalX = transformed.x;
  transformed.x = fcOriginalX * fcCos - transformed.z * fcSin;
  transformed.z = fcOriginalX * fcSin + transformed.z * fcCos;
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
  transformed *= fcVisibility * fcSize;
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
  };
  material.userData.grassUniforms=uniforms;
  return material;
}

export function createMicroGrass(ctx) {
  const THREE=ctx.THREE,playerUniform=new THREE.Vector2();
  const dummy=new THREE.Object3D(),tint=new THREE.Color();
  const near={
    tier:'near',size:NEAR_TILE,geometry:makeTuftGeometry(THREE,'near'),
    material:makeMaterial(THREE,playerUniform,true),
    active:new Map(),unused:[],
  };
  const far={
    tier:'far',size:FAR_TILE,geometry:makeTuftGeometry(THREE,'far'),
    material:makeMaterial(THREE,playerUniform,false),
    active:new Map(),unused:[],
  };
  let lastX=Infinity,lastZ=Infinity,lastSeed=null,lastDensity=null,lastRadius=null;
  const sampleCache=new WorldLRU(20*1024*1024);
  let streamingEpoch=0;
  for(const layer of [near,far]){
    layer.pending=new Set();layer.desired=new Set();
  }
  let currentTriangles=6,currentInteraction=true;
  let generatedTiles=0;
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
    if(layer.unused.length<MAX_UNUSED_TILES){
      layer.unused.push(record.mesh);
    }else{
      disposePage(record.mesh);
    }
  }
  function createPage(layer,x,z,seed,density,samples=null){
    samples??=generateGrassTile(seed,x,z,layer.size,density,layer.tier);
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
      // Single draw call per tile; just two extra floats per grass instance.
      const geometry=layer.geometry.clone();
      geometry.setAttribute('fcGrassProfile',
        new THREE.InstancedBufferAttribute(new Float32Array(capacity*2),2));
      mesh=new THREE.InstancedMesh(geometry,layer.material,capacity);
    }
    mesh.count=count;
    const profile=mesh.geometry.getAttribute('fcGrassProfile');
    mesh.frustumCulled=true; // Cull entire fixed world-space page.
    mesh.userData.microGrass=true;
    mesh.userData.grassTier=layer.tier;
    for(let i=0;i<count;i++){
      const j=i*9;
      const x=packed?samples[j]:samples[i].x;
      const z=packed?samples[j+2]:samples[i].z;
      const y=packed?samples[j+1]:ctx.terrain.heightAt(x,z);
      const angle=packed?samples[j+3]:samples[i].angle;
      const scale=packed?samples[j+4]:samples[i].scale;
      const tintValue=packed?samples[j+5]:samples[i].tint;
      const biome=packed?samples[j+6]:samples[i].biome;
      const patchKind=packed?samples[j+7]:samples[i].patchKind;
      const patchWeight=packed?samples[j+8]:samples[i].patchWeight;
      dummy.position.set(x,y,z);
      dummy.rotation.set(0,angle,0);
      dummy.scale.setScalar(scale*(ctx.settings?.grassInteraction===false?3.7:1));
      dummy.updateMatrix();
      mesh.setMatrixAt(i,dummy.matrix);
      profile.setXY(i,patchKind,patchWeight);
      tint.setHSL(.278+biome*.034,.39+tintValue*.13,
        .355+tintValue*.067);
      mesh.setColorAt(i,tint);
    }
    mesh.instanceMatrix.needsUpdate=true;
    profile.needsUpdate=true;
    if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    mesh.computeBoundingSphere();
    // Leave culling margin for the experimental 8x shader scaling.
    if(mesh.boundingSphere)mesh.boundingSphere.radius += 2;
    ctx.scene.add(mesh);
    generatedTiles++;
    return {mesh};
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
      const cacheKey=[seed,layer.tier,tx,tz,density].join('/');
      const cached=sampleCache.get(cacheKey);
      if(cached){
        const page=createPage(layer,tx,tz,seed,density,cached);
        if(page)layer.active.set(key,page);
        continue;
      }
      if(!ctx.worldStreamer){
        const page=createPage(layer,tx,tz,seed,density);
        if(page)layer.active.set(key,page);
        continue;
      }
      layer.pending.add(key);
      const epoch=streamingEpoch;
      const payload={seed,tx,tz,size:layer.size,density,tier:layer.tier};
      ctx.worldStreamer.schedule({
        key:'grass:'+layer.tier+':'+key,kind:'grass',payload,
        priority:d<20?WORLD_PRIORITY.near:d<55?WORLD_PRIORITY.visible:WORLD_PRIORITY.background,
        fallback:()=>generateGrassTile(seed,tx,tz,layer.size,density,layer.tier),
        apply:samples=>{
          layer.pending.delete(key);
          if(epoch!==streamingEpoch||!layer.desired.has(key)||
             layer.active.has(key))return;
          if(samples instanceof Float32Array)
            sampleCache.put(cacheKey,samples,samples.byteLength);
          const page=createPage(layer,tx,tz,seed,density,samples);
          if(page)layer.active.set(key,page);
        },
      });
    }
  }
  function tick() {
    const x=ctx.px,z=ctx.pz;
    const triangles=ctx.settings?.grassTriangles??6;
    const interaction=ctx.settings?.grassInteraction!==false;
    if(triangles!==currentTriangles||interaction!==currentInteraction){
      streamingEpoch++;
      for(const layer of [near,far]){
        for(const record of layer.active.values())release(layer,record);
        layer.active.clear();
        for(const mesh of layer.unused)disposePage(mesh);
        layer.unused.length=0;
        layer.geometry.dispose();layer.material.dispose();
        layer.geometry=makeTuftGeometry(THREE,layer.tier,triangles);
        layer.material=makeMaterial(THREE,playerUniform,layer===near,!interaction);
      }
      currentTriangles=triangles;currentInteraction=interaction;
      lastDensity=null;
    }
    playerUniform.set(x,z);
    updateGrassActors(x,z);
    updateClearings(x,z);
    // Size range and width are shader uniforms: no tile rebuild or GPU reupload.
    const minSize=Math.max(1,Math.min(8,ctx.settings?.grassMinSize ?? 1));
    const maxSize=Math.max(minSize,Math.min(8,ctx.settings?.grassMaxSize ?? 7));
    const width=Math.max(.25,Math.min(4,ctx.settings?.grassWidth ?? 1));
    const minTurn=Math.max(-90,Math.min(0,ctx.settings?.grassTurnMin ?? -30));
    const maxTurn=Math.max(0,Math.min(90,ctx.settings?.grassTurnMax ?? 30));
    for(const layer of [near,far]){
      const u=layer.material.userData.grassUniforms;
      u.fcGrassSizeRange.value.set(minSize,maxSize);
      u.fcGrassWidth.value=width;
      u.fcGrassTurnRange.value.set(minTurn*Math.PI/180,maxTurn*Math.PI/180);
    }
    const radius=Math.max(12,Math.min(MICRO_GRASS_MAX_RADIUS,
      ctx.settings?.grassDistance??MICRO_GRASS_RADIUS));
    const density=Math.max(1,Math.min(MICRO_GRASS_MAX_DENSITY,
      ctx.settings?.grassDensity??MICRO_GRASS_PER_CELL));
    if(ctx.ground?.material?.userData?.grassDensityUniforms)
      ctx.ground.material.userData.grassDensityUniforms.fcGroundGrassDensity.value=density;
    const cutoff=Math.min(radius,NEAR_END);
    near.material.userData.grassUniforms.fcGrassFade.value.set(
      -2,-1,Math.max(3,cutoff-7),cutoff);
    far.material.userData.grassUniforms.fcGrassFade.value.set(
      NEAR_END-7,NEAR_END,Math.max(NEAR_END,radius-5),radius);
    const changed=lastSeed!==ctx.seed||lastDensity!==density||lastRadius!==radius;
    if(changed)streamingEpoch++;
    if(!changed&&Math.abs(x-lastX)<REBUILD_DISTANCE&&
      Math.abs(z-lastZ)<REBUILD_DISTANCE)return false;
    lastX=x;lastZ=z;lastSeed=ctx.seed;lastDensity=density;lastRadius=radius;
    // Small hysteresis buffer keeps page boundaries outside visible fade ends.
    syncLayer(near,x,z,cutoff+REBUILD_DISTANCE,ctx.seed,density,changed);
    syncLayer(far,x,z,radius>NEAR_END?radius+REBUILD_DISTANCE:0,
      ctx.seed,density,changed);
    return true;
  }
  tick();
  return {
    tick,
    get count(){let sum=0;for(const layer of [near,far])
      for(const record of layer.active.values())sum+=record.mesh.count;
      return sum;},
    get tiles(){return near.active.size+far.active.size;},
    get nearPending(){return near.pending.size;},
    get nearDesired(){return near.desired.size;},
    get generatedTiles(){return generatedTiles;},
    get mesh(){return near.active.values().next().value?.mesh??null;},
    dispose(){
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
