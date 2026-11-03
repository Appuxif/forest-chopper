import {nightBlend} from './lighting-profile.js?v=20261102-deep-night1';
import {installSunShadowCascades,cascadeShadowConfig,cascadeShadowCoverage,cascadeTexelCenter} from './sun-shadow-cascades.js?v=20261103-settings-ui-export1';
// Lightweight local atmosphere and a bounded shadow budget for trees.
// Everything is cosmetic: no network state, world generation, or time sync.
export const SHADOW_TREE_LIMIT = 34;
export const SHADOW_TREE_RADIUS = 60;
export const SHADOW_UPDATE_MS = 1000;
export const SHADOW_MAX_TREE_LIMIT = 2400;
export const SHADOW_DECOR_LIMIT = 200;
export const SHADOW_MAP_SIZES = Object.freeze({low:512,balanced:1024,high:2048});

export function celestialDirections(phase) {
  const f = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  const angle = f * Math.PI * 2;
  const x = Math.sin(angle) * .95;
  const y = Math.cos(angle) * .95;
  const z = Math.cos(angle) * .32;
  const length = Math.hypot(x,y,z);
  return {
    sun:{x:x/length,y:y/length,z:z/length},
    moon:{x:-x/length,y:-y/length,z:-z/length},
  };
}

export function shadowMapSizeForQuality(quality) {
  return SHADOW_MAP_SIZES[quality] ?? SHADOW_MAP_SIZES.balanced;
}

// The sky is camera-centred, but the terrain changes camera.far between
// graphics presets (180m on Low, 230m on Medium). A fixed 235m dome lies
// beyond that plane, producing a polygonal hole centred on the crosshair.
// Keep the sky and its sun/moon wholly inside the current view frustum.
export function skyGeometryDistances(cameraFar){
  const far=Number.isFinite(cameraFar)&&cameraFar>0?cameraFar:280;
  const domeRadius=Math.min(235,far*.9);
  const bodyDistance=Math.min(210,domeRadius*.9);
  return {domeRadius,bodyDistance,
    sunRadius:6.4*bodyDistance/210,
    moonRadius:4.2*bodyDistance/210};
}

// The nearest trees cast shadows; culled trees never enter the expensive pass.
// Return stable tree references instead of owning/recreating their geometry.
export function selectShadowTrees(trees, x, z, radius=SHADOW_TREE_RADIUS,
  limit=SHADOW_TREE_LIMIT, minRadius=0) {
  const nearby=[];
  const maxDistSq=radius*radius,minDistSq=minRadius*minRadius;
  for (const tree of trees.values()) {
    const dx=tree.position.x-x,dz=tree.position.z-z;
    const distanceSq=dx*dx+dz*dz;
    if(distanceSq<=maxDistSq&&distanceSq>=minDistSq)nearby.push({tree,distanceSq});
  }
  nearby.sort((a,b)=>a.distanceSq-b.distanceSq);
  return nearby.slice(0,limit).map(item=>item.tree);
}

