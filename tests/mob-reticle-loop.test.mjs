import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayer} from '../src/player.js';

function fixture(){
 const noop=()=>{},nodes=new Map(),events=[];
 class Vector3{set(x,y,z){Object.assign(this,{x,y,z});return this;}}
 const $=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},style:{},textContent:'',setAttribute(){}});return nodes.get(id);};
 let target=null,cameraUpdated=false;
 const ctx={THREE:{Vector3},$: $,px:0,pz:0,yaw:0,pitch:0,feetY:0,onGround:true,thirdPerson:false,
  lastTime:1000,frame:0,joyX:0,joyY:0,keys:{},swing:0,particles:[],falling:[],avatars:new Map(),
  camera:{near:.1,position:new Vector3(),rotation:{set(){cameraUpdated=false;}},updateMatrixWorld(){cameraUpdated=true;}},
  axe:{position:{y:0},rotation:{x:0,z:0}},scene:{},renderer:{render:noop},
  rootMotion:{},settings:{maxFps:30,autoSprint:false,tickPhysics:noop,tick:noop},
  mobs:{tick:noop,aimed(){events.push(['aim',cameraUpdated]);return target;}},
  wind:{tick:noop},landmarks:{tick:noop},dayCycle:{tick:noop},emotes:{tick:noop},
  simulateVertical:noop,moveHorizontal:noop,terrain:{heightAt:()=>0,tick:noop},
  updatePing:noop,offlineSave:{tick:noop},progress:{trackPosition:noop},discoveries:{check:noop},
  updateChunks:noop,updatePreview:noop,aimed:()=>null,highlight:{update:noop},
  isOnline:()=>false,
  tickChopImpact(now,mobTarget){events.push(['impact',mobTarget,$('crosshair').dataset.kind]);},
 };
 const player=createPlayer(ctx);
 return {ctx,events,$,player,setTarget:value=>{target=value;}};
}

test('mob crosshair updates between world ticks and before impact, even with a render FPS cap',()=>{
 const previous=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>{};
 try{
  const f=fixture();f.player.animate(1000);assert.equal(f.$('crosshair').dataset.kind,'idle');
  f.events.length=0;
  const target={record:{id:'hen:test',hp:1,displayName:'Курица'}};f.setTarget(target);
  f.player.animate(1016); // Only 16 ms later: neither the 120 ms HUD tick nor 30 FPS render is due.
  assert.equal(f.$('crosshair').dataset.kind,'mob');
  assert.equal(f.$('crosshair').textContent,'⌑');
  assert.equal(f.$('crosshair').style.color,'#ff7979');
  assert.deepEqual(f.events,[['aim',true],['impact',target,'mob']],
   'the reticle and impact share one query with current camera matrices');
  f.setTarget(null);f.player.animate(1032);
  assert.equal(f.$('crosshair').dataset.kind,'idle','looking away clears red without waiting 120 ms');
 }finally{if(previous===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=previous;}
});

test('dead mob or building mode clears an earlier living-mob reticle on the next frame',()=>{
 const previous=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>{};
 try{
  for(const mode of ['dead','building']){
   const f=fixture(),target={record:{id:'hen:test',hp:1}};
   f.setTarget(target);f.player.animate(1000);assert.equal(f.$('crosshair').dataset.kind,'mob');
   if(mode==='dead')target.record.hp=0;else f.ctx.buildMode=true;
   f.player.animate(1016);assert.notEqual(f.$('crosshair').dataset.kind,'mob');
  }
 }finally{if(previous===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=previous;}
});

test('sprinting after a visible mob suppresses nearby pickup coloring until stopping or looking away',()=>{
 const previous=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>{};
 try{
  const f=fixture(),item={type:'resource',id:'branch',label:'Ветка'};
  let pursuit={id:'hen:test',hp:1};
  f.ctx.mobs.pursuitTarget=()=>pursuit;
  f.ctx.pickupInteraction={update(){},current:item};
  f.player.animate(1000);assert.equal(f.$('crosshair').dataset.kind,'pickup');
  f.ctx.keys={KeyW:true,ShiftLeft:true};f.player.animate(1016);
  assert.equal(f.$('crosshair').dataset.kind,'idle');
  assert.equal(f.ctx.pickupInteraction.current,item,'visual suppression preserves the E interaction');
  f.setTarget({record:pursuit});f.player.animate(1032);
  assert.equal(f.$('crosshair').dataset.kind,'mob');assert.equal(f.$('crosshair').style.color,'#ff7979');
  f.setTarget(null);f.ctx.keys={};f.player.animate(1048);
  assert.equal(f.$('crosshair').dataset.kind,'pickup','stopping restores pickup feedback immediately');
  f.ctx.keys={KeyW:true,ShiftLeft:true};pursuit=null;f.player.animate(1064);
  assert.equal(f.$('crosshair').dataset.kind,'pickup','sprinting without a mob ahead leaves pickups available');
 }finally{if(previous===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=previous;}
});

test('corpse window uses the updated camera, overrides world aim and gives impact no mob target',()=>{
 const previous=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>{};
 try{
  const f=fixture(),ui={inside:true,actionable:true,label:'Закрыть'};
  f.ctx.mobs.updatePanelAim=()=>ui;
  f.ctx.mobs.aimed=()=>assert.fail('window must cover world targets');
  f.player.animate(1000);assert.equal(f.$('crosshair').dataset.kind,'ui');
  assert.deepEqual(f.events,[['impact',null,'ui']]);
 }finally{if(previous===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=previous;}
});
