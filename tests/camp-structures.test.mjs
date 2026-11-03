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
 assert.equal(visible.length,25,'dark fire has two light instances and no separate glowing coal meshes');

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

test('deep night selects two nearest lit fires for per-render-frame shadows',()=>{
 const {camp,ctx}=fixture();
 ctx.settings={fireShadows:true,performancePreset:'high'};
 ctx.terrain.nightBlend=0;
 camp.add(item(201,'torch',0,0,0,true));
 camp.add(item(202,'campfire',6,0,0,true));
 camp.add(item(203,'torch',12,0,0,true));
 camp.tick(1000);
 const torch=camp.items.get(201).group.userData.light;
 const fire=camp.items.get(202).group.userData.light;
 const farTorch=camp.items.get(203).group.userData.light;
 for(const light of [torch,fire,farTorch])
  light.shadow={autoUpdate:false,needsUpdate:false};
 for(const id of [201,202,203])
  (camp.items.get(id).group.userData.fireOrigin??camp.items.get(id).group).userData.dynamicLight.shadow={autoUpdate:false,needsUpdate:false};
 assert.equal(torch.castShadow,false);
 assert.equal(fire.castShadow,false);
 ctx.terrain.nightBlend=1;
 camp.tick(1200);
 assert.equal(torch.castShadow,true,'nearest torch casts shadows at night');
 assert.equal(torch.shadow.autoUpdate,false,'night static cubemap can be cached');
 assert.equal(camp.items.get(201).group.userData.fireOrigin,undefined);
 assert.equal((camp.items.get(201).group.userData.fireOrigin??camp.items.get(201).group).userData.dynamicLight.shadow.autoUpdate,true);
 assert.equal(fire.castShadow,true,'second closest campfire also casts shadows');
 assert.equal(fire.shadow.autoUpdate,false);
 assert.equal((camp.items.get(202).group.userData.fireOrigin??camp.items.get(202).group).userData.dynamicLight.shadow.autoUpdate,true);
 assert.equal(farTorch.castShadow,true,'third flame retains a cached shadow map');
 assert.equal((camp.items.get(203).group.userData.fireOrigin??
   camp.items.get(203).group).userData.dynamicLight.shadow.autoUpdate,false,
   'unselected light has no per-frame dynamic map refresh');
 assert.equal(farTorch.visible,true);
 ctx.px=12;
 camp.tick(1400);
 assert.equal(torch.castShadow,true,'distant torch keeps its cached shadow map');
 assert.equal((camp.items.get(201).group.userData.fireOrigin??
   camp.items.get(201).group).userData.dynamicLight.shadow.autoUpdate,false,
   'distant torch releases only an update slot');
 assert.equal(torch.shadow.autoUpdate,false);
 assert.equal(fire.castShadow,true);
 assert.equal(farTorch.castShadow,true,'new nearest torch receives the freed shadow slot');
 assert.equal(farTorch.shadow.autoUpdate,false);
 assert.equal((camp.items.get(203).group.userData.fireOrigin??camp.items.get(203).group).userData.dynamicLight.shadow.autoUpdate,true);
 ctx.terrain.nightBlend=0;
 camp.tick(1600);
 for(const light of [torch,fire,farTorch]){
  assert.equal(light.castShadow,false);
  assert.equal(light.shadow.autoUpdate,false);
 }
 ctx.terrain.nightBlend=1;
 ctx.settings.fireShadows=false;
 camp.tick(1800);
 assert.equal(fire.castShadow,false,'user option disables all fire shadows');
 assert.equal(farTorch.castShadow,false);
});

test('starter campfire occupies one of the two shared shadow slots',()=>{
 const {camp,ctx}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={fireShadows:true,performancePreset:'high'};
 camp.add(item(1,'torch',0,0,0,true));
 camp.add(item(2,'campfire',6,0,0,true));
 camp.add(item(3,'torch',12,0,0,true));
 // Starter is closer than both constructed flames (actual landmark logic
 // independently checks the same ranking).
 ctx.landmarks={fireDistance:2};
 const dynamic=id=>(camp.items.get(id).group.userData.fireOrigin??
   camp.items.get(id).group).userData.dynamicLight;
 for(const id of [1,2,3])dynamic(id).shadow={autoUpdate:false,needsUpdate:false};
 camp.tick(1000);
 const shadows=[...camp.items.values()].filter(x=>x.group.userData.light?.castShadow);
 assert.equal(shadows.length,3,'all built fires retain cached shadows with a shared budget');
 assert.equal(dynamic(1).shadow.autoUpdate,true,'nearest built fire gets the live slot');
 assert.equal(dynamic(2).shadow.autoUpdate,false,'second built fire remains cached');
 assert.equal(dynamic(3).shadow.autoUpdate,false,'third built fire remains cached');
 ctx.landmarks.fireDistance=100;
 camp.tick(1200);
 assert.equal(shadows.length,3);
 assert.equal(dynamic(1).shadow.autoUpdate,true);
 assert.equal(dynamic(2).shadow.autoUpdate,true,'freed starter slot refreshes second built fire');
 assert.equal(dynamic(3).shadow.autoUpdate,false);
});