export function createAtmosphere({THREE,renderer,scene,camera,sun,hemisphere,ground,settings,trees,
  getCharacterShadowCasters=()=>[],getDecorShadowCasters=()=>[],
  getPointShadowCasters=()=>[],getBuiltShadowCasters=()=>[],getDistantShadowCasters=()=>[]}) {
  const skyMaterial=new THREE.ShaderMaterial({
    uniforms:{
      horizon:{value:new THREE.Color(0xa4c8be)},
      zenith:{value:new THREE.Color(0x76a6bc)},
      sunDir:{value:new THREE.Vector3(0,1,0)},
      night:{value:0},
    },
    vertexShader:`varying vec3 vDirection;
      void main(){
        vDirection=normalize(position);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      }`,
    fragmentShader:`varying vec3 vDirection;
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform vec3 sunDir;
      uniform float night;
      void main(){
        vec3 dir=normalize(vDirection);
        float blend=smoothstep(0.04,0.92,dir.y);
        vec3 color=mix(horizon,zenith,blend);
        float glow=pow(max(dot(dir,sunDir),0.0),32.0);
        color+=vec3(.22,.14,.065)*glow*(1.0-night);
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false,
  });
  const dome=new THREE.Mesh(new THREE.SphereGeometry(235,24,16),skyMaterial);
  dome.frustumCulled=false;
  dome.renderOrder=-200;
  scene.add(dome);

  const bodyGeometry=new THREE.SphereGeometry(1,20,12);
  const solarMaterial=new THREE.MeshBasicMaterial({
    color:0xffeac2,depthWrite:false,fog:false,
  });
  const lunarMaterial=new THREE.MeshBasicMaterial({
    color:0xe0e9f1,depthWrite:false,fog:false,
  });
  const sunBody=new THREE.Mesh(bodyGeometry,solarMaterial);
  const moonBody=new THREE.Mesh(bodyGeometry,lunarMaterial);
  sunBody.scale.setScalar(6.4);
  moonBody.scale.setScalar(4.2);
  sunBody.renderOrder=-190;
  moonBody.renderOrder=-190;
  scene.add(sunBody,moonBody);

  // CSM: one combined caster map for each range, no half-intensity lights
  // and no separate player-only directional map. Animations refresh with
  // their cascade's timer; both maps are cached between updates.
  const initialSunIntensity=sun.intensity;
  const initialAmbientIntensity=hemisphere.intensity;
  const nearSun=new THREE.DirectionalLight(sun.color,initialSunIntensity);
  scene.add(nearSun,nearSun.target);
  const cascadeShader=THREE.ShaderChunk?.lights_fragment_begin&&THREE.ShaderLib
    ?installSunShadowCascades(THREE):null;
  for(const light of [sun,nearSun,hemisphere]){
    light?.layers.enable(1);
    light?.layers.enable(3);
  }
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate=true;
  // Always keep both in the shader's directional shadow array. Disabling
  // via shadow.intensity=0 avoids reindexing CSM shader uniforms.
  sun.castShadow=true;
  sun.shadow.autoUpdate=false;
  nearSun.castShadow=true;
  nearSun.shadow.autoUpdate=false;
  nearSun.shadow.bias=-.00012;
  nearSun.shadow.normalBias=.02;
  nearSun.shadow.radius=1.4;

  // Three.js r170 uses the *view camera* layers during shadow map rendering,
  // not the shadow camera layers. We give each light only its actual casters.
  // This avoids traversing the forest on every character shadow update.
  const farShadowScene=new THREE.Group();
  const nearShadowScene=new THREE.Group();
  const localPointShadowScene=new THREE.Group();
  const originalShadowRender=renderer.shadowMap.render;
  renderer.shadowMap.render=function(lights,shadowScene,viewCamera){
    const oldMask=viewCamera.layers.mask;
    try{
      for(const light of lights){
        if(light.shadow?.autoUpdate===false && !light.shadow.needsUpdate)continue;
        if(light===nearSun){
          viewCamera.layers.mask=1|(1<<1)|(1<<3)|(1<<4);
          originalShadowRender.call(this,[light],nearShadowScene,viewCamera);
        }else if(light===sun){
          viewCamera.layers.mask=1|(1<<1)|(1<<3)|(1<<4);
          originalShadowRender.call(this,[light],farShadowScene,viewCamera);
        }else if(light.isPointLight){
          // A point light normally renders the entire world SIX times.
          // Limit each cubemap face to casters within its small falloff.
          localPointShadowScene.children=getPointShadowCasters(light);
          viewCamera.layers.mask=1|(1<<1)|(1<<3)|(1<<4);
          originalShadowRender.call(this,[light],localPointShadowScene,viewCamera);
        }else{
          viewCamera.layers.mask=oldMask;
          originalShadowRender.call(this,[light],shadowScene,viewCamera);
        }
      }
    }finally{
      viewCamera.layers.mask=oldMask;
    }
  };
  sun.shadow.bias=-.00012;
  sun.shadow.normalBias=.035;
  sun.shadow.radius=2.2;
  sun.shadow.camera.left=-72;
  sun.shadow.camera.right=72;
  sun.shadow.camera.top=72;
  sun.shadow.camera.bottom=-72;
  sun.shadow.camera.near=.5;
  sun.shadow.camera.far=220;
  sun.shadow.camera.updateProjectionMatrix();
  ground.receiveShadow=true;
  scene.add(sun.target);
  let quality=null,shadowResolution=null,nearShadowResolution=null,phase=0,
    lastUpdate=-Infinity;
  let shadowRadius=null,nearShadowRadius=null,farCasterStart=null,farCenterX=Infinity,farCenterZ=Infinity,
    nearCasterX=Infinity,nearCasterZ=Infinity,
    refreshInterval=null;
  let builtShadowsDirty=true,staticShadowRevision=0,lastCasterMode=null;
  let totalSunIntensity=initialSunIntensity;
  let baseAmbientIntensity=initialAmbientIntensity;
  function setAmbientIntensity(value){
    baseAmbientIntensity=value;
    const contrast=Math.max(0,Math.min(100,settings.shadowContrast??70));
    hemisphere.intensity=value*(1-.65*contrast/100);
  }
  setAmbientIntensity(baseAmbientIntensity);
  function setSunIntensity(total){
    totalSunIntensity=total;
    // The shader blends the two full-intensity lights so the result is one
    // sunlight contribution with a near/far shadow map, never 2x brighter.
    sun.intensity=total;
    nearSun.intensity=total;
  }
  setSunIntensity(initialSunIntensity);
  let lightingChanged=true,moonShadowsDisabled=false;
  const nearTrees=new Set(),farTrees=new Set(),shadowEnabledTrees=new Set();
  const zenithDay=new THREE.Color(0x78b0d0);
  // Match the deep-night sky, clear colour and fog to prevent a visible
  // horizon ring from sRGB rounding at very low RGB levels.
  const zenithNight=new THREE.Color(0x000000);
  const sunVector=new THREE.Vector3();
  const moonVector=new THREE.Vector3();
  const lightDir=new THREE.Vector3();

  function applyQuality() {
    const cfg=cascadeShadowConfig(settings);
    if(quality===settings.quality&&shadowResolution===cfg.farSize&&
      nearShadowResolution===cfg.nearSize)return;
    quality=settings.quality;
    shadowResolution=cfg.farSize;
    nearShadowResolution=cfg.nearSize;
    sun.shadow.mapSize.set(cfg.farSize,cfg.farSize);
    nearSun.shadow.mapSize.set(cfg.nearSize,cfg.nearSize);
    for(const light of [sun,nearSun]){
      if(light.shadow.map){
        light.shadow.map.dispose();
        light.shadow.map=null;
      }
      light.shadow.needsUpdate=true;
    }
    lightingChanged=true;
  }
  function setPhase(value=0) {
    phase=Number.isFinite(value)?((value%1)+1)%1:0;
    moonShadowsDisabled=settings.nightDisableMoonShadows!==false&&nightBlend(phase)>=.999;
    const dirs=celestialDirections(phase);
    sunVector.set(dirs.sun.x,dirs.sun.y,dirs.sun.z);
    moonVector.set(dirs.moon.x,dirs.moon.y,dirs.moon.z);
    skyMaterial.uniforms.sunDir.value.copy(sunVector);
    const daylight=Math.max(0,Math.min(1,(dirs.sun.y+.16)/.42));
    const night=1-(daylight*daylight*(3-2*daylight));
    skyMaterial.uniforms.horizon.value.copy(scene.background);
    skyMaterial.uniforms.zenith.value.copy(zenithDay).lerp(zenithNight,night);
    skyMaterial.uniforms.night.value=night;
    sunBody.visible=dirs.sun.y>-.10;
    moonBody.visible=dirs.moon.y>-.10;
    // Both shadow maps follow the same sun/moon direction.
    const source=dirs.sun.y>=0 ? dirs.sun : dirs.moon;
    lightDir.set(source.x,Math.max(.16,source.y),source.z).normalize();
    lightingChanged=true;
  }
  // The far cascade starts beyond the near zone, saving its caster budget
  // for genuinely distant trees. The two independent sets are *unioned*
  // before mutating castShadow flags: a far update cannot hide near trees.
  function refreshCasters(x,z,radius,coverage,far=false){
    const bandStart=far?coverage.farCasterStart:0;
    const bandEnd=far?radius:coverage.nearExtent;
    const limit=Math.min(SHADOW_MAX_TREE_LIMIT,Math.max(SHADOW_TREE_LIMIT,
      Math.ceil(Math.PI*(bandEnd*bandEnd-bandStart*bandStart)/68)));
    const next=new Set(settings.treeShadowsEnabled===false?[]:
      selectShadowTrees(trees,x,z,bandEnd,limit,bandStart));
    const active=far?farTrees:nearTrees;
    active.clear();
    for(const tree of next)active.add(tree);
    const meshes=new Set();
    for(const tree of active){
      for(const mesh of tree.userData?.treeBatch?.meshes??[])meshes.add(mesh);
    }
    const group=far?farShadowScene:nearShadowScene;
    group.children=[...active,...meshes,
      ...(far&&settings.treeShadowsEnabled!==false
        ?getDistantShadowCasters(x,z,bandStart,bandEnd):[]),
      ...(settings.treeShadowsEnabled!==false
        ?getDecorShadowCasters(x,z,bandEnd,SHADOW_DECOR_LIMIT):[]),
      ...(settings.treeShadowsEnabled!==false
        ?getBuiltShadowCasters(x,z,bandEnd):[]),
      ...(settings.characterShadowsEnabled!==false
        ?getCharacterShadowCasters():[])];
  }
  function syncTreeShadowFlags(){
    // The two independent cascades share the same meshes. Update only
    // membership changes; far refresh must never clear near casters.
    const combined=new Set([...nearTrees,...farTrees]);
    for(const tree of shadowEnabledTrees){
      if(combined.has(tree)||tree.userData?.treeBatch)continue;
      for(const mesh of tree.children)mesh.castShadow=false;
    }
    for(const tree of combined){
      if(tree.userData?.treeBatch)continue;
      for(const mesh of tree.children)
        mesh.castShadow=mesh.userData?.spruceFoliage
          ?settings.spruceFoliageVisible!==false&&settings.spruceFoliageShadows!==false
          :true;
    }
    shadowEnabledTrees.clear();
    for(const tree of combined)shadowEnabledTrees.add(tree);
  }
  function tick(now,x,z) {
    const sky=skyGeometryDistances(camera.far);
    dome.position.copy(camera.position);
    dome.scale.setScalar(sky.domeRadius/235);
    sunBody.position.copy(camera.position).addScaledVector(sunVector,sky.bodyDistance);
    moonBody.position.copy(camera.position).addScaledVector(moonVector,sky.bodyDistance);
    // Preserve the angular size of celestial bodies as their distance changes.
    sunBody.scale.setScalar(sky.sunRadius);
    moonBody.scale.setScalar(sky.moonRadius);
    const cascade=cascadeShadowConfig(settings);
    const coverage=cascadeShadowCoverage(cascade);
    const radius=cascade.far;
    const nearRadius=cascade.near;
    const interval=Math.max(0,Math.min(20000,
      (settings.shadowRefreshSeconds??SHADOW_UPDATE_MS/1000)*1000));
    const qualityChanged=quality!==settings.quality ||
      shadowResolution!==cascade.farSize||nearShadowResolution!==cascade.nearSize;
    const settingsChanged=radius!==shadowRadius||coverage.farCasterStart!==farCasterStart||
      interval!==refreshInterval||qualityChanged;
    const nearChanged=coverage.nearExtent!==nearShadowRadius||qualityChanged;
    const active=settings.treeShadowsEnabled!==false||
      settings.characterShadowsEnabled!==false;
    const shadowsEnabled=active&&!moonShadowsDisabled;
    const casterMode=[
      settings.treeShadowsEnabled!==false,settings.characterShadowsEnabled!==false,
      settings.spruceFoliageVisible!==false,settings.spruceFoliageShadows!==false,
    ].join(':');
    const casterSettingsChanged=casterMode!==lastCasterMode;
    sun.shadow.intensity=shadowsEnabled?1:0;
    nearSun.shadow.intensity=shadowsEnabled?1:0;
    // Even at a 20-second refresh interval the distant map follows large
    // player movements, so shadows never lag a full sector behind the camera.
    const moved=Math.hypot(x-farCenterX,z-farCenterZ)>=Math.max(6,radius*.05);
    const treeDue=shadowsEnabled&&
      (settingsChanged||builtShadowsDirty||casterSettingsChanged||moved||now-lastUpdate>=interval);
    // Near shadow depth is rendered EVERY displayed frame. Expensive caster
    // discovery is still throttled by a small movement threshold: buffered
    // near casters remain available while player/foliage animation is live.
    const nearDue=shadowsEnabled;
    const nearCastersDirty=settingsChanged||nearChanged||builtShadowsDirty||casterSettingsChanged||
      Math.hypot(x-nearCasterX,z-nearCasterZ)>=2;
    if(!shadowsEnabled){
      sun.shadow.needsUpdate=false;
      nearSun.shadow.needsUpdate=false;
    }
    if(qualityChanged)applyQuality();
    cascadeShader?.setRange(nearRadius,cascade.blend);
    nearSun.color.copy(sun.color);
    nearSun.shadow.radius=cascade.nearSoftness;
    sun.shadow.radius=cascade.farSoftness;
    // Update the ambient component every rendered frame, including while the
    // day/night cycle is paused, so the contrast slider applies immediately.
    setAmbientIntensity(baseAmbientIntensity);
    if(!treeDue&&!nearDue)return;
    // The two shadow cameras follow the same light direction, but have their
    // own resolution and texel snapping. This avoids the sub-texel projection
    // swimming previously visible whenever the player moved.
    if(treeDue){
      lastUpdate=now;
      farCenterX=x;farCenterZ=z;
      if(radius!==shadowRadius){
        shadowRadius=radius;
        const extent=radius+12;
        Object.assign(sun.shadow.camera,{
          left:-extent,right:extent,top:extent,bottom:-extent,
          far:Math.max(190,96+radius*2),
        });
      }
      refreshInterval=interval;
      farCasterStart=coverage.farCasterStart;
      refreshCasters(x,z,radius,coverage,true);
      const extent=radius+12;
      const center=cascadeTexelCenter(x,z,lightDir,extent*2,cascade.farSize);
      sun.target.position.set(center.x,center.y,center.z);
      sun.position.copy(sun.target.position).addScaledVector(lightDir,76);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
      sun.shadow.camera.updateProjectionMatrix();
      sun.shadow.needsUpdate=true;
    }
    if(nearDue){
      if(coverage.nearExtent!==nearShadowRadius){
        nearShadowRadius=coverage.nearExtent;
        const extent=coverage.nearExtent;
        Object.assign(nearSun.shadow.camera,{
          left:-extent,right:extent,top:extent,bottom:-extent,
          far:Math.max(120,96+nearRadius*2),
        });
      }
      if(nearCastersDirty){
        nearCasterX=x;nearCasterZ=z;
        refreshCasters(x,z,radius,coverage,false);
      }
      const extent=coverage.nearExtent;
      const center=cascadeTexelCenter(x,z,lightDir,extent*2,cascade.nearSize);
      nearSun.target.position.set(center.x,center.y,center.z);
      nearSun.position.copy(nearSun.target.position).addScaledVector(lightDir,76);
      nearSun.target.updateMatrixWorld();
      nearSun.updateMatrixWorld();
      nearSun.shadow.camera.updateProjectionMatrix();
      nearSun.shadow.needsUpdate=true;
    }
    if(treeDue||nearCastersDirty)syncTreeShadowFlags();
    lastCasterMode=casterMode;
    builtShadowsDirty=false;
    lightingChanged=false;
  }
  function restore() {
    setPhase(0);
  }
  function dispose(){
    for(const tree of new Set([...nearTrees,...farTrees]))
      for(const mesh of tree.children)mesh.castShadow=false;
    nearTrees.clear();
    farTrees.clear();
    shadowEnabledTrees.clear();
    farShadowScene.children=[];
    nearShadowScene.children=[];
    localPointShadowScene.children=[];
    renderer.shadowMap.render=originalShadowRender;
    scene.remove(dome,sunBody,moonBody,nearSun,nearSun.target);
    dome.geometry.dispose();
    skyMaterial.dispose();
    bodyGeometry.dispose();
    solarMaterial.dispose();
    lunarMaterial.dispose();
    ground.receiveShadow=false;
    nearSun.shadow.dispose();
    hemisphere.intensity=initialAmbientIntensity;
    sun.intensity=initialSunIntensity;
    renderer.shadowMap.autoUpdate=false;
  }
  setPhase(0);
  return {tick,setPhase,restore,dispose,setSunIntensity,setAmbientIntensity,dome,sunBody,moonBody,nearSun,
    invalidateStaticShadows(){builtShadowsDirty=true;staticShadowRevision++;},
    get staticShadowRevision(){return staticShadowRevision;},
    get lightDirection(){return lightDir;},
    get sunIntensity(){return totalSunIntensity;},
    get ambientIntensity(){return baseAmbientIntensity;},
    get phase(){return phase;},get shadowCasters(){return farTrees.size;},
    get decorShadowCasters(){return farShadowScene.children.length-farTrees.size;}};
}
