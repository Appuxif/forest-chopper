import {createAnimations} from './animations.js?v=20261030-character-shadow-12m1';
import {createWorld} from './world.js?v=20261030-classic-instancing1';
import {detachTreeForFall} from './tree-instancing.js?v=20261030-classic-instancing1';
import {createMushrooms} from './mushrooms.js';
import {createFlowers} from './flowers.js';
import {createGrass} from './grass.js';
import {createMicroGrass} from './micro-grass.js?v=20261030-grass-density-shadows1';
import {createGroundTexture,enableGrassDensityShadows} from './ground-texture.js?v=20261030-grass-density-shadows1';
import {createPhysics} from './physics.js?v=20261030-rock-collision1';
import {createBuilding} from './building.js?v=20261030-built-shadows1';
import {createChopping} from './chopping.js?v=20261030-classic-instancing1';
import {createControls} from './controls.js?v=20261030-classic-instancing1';
import {createPlayer} from './player.js?v=20261030-camera-up-arc1';
import {createMultiplayer} from './multiplayer.js?v=20261030-classic-instancing1';
import {createMinimap} from './minimap.js?v=20261030-map-ping1';
import {createNotifications} from './notifications.js';
import {createSettings} from './settings.js?v=20261030-camera-down80-1';
import {applyQuality} from './quality.js';
import {createWind} from './wind.js?v=20261030-classic-instancing1';
import {createLandmarks} from './landmarks.js?v=20261030-grass-clearings1';
import {createPlantInteraction} from './plant-interaction.js?v=20261030-grass-clearings1';
import {selectDecorShadowCasters} from './decor-shadows.js?v=20261030-decor-shadow1';
import {createDayCycle} from './day-cycle.js?v=20261030-darker-night1';
import {createAtmosphere} from './atmosphere.js?v=20261030-classic-instancing1';
import {selectCharacterShadowCasters} from './character-shadow-lod.js?v=20261030-character-shadow-range1';
import {createEmotes} from './emotes.js';
import {createPlayerList} from './player-list.js';
import {createCrafting} from './crafting.js?v=20261030-built-shadows1';
import {createInteractionHighlight} from './interaction-highlight.js';
import {createDiscoveries} from './discoveries.js';
import {createCommunityGoal} from './community-goal.js';
import {createOfflineSave} from './offline-save.js?v=20261030-craft1';
import {createTutorial} from './tutorial.js';
import {createProgress} from './progress.js?v=20261030-discoveries1';

const $=id=>document.getElementById(id),host=$('game'),loading=$('load');let THREE;try{THREE=await import('https://esm.sh/three@0.170.0')}catch(e){loading.innerHTML='<b>Не удалось загрузить Three.js</b><span>Для первого запуска требуется интернет.</span>';throw e}


const {modelActors,CHOP_SPEED,createLumberjack,actorChop,tickActor,rootMotion}=await createAnimations(THREE);
let ownAvatar=null,thirdPerson=true;
const scene=new THREE.Scene();scene.background=new THREE.Color(0xa4c8be);scene.fog=new THREE.FogExp2(0xa4c8be,.012);
const camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.1,280);camera.rotation.order='YXZ';const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'default'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;host.prepend(renderer.domElement);
const hemisphere=new THREE.HemisphereLight(0xe1efff,0x45552b,2.1);scene.add(hemisphere);const sun=new THREE.DirectionalLight(0xffe4a6,2.3);sun.position.set(35,75,20);scene.add(sun);
const groundTexture=createGroundTexture(THREE,document,renderer);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshLambertMaterial({map:groundTexture}));ground.rotation.x=-Math.PI/2;enableGrassDensityShadows(THREE,ground.material);scene.add(ground);
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
const trees=new Map(),chunks=new Map(),rockColliders=new Map(),felled=new Set(),falling=[],particles=[],keys={},treeDamage=new Map();let seed=(Math.random()*999999)|0,px=0,pz=0,yaw=0,pitch=0,wood=0,cuts=0,joyX=0,joyY=0,swing=0,lastHit=0,drag=null,frame=0,lastTime=performance.now();const chunkSize=24,radius=3;

