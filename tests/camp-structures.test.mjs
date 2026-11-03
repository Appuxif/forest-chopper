import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampStructures} from '../src/camp-structures.js';
import {CAMP_RECIPES,validCampStructure} from '../src/camp-rules.js';
import {createPhysics} from '../src/physics.js';
import {createInventoryModel} from '../src/inventory.js';
import {flatTerrain} from './helpers/flat-terrain.mjs';

function fixture(online=false){
 class Obj{
  constructor(){this.children=[];this.userData={};this.visible=true;
    this.rotation={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});}};
    this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});},copy(p){Object.assign(this,p);}};
    this.scale={x:1,y:1,z:1,set(x,y,z){Object.assign(this,{x,y,z});}};
  }
  add(item){this.children.push(item);item.parent=this;}
 }
 class Mesh extends Obj{constructor(geo,mat){super();this.geometry=geo;this.material=mat;}}
 class Light extends Obj{constructor(color,intensity,distance){super();Object.assign(this,{color,intensity,distance});}}
 class Geometry{constructor(...args){this.args=args;}}
 class Mat{constructor(options={}){this.options=options;}}
 const added=[],removed=[],sent=[],saved=[];
 const inventory=createInventoryModel();
 const ctx={
  THREE:{Mesh,Group:Obj,PointLight:Light,BoxGeometry:Geometry,DodecahedronGeometry:Geometry,
    ConeGeometry:Geometry,CylinderGeometry:Geometry,SphereGeometry:Geometry,MeshLambertMaterial:Mat,MeshStandardMaterial:Mat,MeshBasicMaterial:Mat},
  scene:{add:x=>added.push(x),remove:x=>removed.push(x)},
  terrain:flatTerrain(),
  inventory:{state:inventory,render(){},get selected(){return inventory.selected();},get equipped(){return inventory.equipped();}},
  offlineSave:{markDirty(){saved.push(1)}},
  isOnline:()=>online,sendNet:x=>sent.push(x),
  storages:{structures:new Map()},
  px:0,pz:0,yaw:0,orientation:1,wood:0,
  trees:new Map(),placed:[],rockColliders:new Map(),chunkSize:24,logLength:3,
  logRadius:.29,PLAYER_RADIUS:.31,PLAYER_HEIGHT:1.7,GRAVITY:19,JUMP_SPEED:7.5,
  feetY:0,verticalSpeed:0,onGround:true,jumpRequested:false,
 };
 const button={style:{},textContent:'',type:'',onclick:null};
 const camp=createCampStructures(ctx,{createElement:()=>button,body:{append(){}}});
 ctx.campStructures=camp;
 return {ctx,camp,inventory,sent,saved,added,removed,button,physics:createPhysics(ctx)};
}
const item=(id,kind,x=0,z=0,orientation=0,lit=false)=>({id,kind,x,z,orientation,lit});
test('campsite recipes are validated and new and legacy worlds remain compatible',()=>{
 assert.deepEqual(CAMP_RECIPES.torch,{branch:1,stone:3,dry_grass:1});
 for(const kind of Object.keys(CAMP_RECIPES))assert.equal(validCampStructure(item(1,kind)),true);
 assert.equal(validCampStructure(item(1,'torch',0,0,0,'yes')),false);
 assert.equal(validCampStructure(item(1,'table',0,0,0,true)),false);
 assert.equal(validCampStructure(item(1,'firepit')),false);
});
test('campfire lighting and interaction are persistent, toggle does not spend fuel',()=>{
 const {camp,ctx,button,physics,removed}=fixture();
 assert.equal(camp.add(item(-1,'campfire')),true);
 const fire=camp.items.get(-1),flame=fire.group.userData.flame;
 assert.equal(flame.visible,false);
 const visible=fire.group.children[0].children;
 const logs=visible.slice(9,18);
 const step=Math.PI*2/9;
 assert.ok(logs.every((log,i)=>
   Math.abs(log.rotation.y-((i+.5)*step-Math.PI/2))<1e-8
   && Math.abs(log.rotation.z+.45)<1e-8),
   'crafted fire has nine sloping logs, one for each gap between nine stones');
 assert.ok(logs.every(log=>log.scale.y===.1008&&log.scale.z===.1008),
   'all crafted fire logs keep their thinner profile');
 assert.equal(visible.length,24,'dark fire has one shadow-casting light and no glowing coals');

 assert.equal(fire.group.userData.innerFlame.visible,false);
 assert.ok(fire.group.userData.sparks.every(spark=>spark.visible===false));
 assert.equal(physics.blocksPlayerAt(0,0,0),true,'campfire ring blocks walking');
 assert.equal(camp.toggle(-1),true);
 camp.tick(500);
 const sparkY=fire.group.userData.sparks.map(spark=>spark.position.y);
 camp.tick(550);
 assert.notDeepEqual(fire.group.userData.sparks.map(spark=>spark.position.y),sparkY,
   'all crafted sparks are animated even between 200ms light updates');
 assert.equal(flame.visible,true);
 assert.equal(fire.group.userData.light.visible,true);
 assert.equal(button.style.display,undefined,'no separate fire interaction button');
 assert.equal(ctx.inventory.state.count('log'),0,'toggling never burns materials');
 const saved=camp.snapshot();
 assert.deepEqual(saved,[item(-1,'campfire',0,0,0,true)]);
 camp.clear();
 assert.equal(camp.items.size,0);
 assert.equal(removed.length,1);
 camp.set(saved);
 assert.equal(camp.items.get(-1).lit,true,'reload restores fire state');
 assert.equal(camp.toggle(-1),true);
 assert.equal(camp.items.get(-1).lit,false);
});
test('all lit fires inside their activation radius keep point lights; geometry collides',()=>{
 const {camp,ctx,physics}=fixture();
 for(let i=0;i<8;i++)camp.add(item(i+1,i===0?'torch':i===1?'table':'campfire',i*5,0,i%4,true&&i!==1));
 camp.tick(1000);
 assert.equal([...camp.items.values()].filter(x=>x.group.userData.light?.visible).length,7,
   'all seven burning fires keep their PointLights in the default activation range');
 assert.equal(physics.blocksPlayerAt(5,0,0),true,'table has footprint collision');
 assert.equal(physics.blocksPlayerAt(5,0,1),false,'table can be stood upon');
 const collision=camp.items.get(2).group.userData.collisionBoxes;
 assert.ok(collision.length>=5);
 assert.ok(camp.items.get(1).group.userData.flame);
});
test('torch reuses three campfire stones and adds black cloth-wrapped cylinder',()=>{
 const {camp}=fixture();
 assert.equal(camp.add(item(3,'torch')),true);
 const visual=camp.items.get(3).group;
 const stones=visual.children.filter(node=>node.geometry?.args?.[0]===.24);
 assert.equal(stones.length,3,'three dodecahedron stones around torch base');
 for(const stone of stones){
  assert.ok(Math.hypot(stone.position.x,stone.position.z)>.2);
  assert.ok(stone.position.y<.2);
 }
 const head=visual.children.find(node=>node.geometry?.args?.[0]===.145);
 assert.ok(head,'replace square head with cloth-wrapped cylinder');
 assert.equal(head.geometry.args[2],.31);
 assert.equal(head.position.y,1.66);
 const folds=visual.children.filter(node=>node.geometry?.args?.[0]>=.148
   &&node.geometry?.args?.[0]<.16);
 assert.equal(folds.length,3,'three raised fabric folds');
 assert.ok(folds.every(node=>node.material.options.color===0x1c1c1e));
 assert.ok(visual.userData.flame.position.y>head.position.y+.15);
 const icon=camp.createIconModel('torch');
 assert.ok(icon.children.some(node=>node.geometry?.args?.[0]===.145),'thumbnail uses same 3D torch');
});