test('shadow budget slider switches built lights between 0, 1, 2, 3 and 4 including starter',()=>{
 const {camp,ctx}=fixture();
 ctx.settings={fireShadows:true,fireShadowLimit:2,performancePreset:'high'};
 ctx.terrain.nightBlend=1;
 camp.add(item(201,'torch',3,0,0,true));
 camp.add(item(202,'campfire',7,0,0,true));
 camp.add(item(203,'torch',11,0,0,true));
 const fires=[201,202,203].map(id=>camp.items.get(id).group.userData.light);
 for(const light of fires)light.shadow={autoUpdate:false,needsUpdate:false};
 for(const id of [201,202,203])(camp.items.get(id).group.userData.fireOrigin??camp.items.get(id).group).userData.dynamicLight.shadow={autoUpdate:false,needsUpdate:false};
 ctx.landmarks={fireDistance:1};
 for(let limit=0;limit<=4;limit++){
  ctx.settings.fireShadowLimit=limit;
  camp.tick(1000+limit*200);
  const actual=fires.filter(light=>light.castShadow);
  assert.equal(actual.length,3,'all three static shadow maps remain visible, budget '+limit);
  for(let i=0;i<fires.length;i++){
   const light=fires[i];
   assert.equal(light.shadow.autoUpdate,false,'static shadow maps are cached');
   const source=(camp.items.get([201,202,203][i]).group.userData.fireOrigin??camp.items.get([201,202,203][i]).group).userData.dynamicLight;
   assert.equal(source.castShadow,true,'dynamic shadow sampling remains enabled');
   assert.equal(source.shadow.autoUpdate,i<Math.max(0,limit-1),
     'only '+Math.max(0,limit-1)+' built maps update when starter has a slot');
  }
 }
 // Remove starter and use all three built fires.
 ctx.landmarks.fireDistance=Infinity;
 ctx.settings.fireShadowLimit=3;
 camp.tick(2200);
 assert.equal(fires.filter(x=>x.castShadow).length,3);
 ctx.settings.fireShadowLimit=0;
 camp.tick(2400);
 assert.equal(fires.filter(x=>x.castShadow).length,3,'all cached maps remain at budget zero');
 for(const id of [201,202,203]){
  const dynamic=(camp.items.get(id).group.userData.fireOrigin??
    camp.items.get(id).group).userData.dynamicLight;
  assert.equal(dynamic.shadow.autoUpdate,false,'zero budget disables only per-frame updates');
 }
});