scene.add(camera);const axe=new THREE.Group();camera.add(axe);const handle=new THREE.Mesh(new THREE.CylinderGeometry(.045,.065,1.3,8),new THREE.MeshLambertMaterial({color:0x99623b}));handle.rotation.z=-.2;axe.add(handle);const metal=new THREE.MeshStandardMaterial({color:0xc2cbd0,metalness:.65,roughness:.35});const head=new THREE.Mesh(new THREE.BoxGeometry(.48,.32,.15),metal);head.position.set(-.18,.58,0);axe.add(head);const blade=new THREE.Mesh(new THREE.CylinderGeometry(.26,.26,.15,3),metal);blade.rotation.x=Math.PI/2;blade.rotation.z=Math.PI/2;blade.position.set(-.44,.58,0);axe.add(blade);axe.position.set(.72,-.7,-1.1);axe.rotation.z=-.25;

// Each placed log costs one wood unit. Snap to half-meter grid; automatic vertical stacking.
const placed=[],logRadius=.29,logLength=3.6;
const logGeo=new THREE.CylinderGeometry(logRadius,logRadius,logLength,10);
const logMat=new THREE.MeshLambertMaterial({color:0x92613a});
const endMat=new THREE.MeshLambertMaterial({color:0xd6ac72});
let buildMode=false,orientation=0,preview=null,placement=null;
// Feet-based, lightweight collision physics for the shared log construction.
let feetY=0,verticalSpeed=0,onGround=true,jumpRequested=false;
const PLAYER_RADIUS=.31,PLAYER_HEIGHT=1.7,GRAVITY=19,JUMP_SPEED=7.5;

// Multiplayer: authoritative server state, client-side rendering.
let socket=null,myId=null,lastMoveSent=0;const avatars=new Map();
const notifications=createNotifications();
const settings=createSettings(document,null,fov=>{camera.fov=fov;camera.updateProjectionMatrix();},quality=>applyQuality(renderer,quality,devicePixelRatio,innerWidth,innerHeight));
const atmosphere=createAtmosphere({
 THREE,renderer,scene,camera,sun,hemisphere,ground,settings,trees,
 getCharacterShadowCasters(){
  return selectCharacterShadowCasters(ownAvatar,avatars.values(),px,pz,
    {near:settings.characterShadowDistance});
 },
 getDecorShadowCasters(x,z,radius,limit){
  return selectDecorShadowCasters(chunks,x,z,radius,limit);
 },
 getBuiltShadowCasters(x,z,radius){
  const result=[];
  for(const item of crafting?.items?.values()??[]){
   if(Math.hypot(item.x-x,item.z-z)<radius+3)result.push(item.group);
  }
  for(const item of placed){
   if(item.mesh?.castShadow && Math.hypot(item.x-x,item.z-z)<radius+3)
    result.push(item.mesh);
  }
  return result;
 },
 getPointShadowCasters(light){
  const fire=light.parent;
  if(!fire)return [];
  const x=fire.position.x,z=fire.position.z,r=light.distance;
  const casters=selectDecorShadowCasters(chunks,x,z,r,36);
  const batches=new Set();
  for(const tree of trees.values()){
   if(Math.hypot(tree.position.x-x,tree.position.z-z)>=r+3 || casters.length>=52)continue;
   if(tree.userData.treeBatch){
    for(const mesh of tree.userData.treeBatch.meshes)batches.add(mesh);
   }else casters.push(tree);
  }
  casters.push(...batches);
  if(Math.hypot(px-x,pz-z)<r+2 && ownAvatar?.shadowMeshes)
   casters.push(...ownAvatar.shadowMeshes);
  for(const avatar of avatars.values()){
   if(Math.hypot(avatar.group.position.x-x,avatar.group.position.z-z)<r+2)
    casters.push(...(avatar.actor?.shadowMeshes??avatar.shadowMeshes??[]));
  }
  for(const item of crafting?.items?.values()??[]){
   if(Math.hypot(item.x-x,item.z-z)<r+3)casters.push(item.group);
  }
  for(const log of placed){
   if(Math.hypot(log.x-x,log.z-z)<r+2 && log.mesh?.castShadow)
    casters.push(log.mesh);
  }
  return casters;
 },
});
const dayCycle=createDayCycle({THREE,scene,hemisphere,sun,settings,atmosphere});
const tutorial=createTutorial({notify:notifications.notify});
let offlineSave=null,progress=null;

