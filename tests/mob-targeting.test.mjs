import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {MOB_AXE_REACH,mobInteractionPosition,prepareMobRaycast} from '../src/mob-targeting.js';
import {createMobs} from '../src/mobs.js';
import {createMobWorld} from '../src/mob-world.js';
import {CHICKEN_TYPE} from '../src/mob-types.js';
import {createPickupInteraction} from '../src/pickup-interaction.js';
import {createInventoryModel} from '../src/inventory.js';
import {aimState} from '../src/aim-state.js';
import {orbitOffset} from '../src/orbit-camera.js';

const deps=process.env.HEN_PHYSICS_NODE_MODULES;
const three=()=>import(pathToFileURL(deps+'/three/build/three.module.js'));
function skin(T){
 const geometry=new T.SphereGeometry(.25,8,6),count=geometry.attributes.position.count;
 const weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1;
 geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(new Uint16Array(count*4),4));
 geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
 const mesh=new T.SkinnedMesh(geometry,new T.MeshBasicMaterial()),bone=new T.Bone();bone.name='Spine';mesh.add(bone);
 mesh.bind(new T.Skeleton([bone]));mesh.computeBoundingSphere();mesh.computeBoundingBox();
 const visual=new T.Group(),group=new T.Group();visual.add(mesh);group.add(visual);
 return {group,visual,mesh,bone};
}
class Element{
 constructor(tag=''){this.tag=tag;this.dataset={};this.children=[];this.style={};this.attributes={};this.offsetHeight=230;this.offsetWidth=230;this.classList={toggle(){}};}
 setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}
 append(...children){for(const c of children){c.parent=this;this.children.push(c);}}
 replaceChildren(){for(const c of this.children)c.parent=null;this.children=[];}addEventListener(){}
 contains(node){for(;node;node=node.parent)if(node===this)return true;return false;}
 closest(tag){for(let n=this;n;n=n.parent)if(n.tag===tag)return n;return null;}
 click(){this.onclick?.();}
}

test('corpse reach uses the body while live mobs keep their simulation position',()=>{
 const record={hp:0,x:0,z:0},actor={bodyPosition:{x:1.2,y:.3,z:.5}};
 assert.equal(mobInteractionPosition(record,actor),actor.bodyPosition);
 assert.equal(mobInteractionPosition({...record,hp:1},actor).x,0);
 assert.equal(mobInteractionPosition(record,null),record);
 assert.equal(MOB_AXE_REACH,2.6);
});

test('a displaced skinned corpse is raycast at its visible pose, not cached bind bounds',{skip:!deps},async()=>{
 const T=await three(),actor=skin(T);actor.boundsDirty=true;
 actor.bone.position.set(1.5,.3,0);actor.group.updateMatrixWorld(true);
 const ray=new T.Raycaster(new T.Vector3(1.5,1.5,2),new T.Vector3(0,-1.2,-2).normalize());
 assert.equal(ray.intersectObject(actor.group,true).length,0,'fixture must reproduce stale skin bounds');
 prepareMobRaycast(actor);
 assert.ok(ray.intersectObject(actor.group,true).length>0);
 assert.equal(actor.boundsDirty,false);
 const oldRay=new T.Raycaster(new T.Vector3(0,1.5,2),new T.Vector3(0,-1.5,-2).normalize());
 assert.equal(oldRay.intersectObject(actor.group,true).length,0,'no invisible trail at the old pose');
 let scans=0;actor.mesh.computeBoundingSphere=()=>scans++;
 prepareMobRaycast(actor);assert.equal(scans,0,'stationary corpse bounds are reused');
});

