// Lightweight local atmosphere and a bounded shadow budget for trees.
// Everything is cosmetic: no network state, world generation, or time sync.
export const SHADOW_TREE_LIMIT = 34;
export const SHADOW_TREE_RADIUS = 39;
export const SHADOW_UPDATE_MS = 260;
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

export function createAtmosphere({THREE,renderer,scene,camera,sun,ground,settings,trees}) {
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

  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate=false;
  sun.castShadow=true;
  sun.shadow.bias=-.00012;
  sun.shadow.normalBias=.035;
  sun.shadow.radius=2.2;
  sun.shadow.camera.left=-45;
  sun.shadow.camera.right=45;
  sun.shadow.camera.top=45;
  sun.shadow.camera.bottom=-45;
  sun.shadow.camera.near=.5;
  sun.shadow.camera.far=190;
  sun.shadow.camera.updateProjectionMatrix();
  ground.receiveShadow=true;
  scene.add(sun.target);
  let quality=null, phase=0, lastUpdate=-Infinity, centerX=Infinity,centerZ=Infinity;
  let lightingChanged=true;
  const activeTrees=new Set();
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
    const daylight=Math.max(0,Math.min(1,(dirs.sun.y+.16)/.42));
    const night=1-(daylight*daylight*(3-2*daylight));
    skyMaterial.uniforms.horizon.value.copy(scene.background);
    skyMaterial.uniforms.zenith.value.copy(zenithDay).lerp(zenithNight,night);
    skyMaterial.uniforms.night.value=night;
    sunBody.visible=dirs.sun.y>-.10;
    moonBody.visible=dirs.moon.y>-.10;
    // A single directional light doubles as cool moonlight at night; this
    // keeps the shadow map count at one and aligns it with the visible body.
    const source=dirs.sun.y>=0 ? dirs.sun : dirs.moon;
    lightDir.set(source.x,Math.max(.16,source.y),source.z).normalize();
    lightingChanged=true;
  }
  function refreshCasters(x,z) {
    const next=new Set(selectShadowTrees(trees,x,z));
    for(const tree of activeTrees)if(!next.has(tree)){
      for(const mesh of tree.children)mesh.castShadow=false;
    }
    for(const tree of next)if(!activeTrees.has(tree)){
      for(const mesh of tree.children)mesh.castShadow=true;
    }
    activeTrees.clear();
    for(const tree of next)activeTrees.add(tree);
  }
  function tick(now,x,z) {
    dome.position.copy(camera.position);
    sunBody.position.copy(camera.position).addScaledVector(sunVector,210);
    moonBody.position.copy(camera.position).addScaledVector(moonVector,210);
    if(now-lastUpdate<SHADOW_UPDATE_MS &&
      Math.hypot(x-centerX,z-centerZ)<2 && !lightingChanged)return;
    lastUpdate=now;
    centerX=x;centerZ=z;
    applyQuality();
    refreshCasters(x,z);
    // Shadows track the player rather than spending resolution on distant forest.
    targetPosition.set(x,0,z);
    sun.target.position.copy(targetPosition);
    sun.position.copy(targetPosition).addScaledVector(lightDir,76);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    sun.shadow.camera.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate=true;
    lightingChanged=false;
  }
  function restore() {
    setPhase(0);
  }
  function dispose(){
    for(const tree of activeTrees)for(const mesh of tree.children)mesh.castShadow=false;
    activeTrees.clear();
    scene.remove(dome,sunBody,moonBody);
    dome.geometry.dispose();
    skyMaterial.dispose();
    bodyGeometry.dispose();
    solarMaterial.dispose();
    lunarMaterial.dispose();
    ground.receiveShadow=false;
  }
  setPhase(0);
  return {tick,setPhase,restore,dispose,dome,sunBody,moonBody,
    get phase(){return phase;},get shadowCasters(){return activeTrees.size;}};
}