let addAvatar, addLog, aimed, animate, blocksPlayerAt, build, candidate, chop, clearWorld, closeNet, disposePreview, updatePing, isOnline, logBottom, logFootprint, logTop, look, makeLog, makeTree, moveHorizontal, overlaps, placeError, placeLog, rand, removeAvatar, removeLog, requestJump, sendChat, sendMapPing, sendEmote, showMapPing, clearMapPings, chatHistory, sendNet, setMode, simulateVertical, spawnChips, syncWood, toggleView, treeFell, treeHit, updateChunks, updatePreview;
const ctx={
 get $(){return $;},
 get chatHistory(){return chatHistory;},
 get clearMapPings(){return clearMapPings;},
 get sendChat(){return sendChat;},
 get sendMapPing(){return sendMapPing;},
 get sendEmote(){return sendEmote;},
 get emotes(){return emotes;},
 get playerList(){return playerList;},
 get crafting(){return crafting;},
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
 get logMat(){return logMat;},
 get logRadius(){return logRadius;},
 get logTop(){return logTop;},
 get look(){return look;},
 get makeLog(){return makeLog;},
 get makeTree(){return makeTree;},
 get metal(){return metal;},
 get mushrooms(){return mushrooms;},
 get microGrass(){return microGrass;},
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
 get particles(){return particles;},
 get pitch(){return pitch;}, set pitch(value){pitch=value;},
 get placeLog(){return placeLog;},
 get placed(){return placed;},
 get progress(){return progress;},
 get placement(){return placement;},
 get placeError(){return placeError;}, set placement(value){placement=value;},
 get preview(){return preview;}, set preview(value){preview=value;},
 get px(){return px;}, set px(value){px=value;},
 get pz(){return pz;}, set pz(value){pz=value;},
 get radius(){return radius;},
 get rand(){return rand;},
 get removeAvatar(){return removeAvatar;},
 get removeLog(){return removeLog;},
 get renderer(){return renderer;},
 get requestJump(){return requestJump;},
 get rareLeafMat(){return rareLeafMat;},
 get rockColliders(){return rockColliders;},
 get rockGeo(){return rockGeo;},
 get rockMat(){return rockMat;},
 get rootMotion(){return rootMotion;},
 get scene(){return scene;},
 get settings(){return settings;},
 get seed(){return seed;}, set seed(value){seed=value;},
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
 get wood(){return wood;}, set wood(value){wood=value;},
 get yaw(){return yaw;}, set yaw(value){yaw=value;},
};
// Micro-grass starts ticking immediately; crafting must exist before its getter is read.
let crafting=null;
const microGrass=createMicroGrass(ctx);
const plantInteraction=createPlantInteraction(ctx);
const wind=createWind(ctx);
const landmarks=createLandmarks(ctx);
({rand, makeTree, build, updateChunks}=createWorld(ctx));
({logFootprint, logTop, logBottom, blocksPlayerAt, moveHorizontal, simulateVertical, requestJump}=createPhysics(ctx));
({makeLog, overlaps, candidate, placeError, updatePreview, placeLog, removeLog, setMode, disposePreview}=createBuilding(ctx));
({aimed, spawnChips, chop}=createChopping(ctx));
ownAvatar=createLumberjack();if(ownAvatar){
 // Layer 3 is local-only (hidden in first person); layer 1 remains enabled
 // for remote players. Both layers are visible to the character shadow light.
 ownAvatar.visual.traverse(node=>{if(node.isMesh)node.layers.set(3);});
 camera.layers.enable(1);
 camera.layers.enable(3);
 scene.add(ownAvatar.group);
}
({isOnline, sendNet, updatePing, syncWood, clearWorld, addLog, treeHit, treeFell, addAvatar, removeAvatar, closeNet, sendChat, sendMapPing, sendEmote, chatHistory}=createMultiplayer(ctx));
const emotes=createEmotes(ctx);
const playerList=createPlayerList(ctx);
crafting=createCrafting(ctx);
const highlight=createInteractionHighlight(ctx);
const discoveries=createDiscoveries(ctx);
const communityGoal=createCommunityGoal(ctx);
offlineSave=createOfflineSave(ctx);
offlineSave.restore();
progress=createProgress({notify:notifications.notify,start:{x:ctx.px,z:ctx.pz}});
({toggleView, animate}=createPlayer(ctx));
({showMapPing,clearMapPings}=createMinimap(ctx));
({look}=createControls(ctx));
if (location.pathname.endsWith('/index_debug.html')) {
  const { installDebug } = await import('./debug.js?v=20261030-atmosphere1');
  installDebug(ctx);
}
requestAnimationFrame(animate);