test('campfire and torch share yellow dual-cone flames and three animated sparks',()=>{
 const {camp}=fixture();
 assert.equal(camp.add(item(21,'campfire')),true);
 assert.equal(camp.add(item(22,'torch')),true);
 const campGroup=camp.items.get(21).group;
 const torchGroup=camp.items.get(22).group;
 const {flame:campOuter,innerFlame:campInner,sparks:campSparks}=campGroup.userData;
 const {flame:torchOuter,innerFlame:torchInner,sparks:torchSparks}=torchGroup.userData;
 assert.equal(campOuter.material,torchOuter.material,'shared transparent-yellow material');
 assert.equal(campInner.material,torchInner.material,'shared opaque-yellow material');
 assert.equal(campOuter.material.options.transparent,true);
 assert.equal(campOuter.material.options.opacity,.95);
 assert.equal(campOuter.material.options.depthWrite,false);
 assert.equal(campInner.material.options.transparent,undefined,'inner flame is opaque');
 assert.equal(campInner.material.options.opacity,undefined);
 assert.equal(campOuter.material.options.color,0xffd54a);
 assert.equal(campInner.material.options.color,0xffee77);
 assert.ok(campInner.position.x!==campOuter.position.x);
 assert.ok(torchInner.position.x!==torchOuter.position.x);
 assert.equal(campOuter.geometry.args[0],.435);
 assert.equal(campInner.geometry.args[0],.225);
 assert.equal(torchOuter.geometry.args[0],.20);
 assert.equal(torchInner.geometry.args[0],.11);
 assert.equal(torchOuter.position.y,2.08,'torch fire is lowered 10 cm');
 assert.equal(torchInner.position.y,1.98,'inner cone follows the lowered fire');
 assert.equal(torchGroup.userData.light.position.y,2.23,'torch light follows the flames downwards');
 assert.deepEqual(torchSparks.map(s=>Number(s.position.y.toFixed(2))),[2.30,2.40,2.50],
   'all three sparks move up with the torch flames');
 assert.equal(campOuter.position.y,.73,'campfire outer flame is raised 10 cm');
 assert.equal(campInner.position.y,.59,'campfire inner flame follows the outer cone');
 assert.equal(campGroup.userData.light.position.y,1.5,'campfire light is raised with flames');
 assert.deepEqual(campSparks.map(s=>Number(s.position.y.toFixed(2))),[1.05,1.18,1.31],
   'campfire sparks all rise 10 cm');
 assert.equal(campSparks.length,3);
 assert.equal(torchSparks.length,3);
 assert.ok(torchSparks.every(spark=>spark.visible===false),'torch starts unlit');
 assert.ok(campSparks.every(spark=>spark.visible===false),'campfire starts unlit');
 assert.equal(camp.toggle(21),true);
 assert.equal(camp.toggle(22),true);
 camp.tick(500);
 const before=torchSparks.map(spark=>spark.position.y);
 const coreX=torchInner.position.x;
 camp.tick(552);
 assert.notDeepEqual(torchSparks.map(spark=>spark.position.y),before,'torch sparks float independently of light throttle');
 assert.notEqual(torchInner.position.x,coreX,'torch inner flame wobbles off centre');
 assert.ok(torchSparks.every(spark=>spark.visible===true));
 assert.ok(campSparks.every(spark=>spark.visible===true));
 assert.equal(camp.toggle(22),true);
 assert.ok(torchSparks.every(spark=>spark.visible===false),'torch sparks vanish with flame');
 assert.equal(torchOuter.visible,false);
 assert.equal(torchInner.visible,false);
});

