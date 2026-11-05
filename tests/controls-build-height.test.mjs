import test from 'node:test';
import assert from 'node:assert/strict';
import {createControls,buildPlacementShortcut} from '../src/controls.js';

function fixture(){
 const prior={Element:globalThis.Element,document:globalThis.document,
   window:globalThis.window,addEventListener:globalThis.addEventListener};
 class FakeElement{constructor(typing=false){this.typing=typing;}closest(){return this.typing?this:null;}}
 const events=new Map(),canvasEvents=new Map();
 const doc={activeElement:null,pointerLockElement:null,addEventListener(type,listener){events.set(type,listener)}};
 const win={addEventListener(){}};
 globalThis.Element=FakeElement;globalThis.document=doc;globalThis.window=win;
 globalThis.addEventListener=()=>{};
 const elements=new Map();
 const $=id=>{
  if(!elements.has(id))elements.set(id,{
   style:{},addEventListener(){},getBoundingClientRect(){return {width:10,height:10,left:0,top:0}},
   classList:{toggle(){}}});
  return elements.get(id);
 };
 const ctx={
  renderer:{domElement:{addEventListener:(type,fn)=>canvasEvents.set(type,fn)}},settings:{mouseSensitivity:1,cameraPitchLimit:80},
  thirdPerson:true,yaw:0,pitch:0,buildMode:true,inventory:{selected:'log'},
  keys:{},$,px:0,pz:0,joyX:0,joyY:0,
  buildOffset:{x:0,z:0,height:0},updateChunks(){},
  nudgeLog(axis,step){this.buildOffset[axis]+=step;},
 };
 createControls(ctx);
 function keydown(key,code,{altKey=false,repeat=false,target=new FakeElement()}={}){
  let prevented=false;
  events.get('keydown')({key,code,altKey,repeat,target,
   preventDefault(){prevented=true}});
  return prevented;
 }
 function restore(){
  for(const [key,value] of Object.entries(prior)){
   if(value===undefined)delete globalThis[key];else globalThis[key]=value;
  }
 }
 return {ctx,keydown,restore,FakeElement,doc,canvasEvents};
}

test('Fn laptop PgUp/PgDn works by logical key, even when the physical code differs',()=>{
 const f=fixture();
 try{
  assert.equal(f.keydown('PageUp','ArrowUp'),true);
  assert.equal(f.ctx.buildOffset.height,1);
  assert.equal(f.keydown('PageDown','ArrowDown'),true);
  assert.equal(f.ctx.buildOffset.height,0);
  assert.equal(f.keydown('Unidentified','PageUp'),true);
  assert.equal(f.ctx.buildOffset.height,1);
 }finally{f.restore();}
});

test('Page keys, +/- alternatives and held key repeat all adjust log placement',()=>{
 const f=fixture();
 try{
  for(let i=0;i<5;i++)assert.equal(f.keydown('PageUp','PageUp',{repeat:i>0}),true);
  assert.equal(f.ctx.buildOffset.height,5);
  assert.equal(f.keydown('+','Equal'),true);
  assert.equal(f.ctx.buildOffset.height,6);
  assert.equal(f.keydown('-','NumpadSubtract'),true);
  assert.equal(f.ctx.buildOffset.height,5);
  assert.equal(f.keydown('PageDown','PageDown',{repeat:true}),true);
  assert.equal(f.ctx.buildOffset.height,4);
  assert.equal(f.keydown('ArrowLeft','ArrowLeft',{altKey:true}),true);
  assert.equal(f.ctx.buildOffset.x,-1);
 }finally{f.restore();}
});

test('build hotkeys do not modify height outside log mode or inside text inputs',()=>{
 const f=fixture();
 try{
  f.ctx.buildMode=false;
  assert.equal(f.keydown('PageUp','PageUp'),false);
  f.ctx.buildMode=true;f.ctx.inventory.selected='bench';
  assert.equal(f.keydown('PageUp','PageUp'),false);
  f.ctx.inventory.selected='log';
  assert.equal(f.keydown('PageUp','PageUp',{target:new f.FakeElement(true)}),false);
  assert.equal(f.ctx.buildOffset.height,0);
  assert.equal(buildPlacementShortcut({key:'X',code:'KeyX',altKey:false}),null);
 }finally{f.restore();}
});

