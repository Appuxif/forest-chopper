import {createRagdoll} from './ragdoll.js?v=20261103-ragdoll-save-recovery1';
import {createRagdollControls} from './ragdoll-controls.js?v=20261103-ragdoll-save-recovery1';
import {createAnimations} from './animations.js?v=20261102-chop-frame18';
import {createWorld} from './world.js?v=20261103-region-default-3';
import {generateSpruceParts} from './spruce-model.js?v=20261103-shared-birch-all1';
import {generateBirchParts} from './birch-model.js?v=20261103-shared-birch-all1';
import {createTreeWindShader} from './tree-wind-shader.js?v=20261031-gpu-bending1';
import {readActiveTreeConfig,limitTreeModelTriangles} from './tree-model-config.js?v=20261103-shared-birch-all1';
import {createSpruceDiagnostics} from './spruce-diagnostics.js?v=20261031-spruce-bark1';
import {detachTreeForFall} from './tree-instancing.js?v=20261031-spruce-sway1';
import {createMushrooms} from './mushrooms.js';
import {createFlowers} from './flowers.js';
import {createGrass} from './grass.js';
import {createMicroGrass} from './micro-grass.js?v=20261103-grass-unbounded1';
import {createGroundTexture,enableGrassDensityShadows} from './ground-texture.js?v=20261031-sandy-shores1';
import {TerrainSystem} from './terrain.js?v=20261102-night-grass30';
import {createPhysics} from './physics.js?v=20261103-debug-player1';
import {createFallTracker,applyFallImpact} from './fall-damage.js?v=20261102-bounce-fix1';
import {createCollisionWorld} from './collision-world.js?v=20261102-collision-world1';
import {createBuilding} from './building.js?v=20261102-build-height1';
import {createChopping} from './chopping.js?v=20261102-chop-current-target1';
import {createControls} from './controls.js?v=20261104-save-slots1';
import {createPlayer} from './player.js?v=20261103-grass-culling1';
import {createMultiplayer} from './multiplayer.js?v=20261103-decor-region2';
import {createMinimap} from './minimap.js?v=20261102-ragdoll-sleep1';
import {createNotifications} from './notifications.js';
import {createSettings} from './settings.js?v=20261103-grass-presets-tuned1';
import {createGameAudio} from './game-audio.js?v=20261102-treefall-sync13';
import {applyQuality} from './quality.js';
import {createWind} from './wind.js?v=20261031-spruce-sway1';
import {createLandmarks} from './landmarks.js?v=20261103-distant-fire-billboard20';
import {createPlantInteraction} from './plant-interaction.js?v=20261103-decor-region2';
import {selectDecorShadowCasters} from './decor-shadows.js?v=20261103-decor-region2';
import {createDayCycle} from './day-cycle.js?v=20261103-night-horizon-black1';
import {createAtmosphere} from './atmosphere.js?v=20261103-render-profiler1';
import {selectCharacterShadowCasters} from './character-shadow-lod.js?v=20261030-character-shadow-range1';
import {createEmotes} from './emotes.js';
import {createPlayerList} from './player-list.js';
import {createCrafting} from './crafting.js?v=20261102-collision-world1';
import {createInteractionHighlight} from './interaction-highlight.js';
import {createDiscoveries} from './discoveries.js';
import {createCommunityGoal} from './community-goal.js';
import {createOfflineSave} from './offline-save.js?v=20261104-save-slots1';
import {createTutorial} from './tutorial.js';
import {createProgress,resetWorldProgress} from './progress.js?v=20261101-menu-world-progress1';
import {createInventory} from './inventory-ui.js?v=20261102-ragdoll-sleep1';
import {createStorages} from './storages.js?v=20261102-collision-world1';
import {createCampStructures} from './camp-structures.js?v=20261103-distant-fire-billboard20';
import {createVitalsUI} from './vitals-ui.js?v=20261102-debug-cheats';
import {createForestResources} from './forest-resources.js?v=20261103-decor-region2';
import {createGroundBoxes} from './ground-boxes.js?v=20261104-save-slots1';
import {createWaterSplashes} from './water-splashes.js?v=20261031-droplets-only1';
import {WorldTaskScheduler} from './world-task-scheduler.js';
import {createWorldStartupGate} from './world-startup.js';
import {installGameLeaveGuard} from './leave-guard.js?v=20261103-guard1';
import {createPickupInteraction} from './pickup-interaction.js?v=20261102-audio1';
import {createDeathSystem} from './death.js?v=20261103-ragdoll-save-recovery1';