test('craft first, then place selected torch; online waits for server confirmation',()=>{
 const offline=fixture();
 assert.equal(offline.camp.place('torch'),false);
 offline.inventory.addItem({id:'branch',count:1});
 offline.inventory.addItem({id:'stone',count:3});
 offline.inventory.addItem({id:'dry_grass',count:1});
 assert.equal(offline.inventory.craftStructure('torch'),true);
 assert.equal(offline.inventory.count('branch'),0);
 assert.equal(offline.inventory.count('stone'),0);
 assert.equal(offline.inventory.count('dry_grass'),0);
 const slot=offline.inventory.slots.findIndex(x=>x?.id==='torch');
 offline.inventory.assignQuick(1,slot);
 offline.inventory.select(1);
 assert.equal(offline.camp.place('torch'),true);
 assert.equal(offline.inventory.count('torch'),0);
 assert.equal(offline.camp.items.size,1);
 assert.ok(offline.saved.length>0);
 const online=fixture(true);
 online.inventory.addItem({id:'torch',count:1});
 const oslot=online.inventory.slots.findIndex(x=>x?.id==='torch');
 online.inventory.assignQuick(1,oslot);online.inventory.select(1);
 assert.equal(online.camp.place('torch'),true);
 assert.equal(online.inventory.count('torch'),1,'server confirms inventory consumption');
 assert.equal(online.camp.items.size,0);
 assert.deepEqual(online.sent[0],{type:'camp_place',kind:'torch',x:0,z:-3,orientation:1});
 online.camp.add(item(44,'torch'));
 assert.equal(online.camp.toggle(44),true);
 assert.deepEqual(online.sent[1],{type:'camp_toggle',id:44});
});