test('fire shadow split mode caches static geometry, updates characters, and switches live',()=>{
 const {camp,ctx}=fixture();
 ctx.settings={fireShadows:true,fireShadowLimit:1,performancePreset:'high',
  splitShadowMaps:true};
 ctx.terrain.nightBlend=1;
 ctx.atmosphere={staticShadowRevision:3};
 camp.add(item(701,'torch',0,0,0,true));
 const data=camp.items.get(701).group.userData;
 const staticLight=data.light,dynamic=data.dynamicLight;
 for(const light of [staticLight,dynamic])
  light.shadow={autoUpdate:false,needsUpdate:false};
 camp.tick(1000);
 assert.equal(staticLight.castShadow,true);
 assert.equal(staticLight.shadow.autoUpdate,false,'static cubemap is cached');
 assert.equal(staticLight.shadow.needsUpdate,true);
 assert.equal(staticLight.userData.shadowRole,'static');
 assert.equal(dynamic.castShadow,true);
 assert.equal(dynamic.shadow.autoUpdate,true,'character cubemap updates each rendered frame');
 assert.equal(dynamic.userData.shadowRole,'dynamic');
 assert.equal(staticLight.intensity,15);
 assert.equal(dynamic.intensity,15);
 staticLight.shadow.needsUpdate=false;
 camp.tick(1200);
 assert.equal(staticLight.shadow.needsUpdate,false,'static map is not redrawn each frame');
 ctx.atmosphere.staticShadowRevision=4;
 camp.tick(1400);
 assert.equal(staticLight.shadow.needsUpdate,true,'world invalidation refreshes static cubemap');
 staticLight.shadow.needsUpdate=false;
 camp.tick(2400);
 assert.equal(staticLight.shadow.needsUpdate,false,'static map remains cached after one second');
 camp.tick(102400);
 assert.equal(staticLight.shadow.needsUpdate,false,'static map stays cached all night without changes');
 ctx.settings.splitShadowMaps=false;
 camp.tick(102600);
 assert.equal(staticLight.intensity,30,'single source retains total brightness');
 assert.equal(dynamic.intensity,0);
 assert.equal(dynamic.visible,false);
 assert.equal(staticLight.userData.shadowRole,'all');
 assert.equal(staticLight.shadow.autoUpdate,true,'single cubemap refreshes every render frame');
 assert.equal(dynamic.shadow.autoUpdate,false);
 assert.equal(dynamic.castShadow,false);
 ctx.settings.splitShadowMaps=true;
 camp.tick(102800);
 assert.equal(staticLight.intensity+dynamic.intensity,30);
 assert.equal(staticLight.shadow.autoUpdate,false);
 assert.equal(dynamic.shadow.autoUpdate,true);
 ctx.terrain.nightBlend=0;
 camp.tick(103000);
 assert.equal(staticLight.castShadow,false,'daylight suppresses shadows in either mode');
 assert.equal(dynamic.castShadow,false);
});

test('split fire uses 100m static PointLight and configured dynamic radius',()=>{
 const {camp,ctx}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={splitShadowMaps:true,fireShadows:true,fireShadowLimit:2,
  performancePreset:'high',campfireNightRadius:18,torchNightRadius:23,
  torchShadowVisibilityDistance:100};
 camp.add(item(801,'torch',70,0,0,true));
 const fire=camp.items.get(801).group.userData;
 for(const source of [fire.light,fire.dynamicLight])
  source.shadow={autoUpdate:false,needsUpdate:false};
 camp.tick(1000);
 assert.equal(fire.light.distance,100,'static PointLight actually reaches 100m');
 assert.equal(fire.dynamicLight.distance,100,'both PointLights illuminate up to activation distance');
 assert.equal(fire.dynamicLight.userData.shadowCasterRange,23,'dynamic casters use shadow-radius slider');
 assert.equal(fire.light.visible,true,'static light is not culled at 30m');
 assert.equal(fire.light.castShadow,true,'far static lamp retains a shadow slot');
 assert.equal(fire.dynamicLight.visible,true,'dynamic lamp illuminates to 100m despite 23m shadow range');
 assert.equal(fire.dynamicLight.castShadow,true,'distant dynamic shadows remain sampled');
 assert.equal(fire.dynamicLight.shadow.autoUpdate,false,'but cached far from the caster range');
 assert.equal(fire.dynamicLight.userData.shadowFrozen,true);
 assert.equal(fire.light.shadow.autoUpdate,false);
 assert.equal(fire.light.shadow.needsUpdate,true);
 fire.light.shadow.needsUpdate=false;
 camp.tick(600000);
 assert.equal(fire.light.shadow.needsUpdate,false,'static light does not redraw after many minutes');
 ctx.settings.torchLightHeight=3.5;
 camp.tick(600200);
 assert.equal(fire.light.position.y,3.5);
 assert.equal(fire.light.shadow.needsUpdate,true,'moving emitter height invalidates cached static shadows');
 fire.light.shadow.needsUpdate=false;
 ctx.px=55;
 camp.tick(600400);
 assert.equal(fire.light.distance,100);
 assert.equal(fire.dynamicLight.distance,100);
 assert.equal(fire.dynamicLight.visible,true);
 assert.equal(fire.dynamicLight.castShadow,true);
 assert.equal(fire.dynamicLight.shadow.autoUpdate,true);
 ctx.settings.splitShadowMaps=false;
 camp.tick(600600);
 assert.equal(fire.light.distance,100,'single lamp keeps illumination independent of shadow radius');
 assert.equal(fire.light.userData.shadowCasterRange,23);
 assert.equal(fire.dynamicLight.visible,false);
 assert.equal(fire.light.intensity,30);
 assert.equal(fire.light.castShadow,true);
 assert.equal(fire.light.shadow.autoUpdate,true);
 ctx.px=-50;
 camp.tick(600800);
 assert.equal(fire.light.visible,false,'single lamp is culled beyond 100m');
 ctx.settings.splitShadowMaps=true;
 camp.tick(601000);
 assert.equal(fire.light.distance,100);
 assert.equal(fire.light.visible,false,'split lamp also deactivates beyond illumination distance');
 assert.equal(fire.dynamicLight.visible,false);
 assert.equal(fire.light.castShadow,false);
 assert.equal(fire.light.shadow.autoUpdate,false);
});

