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
 class Geometry{}
 class Mat{}
 const added=[],removed=[],sent=[],saved=[];
 const inventory=createInventoryModel();
 const ctx={
  THREE:{Mesh,Group:Obj,PointLight:Light,BoxGeometry:Geometry,DodecahedronGeometry:Geometry,
    ConeGeometry:Geometry,MeshLambertMaterial:Mat,MeshBasicMaterial:Mat},
  scene:{add:x=>added.push(x),remove:x=>removed.push(x)},
  terrain:flatTerrain(),
  inventory:{state:inventory,render(){}},
  offlineSave:{markDirty(){saved.push(1)}},
  isOnline:()=>online,sendNet:x=>sent.push(x),
  storages:{structures:new Map()},
  px:0,pz:0,yaw:0,orientation:1,wood:0,
  trees:new Map(),placed:[],rockColliders:new Map(),chunkSize:24,logLength:3.6,
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
 assert.equal(physics.blocksPlayerAt(0,0,0),true,'campfire ring blocks walking');
 assert.equal(camp.toggle(-1),true);
 camp.tick(500);
 assert.equal(flame.visible,true);
 assert.equal(fire.group.userData.light.visible,true);
 assert.equal(button.style.display,'block');
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
test('only three nearest lit fires use point lights; rotation and construction geometry collide',()=>{
 const {camp,ctx,physics}=fixture();
 for(let i=0;i<8;i++)camp.add(item(i+1,i===0?'torch':i===1?'table':'campfire',i*5,0,i%4,true&&i!==1));
 camp.tick(1000);
 assert.equal([...camp.items.values()].filter(x=>x.group.userData.light?.visible).length,3);
 assert.equal(physics.blocksPlayerAt(5,0,0),true,'table has footprint collision');
 assert.equal(physics.blocksPlayerAt(5,0,1),false,'table can be stood upon');
 const collision=camp.items.get(2).group.userData.collisionBoxes;
 assert.ok(collision.length>=5);
 assert.ok(camp.items.get(1).group.userData.flame);
});
test('placement consumes the correct ingredients offline; online waits for server',()=>{
 const offline=fixture();
 assert.equal(offline.camp.place('torch'),false);
 offline.inventory.addItem({id:'branch',count:1});
 offline.inventory.addItem({id:'stone',count:3});
 offline.inventory.addItem({id:'dry_grass',count:1});
 assert.equal(offline.camp.place('torch'),true);
 assert.equal(offline.inventory.count('branch'),0);
 assert.equal(offline.inventory.count('stone'),0);
 assert.equal(offline.inventory.count('dry_grass'),0);
 assert.equal(offline.camp.items.size,1);
 assert.ok(offline.saved.length>0);
 const online=fixture(true);
 online.inventory.addItem({id:'branch',count:1});
 online.inventory.addItem({id:'stone',count:3});
 online.inventory.addItem({id:'dry_grass',count:1});
 assert.equal(online.camp.place('torch'),true);
 assert.equal(online.inventory.count('stone'),3,'authoritative server must confirm spending');
 assert.equal(online.camp.items.size,0);
 assert.deepEqual(online.sent[0],{type:'camp_place',kind:'torch',x:0,z:-3,orientation:1});
 online.camp.add(item(44,'torch'));
 assert.equal(online.camp.toggle(44),true);
 assert.deepEqual(online.sent[1],{type:'camp_toggle',id:44});
});