test('alchemy bench has a stone surface, glass vessels and a distillation unit',()=>{
 const {camp,ctx,physics}=fixture();
 assert.equal(camp.add(item(41,'alchemy_table',1,0)),true);
 const work=camp.items.get(41);
 assert.ok(work.group.children.length>=20,'the bench includes retort, distillation cube and flasks');
 const geometries=work.group.children.map(node=>node.geometry?.args);
 assert.ok(geometries.some(args=>args?.[0]===.27),'copper distillation boiler');
 assert.ok(geometries.some(args=>args?.[0]===.19),'glass retort flask');
 assert.equal(geometries.filter(args=>args?.[0]===.14).length,3,'three reagent flasks');
 assert.ok(work.group.userData.collisionBoxes.length>=7);
 assert.equal(physics.blocksPlayerAt(1,0,0),true,'stone-top workstation blocks walking');
 const icon=camp.createIconModel('alchemy_table');
 assert.ok(icon.children.length>=20,'inventory icon is the same procedural model');
 assert.equal(camp.snapshot()[0].kind,'alchemy_table');
 assert.equal(camp.items.get(41).group.userData.flame,undefined,'station is not a fire');
});

test('bed has mattress, pillow and collision; E selection is distinct from fire toggle',()=>{
 const {camp,ctx,physics,sent}=fixture(true);
 assert.deepEqual(CAMP_RECIPES.bed,{log:3,branch:4,dry_grass:5});
 assert.equal(camp.add(item(25,'bed')),true);
 const bed=camp.items.get(25);
 assert.ok(bed.group.children.length>=10,'procedural wooden legs, mattress and pillow');
 assert.equal(physics.blocksPlayerAt(0,0,0),true);
 assert.equal(camp.toggle(25),false);
 let activated=null;
 ctx.deathSystem={setBed:id=>{activated=id;return true;}};
 ctx.ragdollControls={sleepInBed:bed=>ctx.deathSystem.setBed(bed.id)};
 assert.equal(camp.activate(25),true);
 assert.equal(activated,25);
 assert.equal(camp.snapshot()[0].kind,'bed');
 assert.equal(camp.createIconModel('bed').children.length,bed.group.children.length);
});