test('split campfire inherits the 100m static radius and keeps own dynamic slider',()=>{
 const {camp,ctx}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={splitShadowMaps:true,fireShadows:true,fireShadowLimit:1,
  performancePreset:'high',campfireNightRadius:14};
 camp.add(item(802,'campfire',5,0,0,true));
 camp.tick(1000);
 const origin=camp.items.get(802).group.userData.fireOrigin;
 assert.equal(origin.userData.light.distance,100);
 assert.equal(origin.userData.dynamicLight.distance,100);
 assert.equal(origin.userData.dynamicLight.userData.shadowCasterRange,14);
 assert.equal(origin.userData.light.castShadow,true);
 assert.equal(origin.userData.dynamicLight.castShadow,true);
});

test('short 9m shadows coexist with 150m light range, slow decay and cached lights',()=>{
 const {ctx,camp}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={splitShadowMaps:true,fireShadows:true,fireShadowLimit:2,
  performancePreset:'high',torchVisibilityDistance:150,torchDecay:.4,
  torchNightRadius:9,fireStaticShadowRadius:9};
 camp.add(item(851,'torch',40,0,0,true));
 const data=camp.items.get(851).group.userData;
 const originalStatic=data.light,originalDynamic=data.dynamicLight;
 originalStatic.shadow={autoUpdate:false,needsUpdate:false,camera:{far:150}};
 originalDynamic.shadow={autoUpdate:false,needsUpdate:false,camera:{far:150}};
 camp.tick(1000);
 for(const light of [originalStatic,originalDynamic]){
  assert.equal(light.visible,true,'both lamps still illuminate 40m away');
  assert.equal(light.distance,150,'illumination distance follows new range slider');
  assert.equal(light.decay,.4);
  assert.equal(light.userData.shadowCasterRange,9);
  assert.equal(light.castShadow,false,'no active shadow passes past the 9m range');
  assert.equal(light.shadow.camera.far,151,'shadow depth sampling covers the full light range');
 }
 ctx.px=36;
 camp.tick(1200);
 assert.equal(originalStatic.castShadow,true,'static shadow pass activates within 9m');
 assert.equal(originalStatic.shadow.autoUpdate,false);
 assert.equal(originalDynamic.castShadow,true);
 assert.equal(originalDynamic.shadow.autoUpdate,true);
 originalStatic.shadow.needsUpdate=false;
 ctx.settings.fireStaticShadowRadius=4;
 camp.tick(1400);
 assert.equal(originalStatic.userData.shadowCasterRange,4);
 assert.equal(originalStatic.shadow.needsUpdate,true,'static shadow radius invalidates cached map');
 ctx.settings.splitShadowMaps=false;
 camp.tick(1600);
 assert.equal(originalStatic.distance,150);
 assert.equal(originalStatic.decay,.4);
 assert.equal(originalStatic.intensity,30,'single light restores full brightness');
 assert.equal(originalDynamic.visible,false);
 assert.equal(originalStatic.userData.shadowCasterRange,9);
 ctx.px=240;
 camp.tick(1800);
 assert.equal(originalStatic.visible,false,'lamp turns off only beyond activation slider');
 ctx.px=40;
 ctx.settings.splitShadowMaps=true;
 camp.tick(2000);
 assert.equal(data.light,originalStatic,'static PointLight is reused, not constructed again');
 assert.equal(data.dynamicLight,originalDynamic,'dynamic PointLight is reused, not constructed again');
 assert.equal(data.light.visible,true);
 assert.equal(data.dynamicLight.visible,true);
 assert.equal(data.light.distance,150);
 assert.equal(data.light.decay,.4);
});

