// Lightweight local atmosphere and a bounded shadow budget for trees.
// Everything is cosmetic: no network state, world generation, or time sync.
import {snapCharacterShadowCenter,CHARACTER_SHADOW_PROXY_EXTRA} from './character-shadow-lod.js?v=20261030-character-shadow-range1';
export const SHADOW_TREE_LIMIT = 34;
export const SHADOW_TREE_RADIUS = 60;
export const SHADOW_UPDATE_MS = 1000;
export const SHADOW_MAX_TREE_LIMIT = 480;
export const SHADOW_DECOR_LIMIT = 200;
export const SHADOW_MAP_SIZES = Object.freeze({low:512,balanced:1024,high:2048});
// Half-extent: 30 metres in each direction = 60x60m shadow coverage.
export const CHARACTER_SHADOW_RADIUS = 30;
export const CHARACTER_SHADOW_MAP_SIZES = Object.freeze({low:512,balanced:1024,high:2048});

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

// The nearest trees cast shadows; culled trees never enter the expensive pass.
// Return stable tree references instead of owning/recreating their geometry.
export function selectShadowTrees(trees, x, z, radius=SHADOW_TREE_RADIUS,
  limit=SHADOW_TREE_LIMIT) {
  const nearby=[];
  const maxDistSq=radius*radius;
  for (const tree of trees.values()) {
    const dx=tree.position.x-x,dz=tree.position.z-z;
    const distanceSq=dx*dx+dz*dz;
    if(distanceSq<=maxDistSq)nearby.push({tree,distanceSq});
  }
  nearby.sort((a,b)=>a.distanceSq-b.distanceSq);
  return nearby.slice(0,limit).map(item=>item.tree);
}