test('four built fires use four single PointLights and retain shadows beyond refresh budget',()=>{
 const {camp,ctx}=fixture();
 ctx.settings={fireShadows:true,fireShadowLimit:2,performancePreset:'high',
  torchNightRadius:9,torchShadowVisibilityDistance:30,torchVisibilityDistance:75,
  torchActivationDistance:80};
 ctx.terrain.nightBlend=1;
 for(const [i,x] of [0,4,8,12].entries())camp.add(item(1000+i,'torch',x,0,0,true));
 const sources=[...camp.items.values()].map(v=>v.group.userData.light);
 for(const source of sources)source.shadow={autoUpdate:false,needsUpdate:false};
 for(const entry of camp.items.values())
  assert.equal(entry.group.userData.dynamicLight,undefined,'no duplicate PointLight');
 ctx.px=0;camp.tick(1000);
 for(let i=0;i<4;i++){
  assert.equal(sources[i].castShadow,true,'all four retain visible shadow maps');
  assert.equal(sources[i].shadow.autoUpdate,i<2,'only two are refreshed');
 }
 sources.forEach(source=>{source.shadow.needsUpdate=false;});
 ctx.px=12;camp.tick(1200);
 for(let i=0;i<4;i++){
  assert.equal(sources[i].castShadow,true,'cached sources are never hidden by selection');
  assert.equal(sources[i].shadow.autoUpdate,i>=2,'live budget follows player');
 }
 assert.equal(sources[0].shadow.needsUpdate,false,'last cached frame was not cleared');
 ctx.settings.fireShadowLimit=0;camp.tick(1400);
 assert.ok(sources.every(source=>source.castShadow&&!source.shadow.autoUpdate));
 ctx.settings.fireShadows=false;camp.tick(1600);
 assert.ok(sources.every(source=>!source.castShadow));
});

test('one fire shadow map is computed in daytime/nighttime with different radius and intensity',()=>{
 const {camp,ctx}=fixture();
 ctx.settings={fireShadows:true,fireShadowLimit:2,performancePreset:'high',
  torchDayRadius:6,torchNightRadius:18,torchDayIntensity:4,torchNightIntensity:12,
  torchShadowVisibilityDistance:40,torchVisibilityDistance:120,
  torchActivationDistance:100,torchDecay:.3};
 camp.add(item(1100,'torch',0,0,0,true));
 const light=camp.items.get(1100).group.userData.light;
 light.shadow={autoUpdate:false,needsUpdate:false};
 const check=(blend,time,intensity,radius)=>{
  ctx.terrain.nightBlend=blend;camp.tick(time);
  assert.equal(light.intensity,intensity);
  assert.equal(light.userData.shadowCasterRange,radius);
  assert.equal(light.castShadow,true);
  assert.equal(light.shadow.autoUpdate,true);
  assert.equal(light.distance,120);
  assert.equal(light.decay,.3);
 };
 check(0,1000,4,6);
 check(.5,1200,8,12);
 check(1,1400,12,18);
 ctx.px=30;camp.tick(1600);
 assert.equal(light.castShadow,true,'shadow map visible up to 40m');
 assert.equal(light.shadow.autoUpdate,false,'no updates beyond 18m');
 ctx.px=45;camp.tick(1800);
 assert.equal(light.castShadow,false,'shadow visibility independent from 120m light');
 assert.equal(light.visible,true);
});

test('starter campfire shares live update slots but no other source loses cached shadows',()=>{
 const {camp,ctx}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={fireShadowLimit:2,fireShadows:true,performancePreset:'high'};
 ctx.landmarks={fireDistance:2};
 for(const [id,x] of [[1,1],[2,3],[3,5]])camp.add(item(id,'torch',x,0,0,true));
 for(const entry of camp.items.values())
  entry.group.userData.light.shadow={autoUpdate:false,needsUpdate:false};
 camp.tick(1000);
 const lights=[1,2,3].map(id=>camp.items.get(id).group.userData.light);
 assert.ok(lights.every(light=>light.castShadow),'all maps sampled');
 assert.equal(lights[0].shadow.autoUpdate,true,'one slot taken by nearest torch');
 assert.equal(lights[1].shadow.autoUpdate,false,'starter consumes second slot');
 ctx.landmarks.fireDistance=Infinity;
 camp.tick(1200);
 assert.equal(lights[1].shadow.autoUpdate,true,'starter leaves budget');
 assert.equal(lights[2].castShadow,true);
});