test('activation limit is applied per fire kind without changing shadow-caster distance',()=>{
 const {ctx,camp}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={splitShadowMaps:true,fireShadows:true,fireShadowLimit:2,
  performancePreset:'high',campfireVisibilityDistance:25,torchVisibilityDistance:200,
  campfireNightRadius:9,torchNightRadius:9,fireStaticShadowRadius:9,
  campfireDecay:0,torchDecay:3};
 camp.add(item(852,'campfire',40,0,0,true));
 camp.add(item(853,'torch',60,0,0,true));
 camp.tick(1000);
 const campfire=camp.items.get(852).group.userData;
 const torch=camp.items.get(853).group.userData;
 assert.equal(campfire.light.visible,false,'campfire switches off past 25m');
 assert.equal(torch.light.visible,true,'torch stays visible to 200m');
 assert.equal(campfire.light.decay,0);
 assert.equal(torch.light.decay,3);
 assert.equal(torch.light.userData.shadowCasterRange,9);
 ctx.px=20;
 camp.tick(1200);
 assert.equal(campfire.light.visible,true);
 assert.equal(campfire.light.decay,0);
});

test('illumination radius and lamp culling are independent for torch and campfire',()=>{
 const {ctx,camp}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={splitShadowMaps:true,fireShadows:true,fireShadowLimit:2,
  performancePreset:'high',
  torchVisibilityDistance:30,torchActivationDistance:200,
  campfireVisibilityDistance:200,campfireActivationDistance:20,
  torchNightRadius:9,campfireNightRadius:9,fireStaticShadowRadius:9};
 camp.add(item(861,'torch',80,0,0,true));
 camp.add(item(862,'campfire',40,0,0,true));
 camp.tick(1000);
 const torch=camp.items.get(861).group.userData;
 const campfire=camp.items.get(862).group.userData;
 const campfireDynamic=(campfire.fireOrigin??camp.items.get(862).group).userData.dynamicLight;
 assert.equal(torch.light.distance,30,'torch illuminates only 30m');
 assert.equal(torch.light.visible,true,'torch stays active at 80m for possible off-camera illumination');
 assert.equal(torch.dynamicLight.distance,30);
 assert.equal(torch.dynamicLight.visible,true);
 assert.equal(campfire.light.distance,200,'campfire can illuminate to 200m');
 assert.equal(campfire.light.visible,false,'campfire is deactivated at 40m');
 assert.equal(campfireDynamic.visible,false);
 ctx.px=24;
 camp.tick(1200);
 assert.equal(campfire.light.visible,true,'campfire activates within 20m');
 assert.equal(campfire.light.distance,200,'culling change does not touch light distance');
 ctx.settings.torchActivationDistance=10;
 camp.tick(1400);
 assert.equal(torch.light.visible,false,'changing culling distance deactivates torch');
 assert.equal(torch.light.distance,30,'changing culling never changes light range');
 ctx.settings.torchVisibilityDistance=250;
 camp.tick(1600);
 assert.equal(torch.light.visible,false,'large illumination range does not override culling');
 assert.equal(torch.light.distance,250);
 ctx.settings.torchActivationDistance=250;
 camp.tick(1800);
 assert.equal(torch.light.visible,true,'torch reuses its own PointLight when activated');
 assert.equal(torch.light.distance,250);
});

test('inactive near fires cannot consume active slots reserved for more distant torches',()=>{
 const {ctx,camp}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={splitShadowMaps:true,fireShadows:true,fireShadowLimit:4,
  performancePreset:'high',campfireActivationDistance:10,torchActivationDistance:200};
 for(let n=0;n<4;n++)camp.add(item(870+n,'campfire',30+n*3,0,0,true));
 camp.add(item(880,'torch',65,0,0,true));
 camp.tick(1000);
 for(let n=0;n<4;n++)
  assert.equal(camp.items.get(870+n).group.userData.light.visible,false);
 assert.equal(camp.items.get(880).group.userData.light.visible,true,
  'torch farther away still gets an available light slot');
});

