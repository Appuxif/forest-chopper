import {createAnimations} from './animations.js';
import {createWorld} from './world.js';
import {createPhysics} from './physics.js';
import {createBuilding} from './building.js';
import {createChopping} from './chopping.js';
import {createControls} from './controls.js';
import {createPlayer} from './player.js';
import {createMultiplayer} from './multiplayer.js';
import {createMinimap} from './minimap.js';

const $=id=>document.getElementById(id),host=$('game'),loading=$('load');let THREE;try{THREE=await import('https://esm.sh/three@0.170.0')}catch(e){loading.innerHTML='<b>Не удалось загрузить Three.js</b><span>Для первого запуска требуется интернет.</span>';throw e}


const {modelActors,CHOP_SPEED,createLumberjack,actorChop,tickActor,rootMotion}=await createAnimations(THREE);
let ownAvatar=null,thirdPerson=true;
const scene=new THREE.Scene();scene.background=new THREE.Color(0xa4c8be);scene.fog=new THREE.FogExp2(0xa4c8be,.012);
const camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.1,280);camera.rotation.order='YXZ';const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'default'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;host.prepend(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xe1efff,0x45552b,2.1));const sun=new THREE.DirectionalLight(0xffe4a6,2.3);sun.position.set(35,75,20);scene.add(sun);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshLambertMaterial({color:0x547340}));ground.rotation.x=-Math.PI/2;scene.add(ground);
const trunkGeo=new THREE.CylinderGeometry(.38,.6,1,9),leafGeo=new THREE.ConeGeometry(1,1,8),grassGeo=new THREE.ConeGeometry(.17,.6,3),rockGeo=new THREE.DodecahedronGeometry(1,0);
const trunkMats=[0x65442e,0x795339,0x543925].map(color=>new THREE.MeshLambertMaterial({color}));const leafMats=[0x214c30,0x30683a,0x3a7141,0x285e46].map(color=>new THREE.MeshLambertMaterial({color}));const grassMat=new THREE.MeshLambertMaterial({color:0x829b4c}),rockMat=new THREE.MeshLambertMaterial({color:0x808478});
const trees=new Map(),chunks=new Map(),felled=new Set(),falling=[],particles=[],keys={},treeDamage=new Map();let seed=(Math.random()*999999)|0,px=0,pz=0,yaw=0,pitch=0,wood=0,cuts=0,joyX=0,joyY=0,swing=0,lastHit=0,drag=null,frame=0,lastTime=performance.now();const chunkSize=24,radius=3;

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

let addAvatar, addLog, aimed, animate, blocksPlayerAt, build, candidate, chop, clearWorld, closeNet, isOnline, logBottom, logFootprint, logTop, look, makeLog, makeTree, moveHorizontal, overlaps, placeLog, rand, removeAvatar, removeLog, requestJump, sendChat, chatHistory, sendNet, setMode, simulateVertical, spawnChips, syncWood, toggleView, treeFell, treeHit, updateChunks, updatePreview;
const ctx={
 get $(){return $;},
 get chatHistory(){return chatHistory;},
 get sendChat(){return sendChat;},
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
 get cuts(){return cuts;}, set cuts(value){cuts=value;},
 get drag(){return drag;}, set drag(value){drag=value;},
 get endMat(){return endMat;},
 get falling(){return falling;},
 get feetY(){return feetY;}, set feetY(value){feetY=value;},
 get felled(){return felled;},
 get frame(){return frame;}, set frame(value){frame=value;},
 get grassGeo(){return grassGeo;},
 get grassMat(){return grassMat;},
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
 get modelActors(){return modelActors;},
 get moveHorizontal(){return moveHorizontal;},
 get myId(){return myId;}, set myId(value){myId=value;},
 get onGround(){return onGround;}, set onGround(value){onGround=value;},
 get orientation(){return orientation;}, set orientation(value){orientation=value;},
 get overlaps(){return overlaps;},
 get ownAvatar(){return ownAvatar;}, set ownAvatar(value){ownAvatar=value;},
 get particles(){return particles;},
 get pitch(){return pitch;}, set pitch(value){pitch=value;},
 get placeLog(){return placeLog;},
 get placed(){return placed;},
 get placement(){return placement;}, set placement(value){placement=value;},
 get preview(){return preview;}, set preview(value){preview=value;},
 get px(){return px;}, set px(value){px=value;},
 get pz(){return pz;}, set pz(value){pz=value;},
 get radius(){return radius;},
 get rand(){return rand;},
 get removeAvatar(){return removeAvatar;},
 get removeLog(){return removeLog;},
 get renderer(){return renderer;},
 get requestJump(){return requestJump;},
 get rockGeo(){return rockGeo;},
 get rockMat(){return rockMat;},
 get rootMotion(){return rootMotion;},
 get scene(){return scene;},
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
 get treeFell(){return treeFell;},
 get treeHit(){return treeHit;},
 get trees(){return trees;},
 get trunkGeo(){return trunkGeo;},
 get trunkMats(){return trunkMats;},
 get updateChunks(){return updateChunks;},
 get updatePreview(){return updatePreview;},
 get verticalSpeed(){return verticalSpeed;}, set verticalSpeed(value){verticalSpeed=value;},
 get wood(){return wood;}, set wood(value){wood=value;},
 get yaw(){return yaw;}, set yaw(value){yaw=value;},
};
({rand, makeTree, build, updateChunks}=createWorld(ctx));
({logFootprint, logTop, logBottom, blocksPlayerAt, moveHorizontal, simulateVertical, requestJump}=createPhysics(ctx));
({makeLog, overlaps, candidate, updatePreview, placeLog, removeLog, setMode}=createBuilding(ctx));
({aimed, spawnChips, chop}=createChopping(ctx));
ownAvatar=createLumberjack();if(ownAvatar){scene.add(ownAvatar.group);ownAvatar.group.visible=thirdPerson;}
({isOnline, sendNet, syncWood, clearWorld, addLog, treeHit, treeFell, addAvatar, removeAvatar, closeNet, sendChat, chatHistory}=createMultiplayer(ctx));
({toggleView, animate}=createPlayer(ctx));
createMinimap(ctx);
({look}=createControls(ctx));
if (location.pathname.endsWith('/index_debug.html')) {
  const { installDebug } = await import('./debug.js');
  installDebug(ctx);
}
requestAnimationFrame(animate);