test('torch and campfire have independent activation, lighting and shadow distances',()=>{
 const {camp,ctx}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={fireShadows:true,fireShadowLimit:2,performancePreset:'high',
  campfireNightRadius:8,campfireShadowVisibilityDistance:20,
  campfireVisibilityDistance:200,campfireActivationDistance:60,
  torchNightRadius:6,torchShadowVisibilityDistance:50,
  torchVisibilityDistance:80,torchActivationDistance:90};
 camp.add(item(1200,'campfire',30,0,0,true));
 camp.add(item(1201,'torch',45,0,0,true));
 camp.tick(1000);
 const campLight=camp.items.get(1200).group.userData.light;
 const torchLight=camp.items.get(1201).group.userData.light;
 torchLight.shadow={autoUpdate:false,needsUpdate:false};
 campLight.shadow={autoUpdate:false,needsUpdate:false};
 camp.tick(1100);
 assert.equal(campLight.visible,true);
 assert.equal(campLight.castShadow,false,'campfire shadow visibility limit 20m');
 assert.equal(campLight.distance,200);
 assert.equal(campLight.userData.shadowCasterRange,8);
 assert.equal(torchLight.castShadow,true,'torch casts cached shadows at 45m');
 assert.equal(torchLight.shadow.autoUpdate,false);
 assert.equal(torchLight.userData.shadowCasterRange,6);
 assert.equal(torchLight.distance,80);
 ctx.px=32;camp.tick(1200);
 assert.equal(campLight.castShadow,true);
 assert.equal(campLight.shadow.autoUpdate,true,'returns within 8m');
});

test('unlit fires stop contributing illumination and shadows without adding inventory',()=>{
 const {camp,ctx}=fixture();
 ctx.settings={fireShadows:true,fireShadowLimit:2,performancePreset:'high'};
 camp.add(item(1300,'campfire',0,0,0,true));
 camp.tick(1000);
 const entry=camp.items.get(1300),light=entry.group.userData.light;
 assert.equal(light.castShadow,true);
 entry.lit=false;camp.tick(1200);
 assert.equal(light.castShadow,false);
 assert.equal(light.visible,false);
 assert.equal(entry.group.userData.dynamicLight,undefined);
});

test('moving out of the small caster radius freezes the combined map without flicker',()=>{
 const {camp,ctx}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={fireShadows:true,fireShadowLimit:1,performancePreset:'high',
  torchNightRadius:6,torchShadowVisibilityDistance:30,
  torchActivationDistance:70,torchVisibilityDistance:70};
 camp.add(item(1400,'torch',0,0,0,true));
 const light=camp.items.get(1400).group.userData.light;
 light.shadow={autoUpdate:false,needsUpdate:false};
 ctx.px=1;camp.tick(1000);
 assert.equal(light.shadow.autoUpdate,true);
 light.shadow.needsUpdate=false;
 ctx.px=25;camp.tick(1200);
 assert.equal(light.castShadow,true);
 assert.equal(light.shadow.autoUpdate,false);
 assert.equal(light.shadow.needsUpdate,false,'preserve the last render');
 assert.equal(light.userData.shadowFrozen,true);
 ctx.px=2;camp.tick(1400);
 assert.equal(light.shadow.autoUpdate,true,'resume near source');
 assert.equal(light.userData.shadowFrozen,false);
});

test('one PointLight per fire is disposed exactly once on removal',()=>{
 const {camp,ctx}=fixture();
 camp.add(item(1500,'torch',0,0,0,true));
 const entry=camp.items.get(1500);
 assert.equal(entry.group.userData.dynamicLight,undefined);
 const light=entry.group.userData.light;
 light.shadow={disposed:0,dispose(){this.disposed++;}};
 camp.remove(1500);
 assert.equal(light.shadow.disposed,1);
});