test('restored displaced corpse offers Open, E loots at body range and a wall hides its prompt',{skip:!deps},async()=>{
 const T=await three(),world=createMobWorld({seed:12}),bird=world.tick(0,[{x:0,z:0}])[0];world.hit(bird.id);
 const snapshot=world.snapshot();snapshot.populations.chicken.corpses.find(r=>r.id===bird.id).yaw=0;
 snapshot.poses=[{id:bird.id,bones:[{name:'Spine',p:[1.5,.3,0],q:[0,0,0,1]}]}];
 const previous={document:globalThis.document,matchMedia:globalThis.matchMedia,innerWidth:globalThis.innerWidth,innerHeight:globalThis.innerHeight};
 globalThis.document={createElement:tag=>new Element(tag),head:new Element(),body:new Element(),addEventListener(){}};
 globalThis.matchMedia=()=>({matches:false});
 globalThis.innerWidth=800;globalThis.innerHeight=600;
 try{
  const camera=new T.PerspectiveCamera(60,1,.01,100),scene=new T.Scene(),state=createInventoryModel(),sounds=[];
  const canvas={},host=new Element('div'),crosshair=new Element('div');
  host.append(canvas,crosshair);canvas.parentElement=host;crosshair.parentElement=host;document.body.append(host);
  const ctx={THREE:T,seed:12,px:bird.x+4.2,pz:bird.z,scene,camera,renderer:{domElement:canvas},trees:new Map(),placed:[],
   terrain:{heightAt:()=>0,waterDepthAt:()=>0},settings:{dayCycleEnabled:true},isOnline:()=>false,
   inventory:{state,render(){}},audio:{effect:s=>sounds.push(s)},$:()=>null};
  camera.position.set(ctx.px,1.6,ctx.pz);camera.lookAt(bird.x+1.5,.3,bird.z);camera.updateMatrixWorld(true);
  const mobs=await createMobs(ctx,{loadAssets:async()=>new Map([['chicken',{definition:CHICKEN_TYPE,clips:new Map(),speeds:new Map(),create:()=>skin(T)}]])});
  ctx.mobs=mobs;assert.equal(mobs.restore(snapshot),true);mobs.tick(0);
  assert.ok(Math.hypot(bird.x-ctx.px,bird.z-ctx.pz)>2.8,'death record is out of reach');
  const candidate=mobs.candidate();assert.equal(candidate?.id,bird.id);assert.ok(candidate.distance<=2.8);
  const projected=new T.Vector3(candidate.x,candidate.y,candidate.z).project(camera);
  assert.ok(Math.hypot(projected.x,projected.y)<1e-6,'prompt is attached to crosshair hit');
  ctx.pickupInteraction=createPickupInteraction(ctx);
  assert.equal(ctx.pickupInteraction.update()?.id,bird.id,'visible body gets the reticle prompt');
  assert.equal(ctx.pickupInteraction.interact(),true);assert.equal(mobs.opened,bird.id);
  assert.equal(ctx.pickupInteraction.interact(),true);assert.ok(state.count('chicken_meat')>0);assert.deepEqual(sounds,['pickup']);
  const panel=host.children.find(e=>e.tag==='section');
  assert.ok(panel,'loot panel must share the game host with the crosshair instead of a body-level stacking context');
  assert.equal(panel.parent,crosshair.parentElement);
  document.pointerLockElement=canvas;
  document.elementFromPoint=()=>panel.children.find(e=>e.dataset.item==='feather');
  assert.equal(mobs.updatePanelAim()?.actionable,true);assert.equal(mobs.panelAimed,true);
  const bodyScreen=new T.Vector3(bird.x+1.5,.3,bird.z).project(camera);
  assert.ok(parseFloat(panel.style.top)+panel.offsetHeight<bodyScreen.y*-.5*innerHeight+innerHeight/2,'panel is anchored above the body');
  const bottom=parseFloat(panel.style.top)+panel.offsetHeight;panel.offsetHeight=185;mobs.updatePanelAim();
  assert.ok(Math.abs(parseFloat(panel.style.top)+panel.offsetHeight-bottom)<1e-6,'removing rows keeps the lower edge stable');panel.offsetHeight=230;
  const oldPosition=camera.position.clone(),oldRotation=camera.quaternion.clone(),oldPx=ctx.px,oldPz=ctx.pz;
  const pitch=-80*Math.PI/180,offset=orbitOffset(0,pitch,1.7,.4);ctx.px=bird.x+1.5;ctx.pz=bird.z+.25;
  camera.position.set(ctx.px+offset.x,2.3+offset.y,ctx.pz+offset.z);camera.rotation.set(pitch,0,0);camera.updateMatrixWorld(true);mobs.updatePanelAim();
  assert.ok(parseFloat(panel.style.top)+panel.offsetHeight-35<=innerHeight/2+19,'close row reaches the crosshair before the downward camera limit when close to the body');
  ctx.px=oldPx;ctx.pz=oldPz;camera.position.copy(oldPosition);camera.quaternion.copy(oldRotation);camera.updateMatrixWorld(true);mobs.updatePanelAim();
  const oldLeft=panel.style.left;camera.lookAt(bird.x+1.5,.3,bird.z+.2);camera.updateMatrixWorld(true);mobs.updatePanelAim();
  assert.notEqual(panel.style.left,oldLeft,'panel stays at its world anchor when the camera turns');
  const click={pointerType:'mouse',button:0,preventDefault(){},stopImmediatePropagation(){}};
  document.elementFromPoint=()=>panel.children.at(-1);assert.equal(mobs.handlePointer(click),true);
  assert.equal(mobs.opened,null);assert.equal(state.count('feather'),0,'manual close must not take loot');
  assert.equal(mobs.open(bird.id),true);
  document.elementFromPoint=()=>panel.children.find(e=>e.dataset.item==='feather');
  assert.equal(mobs.handlePointer(click),true);assert.ok(state.count('feather')>0);assert.deepEqual(sounds,['pickup','pickup']);
  assert.equal(mobs.opened,null,'taking the last stack must close immediately');assert.equal(panel.hidden,true);
  assert.equal(mobs.panelAimed,false);assert.equal(document.pointerLockElement,canvas);
  assert.equal(mobs.open(bird.id),false,'empty corpse must never reopen');assert.equal(panel.hidden,true);
  camera.lookAt(bird.x+1.5,.3,bird.z);camera.updateMatrixWorld(true);
  assert.equal(mobs.candidate()?.verb,'Пусто');assert.equal(mobs.candidate()?.empty,true);
  assert.equal(ctx.pickupInteraction.update()?.verb,'Пусто');assert.equal(ctx.pickupInteraction.interact(),true);assert.equal(mobs.opened,null);
  const wall=new T.Mesh(new T.BoxGeometry(.1,3,2),new T.MeshBasicMaterial());
  wall.position.set(ctx.px-1,1,bird.z);wall.updateMatrixWorld(true);ctx.placed.push({mesh:wall});
  assert.equal(mobs.candidate(),null,'world geometry occludes the displaced corpse');
  mobs.clear();
 }finally{
  for(const [key,value] of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;
 }
});

test('runtime rejects axe hits beyond half the old reach, including before sending online packets',{skip:!deps},async()=>{
 const T=await three(),previous=globalThis.document;
 globalThis.document={createElement:()=>new Element(),head:new Element(),body:new Element(),addEventListener(){}};
 try{
  let online=false;const sent=[];
  const ctx={THREE:T,px:0,pz:0,isOnline:()=>online,sendNet:p=>sent.push(p),vitals:{canChop:true,hit:()=>false}};
  const mobs=await createMobs(ctx,{loadAssets:async()=>new Map()});
  const record={id:'hen:test',hp:1,x:2.6001,z:0};
  assert.equal(mobs.hit(record),false);online=true;
  assert.equal(mobs.hit(record),false);assert.equal(sent.length,0);
  assert.equal(mobs.hit({...record,x:2.6}),true);assert.equal(sent[0].type,'mob_hit');
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('live mob reticle shares exact hit detection, range and occlusion with axe targeting',{skip:!deps},async()=>{
 const T=await three(),previous=globalThis.document;
 globalThis.document={createElement:()=>new Element(),head:new Element(),body:new Element(),addEventListener(){}};
 try{
  const camera=new T.PerspectiveCamera(60,1,.01,100);
  const ctx={THREE:T,px:0,pz:0,camera,scene:new T.Scene(),trees:new Map(),placed:[],isOnline:()=>true};
  const mobs=await createMobs(ctx,{loadAssets:async()=>new Map([['chicken',{definition:CHICKEN_TYPE,clips:new Map(),speeds:new Map(),create:()=>skin(T)}]])});
  const row={id:'network-chicken',type:'chicken',x:2.6,y:0,z:0,yaw:0,hp:1,state:'Idle'};
  function update(){mobs.setNetwork({mobs:[row]});mobs.tick(.1);camera.position.set(0,1.5,0);camera.lookAt(row.x,0,0);camera.updateMatrixWorld(true);}
  update();
  assert.equal(mobs.aimed()?.record.id,row.id);
  assert.equal(aimState(false,null,'',null,mobs.aimed()?.record).kind,'mob');
  const wall=new T.Mesh(new T.BoxGeometry(.1,3,2),new T.MeshBasicMaterial());wall.position.x=1;wall.updateMatrixWorld(true);
  ctx.placed.push({mesh:wall});assert.equal(mobs.aimed(),null,'cannot highlight through a wall');
  ctx.placed.length=0;row.x=2.61;update();assert.equal(mobs.aimed(),null,'cannot highlight outside melee reach');
  row.x=2.6;update();camera.lookAt(0,1.5,-1);camera.updateMatrixWorld(true);
  assert.equal(mobs.aimed(),null,'nearby mobs do not highlight unless aimed at');
  assert.equal(aimState(false,null,'',null,mobs.aimed()?.record).kind,'idle');
  row.x=6;update();
  assert.equal(mobs.aimed(),null,'pursuit does not extend axe reach');
  assert.equal(mobs.pursuitTarget()?.id,row.id,'a mob ahead can suppress pickups before reaching melee distance');
  row.x=10.01;update();assert.equal(mobs.pursuitTarget(),null,'distant mobs do not suppress pickups');
  row.x=6;update();row.hp=0;mobs.setNetwork({mobs:[row]});
  assert.equal(mobs.pursuitTarget(),null,'dead mobs cannot keep pursuit active');
  row.hp=1;mobs.setNetwork({mobs:[row]});camera.lookAt(0,1.5,-1);camera.updateMatrixWorld(true);
  assert.equal(mobs.pursuitTarget(),null,'looking away from the mob restores pickup feedback');
  mobs.clear();
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('online corpse closes on authoritative empty update, not an unconfirmed take request',{skip:!deps},async()=>{
 const T=await three(),previous=globalThis.document;
 globalThis.document={createElement:tag=>new Element(tag),head:new Element(),body:new Element(),addEventListener(){}};
 try{
  const sent=[],sounds=[],ctx={THREE:T,px:0,pz:0,isOnline:()=>true,sendNet:p=>sent.push(p),inventory:{state:createInventoryModel(),render(){}},audio:{effect:id=>sounds.push(id)}};
  const mobs=await createMobs(ctx,{loadAssets:async()=>new Map()});
  const row={id:'hen:network:0',type:'chicken',x:0,y:0,z:0,state:'dead',loot:{chicken_meat:1,feather:0}};
  mobs.setNetwork({mobs:[row]});assert.equal(mobs.open(row.id),true);mobs.takeSelected();
  assert.equal(sent[0].type,'mob_take');assert.equal(mobs.opened,row.id);assert.deepEqual(sounds,[]);
  mobs.acceptLoot({corpse_loot:{id:row.id,item:'chicken_meat',count:1}});assert.deepEqual(sounds,['pickup']);
  mobs.setNetwork({mobs:[{...row,loot:{chicken_meat:0,feather:0}}]});
  assert.equal(mobs.opened,null);assert.equal(mobs.open(row.id),false);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
