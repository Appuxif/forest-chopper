import test from 'node:test';
import assert from 'node:assert/strict';
import {createControls,buildPlacementShortcut} from '../src/controls.js';

function fixture(){
 const prior={Element:globalThis.Element,document:globalThis.document,
   window:globalThis.window,addEventListener:globalThis.addEventListener};
 class FakeElement{constructor(typing=false){this.typing=typing;}closest(){return this.typing?this:null;}}
 const events=new Map();
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
  renderer:{domElement:{addEventListener(){}}},settings:{mouseSensitivity:1,cameraPitchLimit:80},
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
 return {ctx,keydown,restore,FakeElement,doc};
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