test('9m dynamic shadow calculation is cached and visible at 30m from torch',()=>{
 const {camp,ctx}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={splitShadowMaps:true,fireShadows:true,fireShadowLimit:1,
  performancePreset:'high',torchNightRadius:9,torchShadowVisibilityDistance:30,
  fireStaticShadowRadius:9,torchVisibilityDistance:90,torchActivationDistance:100};
 camp.add(item(891,'torch',0,0,0,true));
 const origin=camp.items.get(891).group.userData;
 const staticLight=origin.light,dynamic=origin.dynamicLight;
 for(const source of [staticLight,dynamic])
  source.shadow={autoUpdate:false,needsUpdate:false};
 ctx.px=4;
 camp.tick(1000);
 assert.equal(staticLight.userData.shadowCasterRange,9);
 assert.equal(dynamic.userData.shadowCasterRange,9);
 assert.equal(staticLight.castShadow,true);
 assert.equal(dynamic.castShadow,true);
 assert.equal(dynamic.shadow.autoUpdate,true);
 assert.equal(dynamic.userData.shadowFrozen,false);
 // Cross the 9m caster boundary with the +2m geometry safety margin.
 dynamic.shadow.needsUpdate=false;
 staticLight.shadow.needsUpdate=false;
 ctx.px=25;
 camp.tick(1200);
 assert.equal(dynamic.castShadow,true,'dynamic shadow remains visible from 25m');
 assert.equal(staticLight.castShadow,true,'static shadow remains visible from 25m');
 assert.equal(dynamic.shadow.autoUpdate,false,'dynamic map stops updating');
 assert.equal(dynamic.shadow.needsUpdate,false,'no redraw when shadow map is frozen');
 assert.equal(dynamic.userData.shadowFrozen,true);
 assert.equal(staticLight.shadow.needsUpdate,false,'static shadow is not regenerated on exit');
 dynamic.shadow.needsUpdate=false; // Renderer has already completed its last live frame.
 camp.tick(1400);
 assert.equal(dynamic.shadow.needsUpdate,false,'no additional redraw while away');
 ctx.px=8;
 camp.tick(1600);
 assert.equal(dynamic.castShadow,true);
 assert.equal(dynamic.shadow.autoUpdate,true,'returns to frame-by-frame updates');
 assert.equal(dynamic.userData.shadowFrozen,false);
 dynamic.shadow.needsUpdate=false;
 ctx.px=25;
 camp.tick(1800);
 assert.equal(dynamic.shadow.needsUpdate,false,'frozen character shadow keeps its last frame');
 dynamic.shadow.needsUpdate=false;
 ctx.px=33;
 camp.tick(2000);
 assert.equal(dynamic.castShadow,false,'shadow visibility 30m is independent from lighting');
 assert.equal(staticLight.castShadow,false);
 assert.equal(staticLight.visible,true,'lamp remains active at 33m');
 assert.equal(staticLight.distance,90);
});

test('single PointLight freezes combined shadow map but preserves static casters',()=>{
 const {camp,ctx}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={splitShadowMaps:false,fireShadows:true,fireShadowLimit:1,
  performancePreset:'high',campfireNightRadius:9,
  campfireShadowVisibilityDistance:30,campfireActivationDistance:100};
 camp.add(item(892,'campfire',0,0,0,true));
 const origin=(camp.items.get(892).group.userData.fireOrigin
  ??camp.items.get(892).group).userData;
 const light=origin.light;
 light.shadow={autoUpdate:false,needsUpdate:false};
 ctx.px=4;
 camp.tick(1000);
 assert.equal(light.castShadow,true);
 assert.equal(light.shadow.autoUpdate,true);
 assert.equal(light.userData.shadowFrozen,false);
 light.shadow.needsUpdate=false;
 ctx.px=25;
 camp.tick(1200);
 assert.equal(light.castShadow,true);
 assert.equal(light.shadow.autoUpdate,false);
 assert.equal(light.shadow.needsUpdate,false,'single lamp preserves the last combined cubemap');
 assert.equal(light.userData.shadowFrozen,true);
 light.shadow.needsUpdate=false;
 camp.tick(1400);
 assert.equal(light.shadow.needsUpdate,false);
 ctx.atmosphere={staticShadowRevision:4};
 camp.tick(1600);
 assert.equal(light.shadow.needsUpdate,true,'world edits invalidate frozen combined map');
 light.shadow.needsUpdate=false;
 ctx.px=7;
 camp.tick(1800);
 assert.equal(light.shadow.autoUpdate,true);
 assert.equal(light.userData.shadowFrozen,false);
});