test('opened hen inventory consumes E/R before ground pickup or building shortcuts, including empty/repeated E',()=>{
 const f=fixture();let ground=0;const keys=[];
 try{
  f.ctx.pickupInteraction={interact:()=>{ground++;return true;}};
  f.ctx.hens={handleKey:e=>{if(['KeyE','KeyR'].includes(e.code)){keys.push(e.code);return true;}return false;}};
  f.ctx.rotateLog=()=>assert.fail('loot R must not rotate construction');
  assert.equal(f.keydown('e','KeyE'),true);
  assert.equal(f.keydown('e','KeyE',{repeat:true}),true);
  assert.equal(f.keydown('r','KeyR'),true);
  assert.deepEqual(keys,['KeyE','KeyE','KeyR']);assert.equal(ground,0);
  f.ctx.hens.handleKey=()=>false;f.keydown('e','KeyE');assert.equal(ground,1);
 }finally{f.restore();}
});

test('New Forest discards killed mobs and rebuilds their population with the new world seed',async()=>{
 const {createMobWorld}=await import('../src/mob-world.js');
 const f=fixture(),oldRandom=Math.random;
 try{
  const {ctx}=f;ctx.seed=123;let population=createMobWorld({seed:ctx.seed}),clears=0,saved;
  const oldBird=population.tick(0,[{x:0,z:0}])[0];population.hit(oldBird.id);
  assert.equal(population.snapshot().populations.chicken.corpses.length,1);
  ctx.mobs={clear(){clears++;population=null;},tick(){population??=createMobWorld({seed:ctx.seed});return population.tick(0,[{x:ctx.px,z:ctx.pz}]);}};
  Object.assign(ctx,{isOnline:()=>false,trees:new Map(),chunks:new Map(),falling:[],particles:[],placed:[],felled:new Set(),treeDamage:new Map(),
   scene:{remove(){}},inventory:{restore(){}},disposePreview(){},progress:{resetPosition(){}},
   offlineSave:{reset(){},markDirty(){ctx.mobs.tick();saved=population.snapshot();}}});
  Math.random=()=>.5;
  ctx.$('reset').onclick();
  assert.equal(clears,1,'the real reset button must clear the mob runtime');
  assert.equal(saved.seed,ctx.seed);assert.notEqual(saved.seed,123);
  assert.deepEqual(saved.populations.chicken.corpses,[]);
  assert.deepEqual(saved.populations.chicken.generations,[]);
  const birds=ctx.mobs.tick();assert.ok(birds.filter(b=>b.hp>0).length>=3);
  assert.equal(birds.some(b=>b.hp===0),false);
 }finally{Math.random=oldRandom;f.restore();}
});

test('New Forest in online mode never clears the shared mob population',()=>{
 const f=fixture(),oldAlert=globalThis.alert;let alerts=0;
 try{
  globalThis.alert=()=>alerts++;
  f.ctx.isOnline=()=>true;f.ctx.mobs={clear(){assert.fail('must not reset online mobs');}};
  f.ctx.$('reset').onclick();assert.equal(alerts,1);
 }finally{if(oldAlert===undefined)delete globalThis.alert;else globalThis.alert=oldAlert;f.restore();}
});

test('canvas mouse down routes to corpse UI before starting an axe swing or requesting pointer lock',()=>{
 const f=fixture();let attacks=0,consumed=true;
 try{
  f.ctx.chop=()=>attacks++;f.ctx.mobs={handlePointer:()=>consumed};
  f.doc.pointerLockElement=f.ctx.renderer.domElement;
  f.canvasEvents.get('pointerdown')({pointerType:'mouse',button:0});assert.equal(attacks,0);
  consumed=false;f.canvasEvents.get('pointerdown')({pointerType:'mouse',button:0});assert.equal(attacks,1);
 }finally{f.restore();}
});