export function createAtmosphere({THREE,renderer,scene,camera,sun,hemisphere,ground,settings,trees,
  getCharacterShadowCasters=()=>[],getDecorShadowCasters=()=>[]}) {
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

  // Static forest is cached; actual animated character silhouettes are drawn
  // every rendered frame. PCF-soft filtering applies to both maps.
  const initialSunIntensity=sun.intensity;
  const initialAmbientIntensity=hemisphere.intensity;
  const characterLight=new THREE.DirectionalLight(sun.color,initialSunIntensity*.5);
  scene.add(characterLight,characterLight.target);
  for(const light of [sun,characterLight,hemisphere]){
    light?.layers.enable(1); // remote characters
    light?.layers.enable(3); // local character, hidden in first person
  }
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate=true;
  sun.castShadow=true;
  sun.shadow.autoUpdate=false;
  characterLight.castShadow=true;
  characterLight.shadow.autoUpdate=false;
  characterLight.shadow.bias=-.00012;
  characterLight.shadow.normalBias=.035;
  characterLight.shadow.radius=1.6;
  const characterCamera=characterLight.shadow.camera;
  characterCamera.left=-CHARACTER_SHADOW_RADIUS;
  characterCamera.right=CHARACTER_SHADOW_RADIUS;
  characterCamera.top=CHARACTER_SHADOW_RADIUS;
  characterCamera.bottom=-CHARACTER_SHADOW_RADIUS;
  characterCamera.near=.5;
  characterCamera.far=100;
  characterCamera.updateProjectionMatrix();

  // Three.js r170 uses the *view camera* layers during shadow map rendering,
  // not the shadow camera layers. We give each light only its actual casters.
  // This avoids traversing the forest on every character shadow update.
  const treeShadowScene=new THREE.Group();
  const characterShadowScene=new THREE.Group();
  const originalShadowRender=renderer.shadowMap.render;
  renderer.shadowMap.render=function(lights,shadowScene,viewCamera){
    const oldMask=viewCamera.layers.mask;
    try{
      for(const light of lights){
        if(light.shadow?.autoUpdate===false && !light.shadow.needsUpdate)continue;
        if(light===sun){
          viewCamera.layers.mask=1; // tree meshes only
          originalShadowRender.call(this,[light],treeShadowScene,viewCamera);
        }else if(light===characterLight){
          characterShadowScene.children=getCharacterShadowCasters(CHARACTER_SHADOW_RADIUS);
          viewCamera.layers.mask=(1<<1)|(1<<3)|(1<<4); // remote, local, shadow-only LOD
          originalShadowRender.call(this,[light],characterShadowScene,viewCamera);
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
  let quality=null, phase=0, lastUpdate=-Infinity, centerX=Infinity,centerZ=Infinity;
  let shadowRadius=null, refreshInterval=null, characterShadowExtent=null;
  let totalSunIntensity=initialSunIntensity;
  let baseAmbientIntensity=initialAmbientIntensity;
  function setAmbientIntensity(value){
    baseAmbientIntensity=value;
    const contrast=Math.max(0,Math.min(100,settings.shadowContrast??70));
    hemisphere.intensity=value*(1-.65*contrast/100);
  }
  setAmbientIntensity(baseAmbientIntensity);
  let characterShadowsEnabled=true;
  function setSunIntensity(total){
    totalSunIntensity=total;
    sun.intensity=characterShadowsEnabled?total*.5:total;
    characterLight.intensity=characterShadowsEnabled?total*.5:0;
  }
  setSunIntensity(initialSunIntensity);
  let lightingChanged=true;
  const activeTrees=new Set();
  const activeDecor=new Set();
  const zenithDay=new THREE.Color(0x78b0d0);
  const zenithNight=new THREE.Color(0x101a34);
  const targetPosition=new THREE.Vector3();
  const lightDir=new THREE.Vector3();
  const sunVector=new THREE.Vector3();
  const moonVector=new THREE.Vector3();

  function applyQuality() {
    if(quality===settings.quality)return;
    quality=settings.quality;
    const size=shadowMapSizeForQuality(quality);
    sun.shadow.mapSize.set(size,size);
    const characterSize=CHARACTER_SHADOW_MAP_SIZES[quality]??CHARACTER_SHADOW_MAP_SIZES.balanced;
    characterLight.shadow.mapSize.set(characterSize,characterSize);
    if(characterLight.shadow.map){
      characterLight.shadow.map.dispose();
      characterLight.shadow.map=null;
    }
    if(sun.shadow.map){
      sun.shadow.map.dispose();
      sun.shadow.map=null;
    }
    lightingChanged=true;
  }
  function setPhase(value=0) {
    phase=Number.isFinite(value)?((value%1)+1)%1:0;
    const dirs=celestialDirections(phase);
    sunVector.set(dirs.sun.x,dirs.sun.y,dirs.sun.z);
    moonVector.set(dirs.moon.x,dirs.moon.y,dirs.moon.z);
    skyMaterial.uniforms.sunDir.value.copy(sunVector);
    characterLight.color.copy(sun.color);
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
  function refreshCasters(x,z,radius) {
    // Expand the caster budget with the *area*: keeping a fixed 34-tree cap
    // would leave most of a 100 m shadow circle empty.
    const limit=Math.min(SHADOW_MAX_TREE_LIMIT,Math.max(SHADOW_TREE_LIMIT,
      Math.ceil(Math.PI*radius*radius/68)));
    const next=new Set(selectShadowTrees(trees,x,z,radius,limit));
    for(const tree of activeTrees)if(!next.has(tree)){
      for(const mesh of tree.children)mesh.castShadow=false;
    }
    for(const tree of next)if(!activeTrees.has(tree)){
      for(const mesh of tree.children)mesh.castShadow=true;
    }
    activeTrees.clear();
    for(const tree of next)activeTrees.add(tree);
    activeDecor.clear();
    for(const decoration of getDecorShadowCasters(x,z,radius,SHADOW_DECOR_LIMIT))
      activeDecor.add(decoration);
    treeShadowScene.children=[...activeTrees,...activeDecor];
  }
  function tick(now,x,z) {
    dome.position.copy(camera.position);
    sunBody.position.copy(camera.position).addScaledVector(sunVector,210);
    moonBody.position.copy(camera.position).addScaledVector(moonVector,210);
    const radius=Math.max(20,Math.min(100,settings.shadowDistance??SHADOW_TREE_RADIUS));
    const interval=Math.max(1000,Math.min(5000,
      (settings.shadowRefreshSeconds??SHADOW_UPDATE_MS/1000)*1000));
    const settingsChanged=radius!==shadowRadius || interval!==refreshInterval ||
      quality!==settings.quality;
    const treeDue=settingsChanged || now-lastUpdate>=interval;
    // Apply the map size before snapping its centre to texels.
    if(quality!==settings.quality)applyQuality();
    const wantCharacters=settings.characterShadowsEnabled!==false;
    if(characterShadowsEnabled!==wantCharacters){
      characterShadowsEnabled=wantCharacters;
      characterLight.castShadow=wantCharacters;
      characterLight.visible=wantCharacters;
      characterLight.shadow.needsUpdate=false;
      setSunIntensity(totalSunIntensity);
    }
    // Update the ambient component every rendered frame, including while the
    // day/night cycle is paused, so the contrast slider applies immediately.
    setAmbientIntensity(baseAmbientIntensity);
    // Scale the shadow frustum with the selected full-detail radius. The next
    // 16 metres are used by proxy shadows, plus a small projection margin.
    if(characterShadowsEnabled){
      const detailedRadius=Math.max(10,Math.min(100,
        settings.characterShadowDistance??CHARACTER_SHADOW_RADIUS));
      const extent=detailedRadius+CHARACTER_SHADOW_PROXY_EXTRA+8;
      if(extent!==characterShadowExtent){
        characterShadowExtent=extent;
        Object.assign(characterCamera,{
          left:-extent,right:extent,top:extent,bottom:-extent,
          far:Math.max(120,extent*3+50),
        });
        characterCamera.updateProjectionMatrix();
      }
      const center=snapCharacterShadowCenter(x,z,lightDir,
        extent*2,characterLight.shadow.mapSize.x);
      characterLight.target.position.set(center.x,center.y,center.z);
      characterLight.position.copy(characterLight.target.position)
        .addScaledVector(lightDir,Math.max(35,characterShadowExtent*1.2));
      characterLight.target.updateMatrixWorld();
      characterLight.updateMatrixWorld();
      characterLight.shadow.needsUpdate=true;
    }
    // Tree map still updates only once per selected 1–5s interval.
    if(!treeDue)return;
    // Refresh on schedule even while the local player stands still:
    // remote players (and idle animations) can keep moving independently.
    lastUpdate=now;
    centerX=x;centerZ=z;
    if(radius!==shadowRadius){
      shadowRadius=radius;
      const extent=radius+12;
      Object.assign(sun.shadow.camera,{
        left:-extent,right:extent,top:extent,bottom:-extent,
        far:Math.max(190,96+radius*2),
      });
    }
    refreshInterval=interval;
    refreshCasters(x,z,radius);
    // Shadows track the player rather than spending resolution on distant forest.
    targetPosition.set(x,0,z);
    sun.target.position.copy(targetPosition);
    sun.position.copy(targetPosition).addScaledVector(lightDir,76);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.needsUpdate=true;
    lightingChanged=false;
  }
  function restore() {
    setPhase(0);
  }
  function dispose(){
    for(const tree of activeTrees)for(const mesh of tree.children)mesh.castShadow=false;
    activeTrees.clear();
    activeDecor.clear();
    treeShadowScene.children=[];
    characterShadowScene.children=[];
    renderer.shadowMap.render=originalShadowRender;
    scene.remove(dome,sunBody,moonBody,characterLight,characterLight.target);
    dome.geometry.dispose();
    skyMaterial.dispose();
    bodyGeometry.dispose();
    solarMaterial.dispose();
    lunarMaterial.dispose();
    ground.receiveShadow=false;
    characterLight.shadow.dispose();
    hemisphere.intensity=initialAmbientIntensity;
    sun.intensity=initialSunIntensity;
    renderer.shadowMap.autoUpdate=false;
  }
  setPhase(0);
  return {tick,setPhase,restore,dispose,setSunIntensity,setAmbientIntensity,dome,sunBody,moonBody,characterLight,
    get lightDirection(){return lightDir;},
    get sunIntensity(){return totalSunIntensity;},
    get ambientIntensity(){return baseAmbientIntensity;},
    get phase(){return phase;},get shadowCasters(){return activeTrees.size;},
    get decorShadowCasters(){return activeDecor.size;}};
}