test('torch and campfire independently select shadow visibility distance',()=>{
 const {camp,ctx}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={splitShadowMaps:true,fireShadows:true,fireShadowLimit:2,
  performancePreset:'high',torchNightRadius:9,campfireNightRadius:9,
  torchShadowVisibilityDistance:60,campfireShadowVisibilityDistance:15,
  torchActivationDistance:100,campfireActivationDistance:100};
 camp.add(item(893,'torch',35,0,0,true));
 camp.add(item(894,'campfire',25,0,0,true));
 camp.tick(1000);
 const torch=camp.items.get(893).group.userData.light;
 const fire=camp.items.get(894).group.userData.light;
 assert.equal(torch.castShadow,true,'torch remains shadow-visible at 35m');
 assert.equal(fire.castShadow,false,'campfire shadows are hidden at 25m');
 assert.equal(torch.visible,true);
 assert.equal(fire.visible,true,'illumination remains active after shadow visibility ends');
 ctx.px=12;
 camp.tick(1200);
 assert.equal(fire.castShadow,true,'campfire shadow reactivates inside 15m');
});

test('four lights retain cached maps while two live update slots follow the player',()=>{
 const {ctx,camp}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={splitShadowMaps:false,fireShadows:true,fireShadowLimit:2,
  performancePreset:'high',torchNightRadius:6,torchShadowVisibilityDistance:30,
  torchVisibilityDistance:30,torchActivationDistance:60};
 const lights=[];
 for(const [i,x] of [0,4,8,12].entries()){
  camp.add(item(910+i,'torch',x,0,0,true));
  const light=camp.items.get(910+i).group.userData.light;
  light.shadow={autoUpdate:false,needsUpdate:false};
  lights.push(light);
 }
 const check=(liveIds)=>{
  const live=new Set(liveIds);
  for(let i=0;i<4;i++){
   const light=lights[i];
   assert.equal(light.visible,true,'all four lamps remain on');
   assert.equal(light.castShadow,true,'all four maps are sampled');
   assert.equal(light.shadow.autoUpdate,live.has(i),'only two sources refresh');
   assert.equal(light.userData.shadowFrozen,!live.has(i));
  }
 };
 ctx.px=0;camp.tick(1000);
 check([0,1]);
 lights.forEach(light=>{light.shadow.needsUpdate=false;});
 ctx.px=12;camp.tick(1200);
 check([2,3]);
 assert.equal(lights[0].shadow.needsUpdate,false,'leaving live budget preserves cached map');
 assert.equal(lights[1].shadow.needsUpdate,false);
 lights.forEach(light=>{light.shadow.needsUpdate=false;});
 camp.tick(1400);
 check([2,3]);
 assert.equal(lights[0].shadow.needsUpdate,false,'no repeated frozen map updates');
 ctx.settings.fireShadowLimit=0;camp.tick(1600);
 check([]);
 lights.forEach(light=>{light.shadow.needsUpdate=false;});
 camp.tick(1800);
 assert.equal(lights.every(light=>!light.shadow.needsUpdate),true);
 ctx.settings.fireShadowLimit=2;ctx.px=6;camp.tick(2000);
 check([1,2]);
});

test('split maps show cached static shadows on every in-range fire',()=>{
 const {ctx,camp}=fixture();
 ctx.terrain.nightBlend=1;
 ctx.settings={splitShadowMaps:true,fireShadows:true,fireShadowLimit:2,
  performancePreset:'high',torchNightRadius:6,torchShadowVisibilityDistance:30,
  fireStaticShadowRadius:9,torchVisibilityDistance:30,torchActivationDistance:60};
 const entries=[];
 for(const [i,x] of [0,3,6,9].entries()){
  camp.add(item(920+i,'torch',x,0,0,true));
  const data=camp.items.get(920+i).group.userData;
  data.light.shadow={autoUpdate:false,needsUpdate:false};
  data.dynamicLight.shadow={autoUpdate:false,needsUpdate:false};
  entries.push(data);
 }
 const check=(liveIds)=>{
  const live=new Set(liveIds);
  for(let i=0;i<4;i++){
   const data=entries[i];
   assert.equal(data.light.castShadow,true);
   assert.equal(data.light.shadow.autoUpdate,false);
   assert.equal(data.dynamicLight.castShadow,true);
   assert.equal(data.dynamicLight.shadow.autoUpdate,live.has(i));
  }
 };
 ctx.px=0;camp.tick(1000);check([0,1]);
 ctx.px=9;camp.tick(1200);check([2,3]);
 ctx.settings.fireShadowLimit=0;camp.tick(1400);check([]);
});