// Read and consume launch mode before touching any saved game data.
const MENU_LAUNCH_KEY='forest-chopper:launch:v1';
let menuLaunch={mode:'continue'};
try{
  const supplied=globalThis.__forestLaunch;
  const value=supplied??JSON.parse(sessionStorage.getItem(MENU_LAUNCH_KEY)||'null');
  delete globalThis.__forestLaunch;
  sessionStorage.removeItem(MENU_LAUNCH_KEY);
  if(value&&['continue','new','online'].includes(value.mode))menuLaunch=value;
}catch{}
const $=id=>document.getElementById(id),host=$('game'),loading=$('load');let THREE;try{THREE=await import('https://esm.sh/three@0.170.0')}catch(e){loading.innerHTML='<b>Не удалось загрузить Three.js</b><span>Для первого запуска требуется интернет.</span>';throw e}


const {modelActors,CHOP_SPEED,createLumberjack,actorChop,tickActor,rootMotion}=await createAnimations(THREE);
const treeModels=readActiveTreeConfig();
let spruceParts=generateSpruceParts(treeModels.models.spruce);
let birchParts=generateBirchParts(treeModels.models.birch);
// Same procedural tree generators and textures, with a small fixed triangle
// budget for the visible horizon. Generate once, reuse via InstancedMesh.
const originalSpruce=treeModels.models.spruce;
let distantSpruceParts=generateSpruceParts({
  ...originalSpruce,
  generatorQuality:'low',
  whorls:Math.min(11,originalSpruce.whorls),
  branchesPerWhorl:originalSpruce.branchesPerWhorl
    .slice(0,11).map(count=>Math.max(0,Math.round(count*.7))),
  showSecondaryBranches:false,
  maxTriangles:2000,
});
const originalBirch=treeModels.models.birch;
let distantBirchParts=generateBirchParts({
  ...originalBirch,
  branchCount:Math.min(16,originalBirch.branchCount),
  showShootWood:false,
  maxTriangles:1200,
});
let distantTreeParts={conifer:distantSpruceParts,birch:distantBirchParts};
const treeWindShader=createTreeWindShader({motionQuery:typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):{matches:false}});
let ownAvatar=null,thirdPerson=true,ragdoll=null,ragdollControls=null,ragdollCamera=null;
let refreshPerformance=()=>{};
const scene=new THREE.Scene();scene.background=new THREE.Color(0xa4c8be);scene.fog=new THREE.FogExp2(0xa4c8be,.012);
let initialAntialias=true;
try{
  const saved=JSON.parse(localStorage.getItem('forest-chopper:settings:v1')||'null');
  if(typeof saved?.antialias==='boolean')initialAntialias=saved.antialias;
}catch{}
const camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.1,280);camera.rotation.order='YXZ';const renderer=new THREE.WebGLRenderer({antialias:initialAntialias,powerPreference:'default'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;host.prepend(renderer.domElement);
const hemisphere=new THREE.HemisphereLight(0xe1efff,0x45552b,1.2);scene.add(hemisphere);const sun=new THREE.DirectionalLight(0xffe4a6,2);sun.position.set(35,75,20);scene.add(sun);
const groundTexture=createGroundTexture(THREE,document,renderer);
const groundMaterial=new THREE.MeshLambertMaterial({map:groundTexture});
enableGrassDensityShadows(THREE,groundMaterial);
const terrain=new TerrainSystem(THREE,{scene,camera,material:groundMaterial});
const worldStreamer=new WorldTaskScheduler({
  workerUrl:new URL('./world-stream-worker.js',import.meta.url),
  workers:2,applyPerTick:2,applyMs:2,
});
terrain.setScheduler(worldStreamer);

const ground=terrain.group;
const trunkGeo=new THREE.CylinderGeometry(.38,.6,1,9),leafGeo=new THREE.ConeGeometry(1,1,8),rockGeo=new THREE.DodecahedronGeometry(1,0);
// The tiny octahedron is still shared by campfire sparks, not used as flower art.
const flowerGeo=new THREE.OctahedronGeometry(.24,0);
const mushrooms=createMushrooms(THREE);
const flowers=createFlowers(THREE); // Shared stalks, petals and centres; no per-chunk GPU allocations.
const grasses=createGrass(THREE); // One shared vertex-colored mesh per tuft; four silhouettes.
// Birch uses one shared low-poly crown geometry and a single bark texture for all trees.
const birchLeafGeo=new THREE.IcosahedronGeometry(1,1);
const trunkMats=[0x65442e,0x795339,0x543925].map(color=>new THREE.MeshLambertMaterial({color}));const leafMats=[0x214c30,0x30683a,0x3a7141,0x285e46].map(color=>new THREE.MeshLambertMaterial({color}));const rockMat=new THREE.MeshLambertMaterial({color:0x808478});
const rareLeafMat=new THREE.MeshLambertMaterial({color:0xb1ced2}); // Shared frosty foliage, cosmetic only.
const birchLeafMats=[0x6fa54b,0x83b753,0x98c367].map(color=>new THREE.MeshLambertMaterial({color}));
const barkCanvas=document.createElement('canvas');barkCanvas.width=256;barkCanvas.height=512;
const barkCtx=barkCanvas.getContext('2d');
barkCtx.fillStyle='#eeeae0';barkCtx.fillRect(0,0,256,512);
// Fixed short dark horizontal lenticels, painted into the texture, never as damage overlays.
for(let i=0;i<68;i++){
 const x=(i*73+i*i%47)%256,y=(i*119+i*i%73)%512;
 const width=7+i*13%23,height=2+i%3;
 barkCtx.fillStyle=i%4===0?'#8e9289':'#414942';
 barkCtx.fillRect(x,y,width,height);
 barkCtx.fillRect(x+2,y+height,Math.max(3,Math.floor(width/3)),1);
}
const birchBarkTexture=new THREE.CanvasTexture(barkCanvas);birchBarkTexture.colorSpace=THREE.SRGBColorSpace;
const birchTrunkMat=new THREE.MeshLambertMaterial({map:birchBarkTexture});
const trees=new Map(),chunks=new Map(),rockColliders=new Map(),felled=new Set(),falling=[],particles=[],keys={},treeDamage=new Map();let seed=menuLaunch.mode==='new'&&Number.isInteger(menuLaunch.seed)&&menuLaunch.seed>=0&&menuLaunch.seed<=999998?menuLaunch.seed:((Math.random()*999999)|0),px=0,pz=0,yaw=0,pitch=0,wood=0,cuts=0,joyX=0,joyY=0,swing=0,lastHit=0,drag=null,frame=0,lastTime=performance.now();const chunkSize=24;terrain.setSeed(seed);

scene.add(camera);const axe=new THREE.Group();camera.add(axe);const handle=new THREE.Mesh(new THREE.CylinderGeometry(.045,.065,1.3,8),new THREE.MeshLambertMaterial({color:0x99623b}));handle.rotation.z=-.2;axe.add(handle);const metal=new THREE.MeshStandardMaterial({color:0xc2cbd0,metalness:.65,roughness:.35});const head=new THREE.Mesh(new THREE.BoxGeometry(.48,.32,.15),metal);head.position.set(-.18,.58,0);axe.add(head);const blade=new THREE.Mesh(new THREE.CylinderGeometry(.26,.26,.15,3),metal);blade.rotation.x=Math.PI/2;blade.rotation.z=Math.PI/2;blade.position.set(-.44,.58,0);axe.add(blade);axe.position.set(.72,-.7,-1.1);axe.rotation.z=-.25;

// All logs (placed and fallen) are 3 m and snap to a 0.5 m 3D construction grid.
const placed=[],logRadius=.29,logLength=3;
const logGeo=new THREE.CylinderGeometry(logRadius,logRadius,logLength,10);
const fallenLogGeo=logGeo;
const logMat=new THREE.MeshLambertMaterial({color:0x92613a});
const endMat=new THREE.MeshLambertMaterial({color:0xd6ac72});
let deathSystem=null;let buildMode=false,orientation=0,preview=null,placement=null,buildOffset={x:0,z:0,height:0};
// Feet-based, lightweight collision physics for the shared log construction.
let feetY=0,verticalSpeed=0,onGround=true,jumpRequested=false;
const PLAYER_RADIUS=.31,PLAYER_HEIGHT=1.7,GRAVITY=19,JUMP_SPEED=7.5;

// Multiplayer: authoritative server state, client-side rendering.
let socket=null,myId=null,lastMoveSent=0;const avatars=new Map();
const notifications=createNotifications();
let gameAudio=null;
const settings=createSettings(document,null,
  fov=>{camera.fov=fov;camera.updateProjectionMatrix();},
  quality=>applyQuality(renderer,quality,devicePixelRatio,innerWidth,innerHeight),
  {spruce:spruceParts?.stats,birch:birchParts?.stats},
  ()=>refreshPerformance(),
  (category,exact=false)=>exact?gameAudio?.previewClip(category):gameAudio?.preview(category));
const atmosphere=createAtmosphere({
 THREE,renderer,scene,camera,sun,hemisphere,ground,settings,trees,
 getCharacterShadowCasters(){
  return selectCharacterShadowCasters(ownAvatar,avatars.values(),px,pz,
    {near:settings.characterShadowDistance});
 },
 getDecorShadowCasters(x,z,radius,limit){
  return selectDecorShadowCasters(chunks,x,z,radius,limit,ctx.decorBatchRegions);
 },
 getBuiltShadowCasters(x,z,radius){
  const result=[];
  for(const item of crafting?.items?.values()??[]){
   if(Math.hypot(item.x-x,item.z-z)<radius+3)result.push(item.group);
  }
  for(const item of campStructures?.items?.values()??[]){
   if(Math.hypot(item.x-x,item.z-z)<radius+3)result.push(item.group);
  }
  for(const item of placed){
   if(item.mesh?.castShadow && Math.hypot(item.x-x,item.z-z)<radius+3)
    result.push(item.mesh);
  }
  return result;
 },
 getDistantShadowCasters(x,z,minRadius,maxRadius){
  return ctx.distantForest?.getShadowCasters?.(x,z,minRadius,maxRadius,18)??[];
 },
 getPointShadowCasters(light){
  if(!light.parent)return [];
  const pos=light.getWorldPosition(new THREE.Vector3());
  const x=pos.x,z=pos.z,r=Math.min(light.distance,
    light.userData?.shadowCasterRange??light.distance);
  const casters=[];
   casters.push(...selectDecorShadowCasters(chunks,x,z,r,36,ctx.decorBatchRegions));
   const batches=new Set();
   for(const tree of trees.values()){
    if(Math.hypot(tree.position.x-x,tree.position.z-z)>=r+3 || casters.length>=52)continue;
    if(tree.userData.treeBatch){
     for(const mesh of tree.userData.treeBatch.meshes)batches.add(mesh);
    }else casters.push(tree);
   }
   casters.push(...batches);
   for(const item of crafting?.items?.values()??[]){
    if(Math.hypot(item.x-x,item.z-z)<r+3)casters.push(item.group);
   }
   for(const item of campStructures?.items?.values()??[]){
    if(Math.hypot(item.x-x,item.z-z)<r+3)casters.push(item.group);
   }
   for(const log of placed){
    if(Math.hypot(log.x-x,log.z-z)<r+2 && log.mesh?.castShadow)
     casters.push(log.mesh);
   }
  // A freshly built cached map may omit characters, while previously
  // rendered moving silhouettes are deliberately preserved when frozen.
  if(!light.userData?.shadowFrozen){
   if(Math.hypot(px-x,pz-z)<r+2 && ownAvatar?.shadowMeshes)
    casters.push(...ownAvatar.shadowMeshes);
   for(const avatar of avatars.values()){
    if(Math.hypot(avatar.group.position.x-x,avatar.group.position.z-z)<r+2)
     casters.push(...(avatar.actor?.shadowMeshes??avatar.shadowMeshes??[]));
   }
  }
  return casters;
 },
});
const dayCycle=createDayCycle({THREE,scene,hemisphere,sun,settings,atmosphere,terrain});
if(menuLaunch.mode==='new'){
  try{
    // Reset only after the render engine has successfully initialized.
    resetWorldProgress(localStorage);
    localStorage.removeItem('forest-chopper:tutorial:v1');
  }catch{}
}
const tutorial=createTutorial({notify:notifications.notify});
let offlineSave=null,progress=null,inventory=null,vitals=null,forestResources=null,groundBoxes=null;
let pickupInteraction=null,storages=null,campStructures=null;
let worldStartupGate=null;

const fallTracker=createFallTracker();
let fallImpactSpeed=0;
let collisionWorld=null;
let distantForest, replaceTreeModels, ragdollStandingSupport, addAvatar, addLog, aimed, animate, blocksPlayerAt, build, candidate, chop, tickChopImpact, acknowledgeLocalChop, resetChop, clearWorld, closeNet, disposePreview, updatePing, isOnline, logBottom, logFootprint, logTop, look, makeLog, makeTree, moveHorizontal, overlaps, placeError, placeLog, nudgeLog, rotateLog, rand, removeAvatar, removeLog, requestJump, sendChat, sendMapPing, sendEmote, showMapPing, clearMapPings, chatHistory, sendNet, setMode, simulateVertical, spawnChips, syncWood, toggleView, treeFell, treeHit, updateChunks, updatePreview;
const ctx={
 logsCollected:0,
 get $(){return $;},
 get chatHistory(){return chatHistory;},
 get clearMapPings(){return clearMapPings;},
 get sendChat(){return sendChat;},
 get sendMapPing(){return sendMapPing;},
 get sendEmote(){return sendEmote;},
 get emotes(){return emotes;},
 get playerList(){return playerList;},
 get crafting(){return crafting;},
 get campStructures(){return campStructures;},
 get inventory(){return inventory;},
 get storages(){return storages;},
 get vitals(){return vitals;},
 get deathSystem(){return deathSystem;},
 get forestResources(){return forestResources;},
 get groundBoxes(){return groundBoxes;},
 get pickupInteraction(){return pickupInteraction;},
 get highlight(){return highlight;},
 get discoveries(){return discoveries;},
 get communityGoal(){return communityGoal;},
 get showMapPing(){return showMapPing;},
 get CHOP_SPEED(){return CHOP_SPEED;},
 get GRAVITY(){return GRAVITY;},
 get JUMP_SPEED(){return JUMP_SPEED;},
 get PLAYER_HEIGHT(){return PLAYER_HEIGHT;},
 get PLAYER_RADIUS(){return PLAYER_RADIUS;},
 get THREE(){return THREE;},
 get actorChop(){return actorChop;},
 get addAvatar(){return addAvatar;},
 get addLog(){return addLog;},
 get aimed(){return aimed;},
 get animate(){return animate;},
 get avatars(){return avatars;},
 get axe(){return axe;},
 get birchLeafGeo(){return birchLeafGeo;},
 get birchLeafMats(){return birchLeafMats;},
 get birchTrunkMat(){return birchTrunkMat;},
 get detachTreeForFall(){return tree=>detachTreeForFall(ctx,tree);},
 get blade(){return blade;},
 get blocksPlayerAt(){return blocksPlayerAt;},
 get build(){return build;},
 get buildMode(){return buildMode;}, set buildMode(value){buildMode=value;},
 get camera(){return camera;},
 get candidate(){return candidate;},
 get chop(){return chop;},
 get tickChopImpact(){return tickChopImpact;},
 get acknowledgeLocalChop(){return acknowledgeLocalChop;},
 get resetChop(){return resetChop;},
 get chunkSize(){return chunkSize;},
 get chunks(){return chunks;},
 get clearWorld(){return clearWorld;},
 get closeNet(){return closeNet;},
 get createLumberjack(){return createLumberjack;},
 get disposePreview(){return disposePreview;},
 get cuts(){return cuts;}, set cuts(value){cuts=value;},
 get dayCycle(){return dayCycle;},
 get atmosphere(){return atmosphere;},
 get drag(){return drag;}, set drag(value){drag=value;},
 get endMat(){return endMat;},
 get falling(){return falling;},
 get feetY(){return feetY;}, set feetY(value){feetY=value;},
 get felled(){return felled;},
 get frame(){return frame;}, set frame(value){frame=value;},
 get flowerGeo(){return flowerGeo;},
 get flowers(){return flowers;},
 get grasses(){return grasses;},
 get ground(){return ground;},
 get terrain(){return terrain;},
 get worldStreamer(){return worldStreamer;},
 get worldStartupGate(){return worldStartupGate;},
 get handle(){return handle;},
 get head(){return head;},
 get host(){return host;},
 get isOnline(){return isOnline;},
 get joyX(){return joyX;}, set joyX(value){joyX=value;},
 get joyY(){return joyY;}, set joyY(value){joyY=value;},
 get jumpRequested(){return jumpRequested;}, set jumpRequested(value){jumpRequested=value;},
 get keys(){return keys;},
 get lastHit(){return lastHit;}, set lastHit(value){lastHit=value;},
 get lastMoveSent(){return lastMoveSent;}, set lastMoveSent(value){lastMoveSent=value;},
 get lastTime(){return lastTime;}, set lastTime(value){lastTime=value;},
 get landmarks(){return landmarks;},
 get leafGeo(){return leafGeo;},
 get leafMats(){return leafMats;},
 get loading(){return loading;},
 get logBottom(){return logBottom;},
 get logFootprint(){return logFootprint;},
 get logGeo(){return logGeo;},
 get logLength(){return logLength;},
 get fallenLogGeo(){return fallenLogGeo;},
 get buildOffset(){return buildOffset;},
 get logMat(){return logMat;},
 get logRadius(){return logRadius;},
 get logTop(){return logTop;},
 get look(){return look;},
 get makeLog(){return makeLog;},
 get makeTree(){return makeTree;},
 get metal(){return metal;},
 get mushrooms(){return mushrooms;},
 get microGrass(){return microGrass;},
 get waterSplashes(){return waterSplashes;},
 get plantInteraction(){return plantInteraction;},
 get modelActors(){return modelActors;},
 get notify(){return notifications.notify;},
 get moveHorizontal(){return moveHorizontal;},
 get myId(){return myId;}, set myId(value){myId=value;},
 get onGround(){return onGround;}, set onGround(value){onGround=value;},
 get offlineSave(){return offlineSave;},
 get orientation(){return orientation;}, set orientation(value){orientation=value;},
 get overlaps(){return overlaps;},
 get ownAvatar(){return ownAvatar;}, set ownAvatar(value){ownAvatar=value;},
 get ragdoll(){return ragdoll;},
 get ragdollControls(){return ragdollControls;},
 get ragdollCamera(){return ragdollCamera;},
 get ragdollStandingSupport(){return ragdollStandingSupport;},
 get fallTracker(){return fallTracker;},
 get fallImpactSpeed(){return fallImpactSpeed;},set fallImpactSpeed(v){fallImpactSpeed=v;},
 applyFallImpact(impact,options){return applyFallImpact(ctx,impact,options);},
 get collisionWorld(){return collisionWorld;},
 get particles(){return particles;},
 get pitch(){return pitch;}, set pitch(value){pitch=value;},
 get placeLog(){return placeLog;},
 get nudgeLog(){return nudgeLog;},
 get rotateLog(){return rotateLog;},
 get placed(){return placed;},
 get progress(){return progress;},
 get placement(){return placement;},
 get placeError(){return placeError;}, set placement(value){placement=value;},
 get preview(){return preview;}, set preview(value){preview=value;},
 get px(){return px;}, set px(value){px=value;},
 get pz(){return pz;}, set pz(value){pz=value;},
 get radius(){return settings.detailedTreeRadius;},
 get rand(){return rand;},
 get removeAvatar(){return removeAvatar;},
 get removeLog(){return removeLog;},
 get renderer(){return renderer;},
 get requestJump(){return requestJump;},
 get rareLeafMat(){return rareLeafMat;},
 get spruceParts(){return spruceParts;},
 get spruceModelHeight(){return treeModels.models.spruce.trunkHeight;},
 get birchModelHeight(){return treeModels.models.birch.trunkHeight;},
 get birchParts(){return birchParts;},
 get distantTreeParts(){return distantTreeParts;},
 get treeWindShader(){return treeWindShader;},
 get spruceDiagnostics(){return spruceDiagnostics;},
 get rockColliders(){return rockColliders;},
 get rockGeo(){return rockGeo;},
 get rockMat(){return rockMat;},
 get rootMotion(){return rootMotion;},
 get scene(){return scene;},
 get settings(){return settings;},
 get audio(){return gameAudio;},
 get seed(){return seed;}, set seed(value){seed=value;terrain.setSeed(value);},
 get sendNet(){return sendNet;},
 get setMode(){return setMode;},
 get simulateVertical(){return simulateVertical;},
 get socket(){return socket;}, set socket(value){socket=value;},
 get spawnChips(){return spawnChips;},
 get swing(){return swing;}, set swing(value){swing=value;},
 get syncWood(){return syncWood;},
 get thirdPerson(){return thirdPerson;}, set thirdPerson(value){thirdPerson=value;},
 get tickActor(){return tickActor;},
 get toggleView(){return toggleView;},
 get treeDamage(){return treeDamage;},
 get tutorial(){return tutorial;},
 get treeFell(){return treeFell;},
 get treeHit(){return treeHit;},
 get trees(){return trees;},
 get trunkGeo(){return trunkGeo;},
 get trunkMats(){return trunkMats;},
 get updateChunks(){return updateChunks;},
 get updatePing(){return updatePing;},
 get updatePreview(){return updatePreview;},
 get verticalSpeed(){return verticalSpeed;}, set verticalSpeed(value){verticalSpeed=value;},
 get wind(){return wind;},
 get wood(){return wood;}, set wood(value){if(inventory&&!inventory.syncWood(value,{migrate:value>1000}))return;wood=value;},
 get yaw(){return yaw;}, set yaw(value){yaw=value;},
};
// Micro-grass starts ticking immediately; crafting must exist before its getter is read.
let crafting=null;
const microGrass=createMicroGrass(ctx);
const waterSplashes=createWaterSplashes(ctx);
const plantInteraction=createPlantInteraction(ctx);
const wind=createWind(ctx);
const landmarks=createLandmarks(ctx);
let spruceDiagnostics=createSpruceDiagnostics(THREE,ctx);
({rand, makeTree, build, updateChunks, distantForest, replaceTreeModels}=createWorld(ctx));
ctx.distantForest=distantForest;
let activeTreeKey='';
const inactiveTreeModels=new Map(); // one previous graphics preset, bounded by bytes
const TREE_MODEL_CACHE_BYTES=96*1024*1024;
function modelBytes(parts){
  let total=0;
  const geometries=new Set(),textures=new Set();
  for(const list of parts)for(const part of list??[]){
    if(part.geometry&&!geometries.has(part.geometry)){
      geometries.add(part.geometry);
      for(const attr of Object.values(part.geometry.attributes??{}))
        total+=attr.array?.byteLength??0;
      total+=part.geometry.index?.array?.byteLength??0;
    }
    for(const mat of [part.material,part.rareMaterial]){
      const tex=mat?.map;
      if(tex&&!textures.has(tex)){
        textures.add(tex);
        total+=(tex.image?.width??0)*(tex.image?.height??0)*4;
      }
    }
  }
  return total;
}
function rememberTreeModels(key,parts){
  if(!key){for(const list of parts)disposeProceduralParts(list);return;}
  inactiveTreeModels.delete(key);
  inactiveTreeModels.set(key,parts);
  let bytes=0;for(const lists of inactiveTreeModels.values())bytes+=modelBytes(lists);
  while((inactiveTreeModels.size>1||bytes>TREE_MODEL_CACHE_BYTES)&&inactiveTreeModels.size){
    const oldest=inactiveTreeModels.keys().next().value;
    const dropped=inactiveTreeModels.get(oldest);
    inactiveTreeModels.delete(oldest);
    bytes-=modelBytes(dropped);
    for(const list of dropped)disposeProceduralParts(list);
  }
}
function disposeProceduralParts(parts){
  for(const part of parts??[]){
    part.geometry?.dispose?.();
    part.material?.map?.dispose?.();
    part.material?.dispose?.();
    part.rareMaterial?.dispose?.();
  }
}
function geometryProfile(){
  const latest=readActiveTreeConfig();
  return {
    // The editor's per-model maximum must remain effective. The graphics
    // preset's triangle budget is an additional cap, not a replacement.
    spruce:limitTreeModelTriangles(latest.models.spruce,settings.treeTrianglesSpruce),
    birch:limitTreeModelTriangles(latest.models.birch,settings.treeTrianglesBirch),
  };
}
function distantProfile(spruce,birch){
  return {
    spruce:{...spruce,generatorQuality:'low',
      whorls:Math.min(11,spruce.whorls),
      branchesPerWhorl:spruce.branchesPerWhorl
        .slice(0,11).map(n=>Math.max(0,Math.round(n*.7))),
      showSecondaryBranches:false,maxTriangles:settings.farSpruceTriangles},
    birch:{...birch,branchCount:Math.min(16,birch.branchCount),
      showShootWood:false,maxTriangles:settings.farBirchTriangles},
  };
}
let pendingTreeUpdate=null,lastWorldGraphicsKey='';
function applyTreeModels(models,lod,key){
  if(key===activeTreeKey)return;
    const cached=inactiveTreeModels.get(key);
    if(cached)inactiveTreeModels.delete(key);
    const nextSpruce=cached?.[0]??generateSpruceParts(models.spruce);
    const nextBirch=cached?.[1]??generateBirchParts(models.birch);
    const nextDistantSpruce=cached?.[2]??generateSpruceParts(lod.spruce);
    const nextDistantBirch=cached?.[3]??generateBirchParts(lod.birch);
    if(nextSpruce?.length&&nextBirch?.length&&
       nextDistantSpruce?.length&&nextDistantBirch?.length){
      const old=[spruceParts,birchParts,distantSpruceParts,distantBirchParts];
      const previousKey=activeTreeKey;
      spruceDiagnostics.dispose?.();
      spruceParts=nextSpruce;birchParts=nextBirch;
      distantSpruceParts=nextDistantSpruce;
      distantBirchParts=nextDistantBirch;
      distantTreeParts={conifer:distantSpruceParts,birch:distantBirchParts};
      spruceDiagnostics=createSpruceDiagnostics(THREE,ctx);
      replaceTreeModels();
      rememberTreeModels(previousKey,old);
      activeTreeKey=key;
    }else{
      for(const list of [nextSpruce,nextBirch,nextDistantSpruce,nextDistantBirch])
        if(list)disposeProceduralParts(list);
    }
}

refreshPerformance=()=>{
  applyQuality(renderer,settings.quality,devicePixelRatio,
    innerWidth,innerHeight,settings.renderScale);
  terrain.setGraphics({terrainSegments:settings.terrainSegments,
    viewDistance:settings.viewDistance,
    lakeViewDistance:settings.lakeViewDistance,
    lakeVisibility:settings.lakeVisibility,
    waterQuality:settings.waterQuality});
  const models=geometryProfile();
  const lod=distantProfile(models.spruce,models.birch);
  const key=JSON.stringify([models,lod]);
  if(pendingTreeUpdate!==null){
    clearTimeout(pendingTreeUpdate);
    pendingTreeUpdate=null;
  }
  if(key!==activeTreeKey){
    // Dragging the slider should not generate four full trees per pixel.
    pendingTreeUpdate=setTimeout(()=>{
      pendingTreeUpdate=null;
      const currentModels=geometryProfile();
      const currentLod=distantProfile(currentModels.spruce,currentModels.birch);
      const latestKey=JSON.stringify([currentModels,currentLod]);
      applyTreeModels(currentModels,currentLod,latestKey);
    },160);
  }
  const worldKey=JSON.stringify([
    settings.detailedTreeRadius,settings.farForestDistance,
    settings.farTreeDensity,settings.lakeForestMode,settings.lakeVisibility,
    settings.lakeViewDistance,settings.viewDistance,
    settings.terrainSegments,settings.decorDensity,
  ]);
  if(worldKey!==lastWorldGraphicsKey){
    lastWorldGraphicsKey=worldKey;
    ctx.distantForest?.invalidate?.();
    ctx.updateChunks?.();
  }
};
collisionWorld=createCollisionWorld(ctx);
({logFootprint, logTop, logBottom, blocksPlayerAt, moveHorizontal,
 simulateVertical, ragdollStandingSupport, requestJump}=createPhysics(ctx));
({makeLog, overlaps, candidate, placeError, updatePreview, placeLog, removeLog, setMode, disposePreview,nudge:nudgeLog,rotate:rotateLog}=createBuilding(ctx));
({aimed, spawnChips, chop, tickImpact:tickChopImpact,acknowledgeLocalChop,resetChop}=createChopping(ctx));
ownAvatar=createLumberjack();if(ownAvatar){
 // Layer 3 is local-only (hidden in first person); layer 1 remains enabled
 // for remote players. Both layers are visible to the character shadow light.
 (ownAvatar.group.userData??={}).profileCategory='players';
 ownAvatar.visual.traverse(node=>{if(node.isMesh)node.layers.set(3);});
 camera.layers.enable(1);
 camera.layers.enable(3);
 scene.add(ownAvatar.group);
}
ragdoll=createRagdoll(ctx);
({isOnline, sendNet, updatePing, syncWood, clearWorld, addLog, treeHit, treeFell, addAvatar, removeAvatar, closeNet, sendChat, sendMapPing, sendEmote, chatHistory}=createMultiplayer(ctx));
inventory=createInventory(ctx);
storages=createStorages(ctx);
campStructures=createCampStructures(ctx);
vitals=createVitalsUI(ctx);
forestResources=createForestResources(ctx);
groundBoxes=createGroundBoxes(ctx);
deathSystem=createDeathSystem(ctx);
ragdollControls=createRagdollControls(ctx);
pickupInteraction=createPickupInteraction(ctx);
const emotes=createEmotes(ctx);
const playerList=createPlayerList(ctx);
crafting=createCrafting(ctx);
crafting.setMode(false);
$('mode').style.display='none';
$('place').style.display='none';
$('undo').style.display='none';
gameAudio=createGameAudio(ctx);
const highlight=createInteractionHighlight(ctx);
const discoveries=createDiscoveries(ctx);
const communityGoal=createCommunityGoal(ctx);
offlineSave=createOfflineSave(ctx,{slot:menuLaunch.slot || 1});
if(menuLaunch.mode==='continue')offlineSave.restore();
else if(menuLaunch.mode==='new')offlineSave.reset({preserve:true});
else if(menuLaunch.mode==='online')offlineSave.suspend({flush:false});
progress=createProgress({notify:notifications.notify,start:{x:ctx.px,z:ctx.pz}});
({toggleView, ragdollCamera, animate}=createPlayer(ctx));
({showMapPing,clearMapPings}=createMinimap(ctx));
({look}=createControls(ctx));
const leaveGuard=installGameLeaveGuard(window);
worldStartupGate=createWorldStartupGate({
  loading,online:menuLaunch.mode==='online',
  onComplete:()=>{
    document.body.classList.remove('fc-world-loading');
    if(menuLaunch.mode==='new' && !offlineSave.save())
      alert('Не удалось сохранить новый мир. Проверьте свободное место в хранилище браузера.');
  },
});
// Returning to the menu uses a page reload: every WebGL resource and listener
// is torn down by the browser, avoiding a fragile half-destroyed scene.
$('menu-backgame').onclick=()=>{
  const warning=offlineSave.suspended
    ?'Выйти из сетевого мира и вернуться в главное меню?'
    :'Сохранить игру и вернуться в главное меню?';
  if(!confirm(warning))return;
  if(!offlineSave.suspended && !offlineSave.save()){
    alert('Не удалось сохранить игру. Проверьте свободное место в хранилище браузера.');
    return;
  }
  closeNet?.();
  try{sessionStorage.removeItem(MENU_LAUNCH_KEY);}catch{}
  leaveGuard.allowIntentionalExit(); // Menu button already asked for confirmation.
  // Don't immediately auto-launch again when returning from a URL shortcut.
  if(new URLSearchParams(location.search).has('type'))location.replace(location.pathname+location.hash);
  else location.reload();
};
if(menuLaunch.mode==='online'){
  $('netname').value=String(menuLaunch.name??'Лесоруб').slice(0,22);
  $('netmode').value=['host','guest'].includes(menuLaunch.modeConnection)
    ?menuLaunch.modeConnection:'direct';
  $('netmode').onchange();
  $('neturl').value=menuLaunch.address??'ws://localhost:8765';
  $('peerroom').value=menuLaunch.peerRoom??'';
  $('peercustom').checked=menuLaunch.peerCustom===true;
  $('peercustom').onchange();
  if(menuLaunch.peerHost)$('peerhost').value=menuLaunch.peerHost;
  if(menuLaunch.peerPort)$('peerport').value=menuLaunch.peerPort;
  if(menuLaunch.peerPath)$('peerpath').value=menuLaunch.peerPath;
  $('peersecure').checked=menuLaunch.peerSecure===true;
  $('connect').click();
}
refreshPerformance();
if (location.pathname.endsWith('/index_debug.html')) {
  const { installDebug } = await import('./debug.js?v=20261103-region-default-3');
  installDebug(ctx);
}
requestAnimationFrame(animate);
