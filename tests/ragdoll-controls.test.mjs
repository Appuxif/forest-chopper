import test from 'node:test';
import assert from 'node:assert/strict';
import {createRagdollControls,bedRestPose} from '../src/ragdoll-controls.js';

function fixture({fail=false,online=false}={}){
 const nodes=[],notices=[],events=[],sent=[];
 const doc={
  head:{append(){}},body:{append(node){nodes.push(node);}},
  createElement(tag){
   return {tag,style:{},hidden:false,disabled:false,attributes:{},
     addEventListener(type,callback){this[type]=callback;}};
  },
 };
 const ctx={
  px:0,pz:0,feetY:0,yaw:0,verticalSpeed:0,onGround:true,
  terrain:{heightAt:()=>0},
  deathSystem:{active:false,setBed(id){events.push(['bedSpawn',id]);return true;}},
  isOnline:()=>online,sendNet(msg){sent.push(msg);},
  ragdoll:{
   active:false,
   async trigger(options){events.push(['trigger',options]);if(fail)throw Error('WASM error');this.active=true;},
   reset(){events.push(['reset']);this.active=false;return true;},
  },
  ownAvatar:{group:{
   position:{clone:()=>({copy(){}}),copy(){},set(){}},
   quaternion:{clone:()=>({copy(){}}),copy(){}},
   rotation:{set(){}},
  }},
  notify(...args){notices.push(args);},
 };
 const controls=createRagdollControls(ctx,doc);
 return {ctx,controls,events,nodes,notices,sent};
}

test('normal-world Ragdoll enters physics and one Jump input just stands up',async()=>{
 const f=fixture();
 assert.equal(f.nodes[0].id,'fc-ragdoll-btn');
 assert.equal(await f.controls.ragdoll(),true);
 assert.equal(f.controls.mode,'manual');
 assert.equal(f.ctx.ragdoll.active,true);
 assert.equal(f.controls.getUp(),true);
 assert.equal(f.controls.mode,'none');
 assert.equal(f.ctx.ragdoll.active,false);
 assert.equal(f.ctx.verticalSpeed,0);
 assert.equal(f.controls.getUp(),false,'second Jump should use normal jump logic');
});
test('sleep on bed triggers ragdoll before setting respawn; wake moves beside foot',async()=>{
 const f=fixture(),bed={id:9,kind:'bed',x:0,z:-1.6,orientation:2};
 const pose=bedRestPose(bed,0);
 assert.equal(await f.controls.sleepInBed(bed),true);
 assert.deepEqual(f.events.map(e=>e[0]),['trigger','bedSpawn']);
 assert.equal(f.controls.mode,'sleep');
 assert.equal(f.ctx.px,pose.x);
 assert.equal(f.ctx.pz,pose.z);
 assert.equal(f.controls.getUp(),true);
 assert.equal(f.ctx.px,pose.wakeX);
 assert.equal(f.ctx.pz,pose.wakeZ);
 assert.equal(f.ctx.verticalSpeed,0);
 assert.equal(f.ctx.onGround,true);
 assert.equal(f.controls.mode,'none');
});
test('failed bed physics never selects a respawn bed or moves player',async()=>{
 const f=fixture({fail:true});
 assert.equal(await f.controls.sleepInBed({id:9,kind:'bed',x:0,z:-1,orientation:0}),false);
 assert.equal(f.controls.mode,'none');
 assert.equal(f.events.some(e=>e[0]==='bedSpawn'),false);
 assert.equal(f.ctx.px,0);assert.equal(f.ctx.pz,0);
 assert.equal(f.controls.getUp(),false);
});
test('death shields stand-up and clears voluntary mode',async()=>{
 const f=fixture();
 assert.equal(await f.controls.ragdoll(),true);
 f.ctx.deathSystem.active=true;
 f.controls.clearForDeath();
 assert.equal(f.controls.getUp(),false);
 assert.equal(f.controls.mode,'none');
});


test('online sleep changes only local pose, not authoritative coordinates',async()=>{
 const f=fixture({online:true});
 const initial={x:f.ctx.px,z:f.ctx.pz};
 assert.equal(await f.controls.sleepInBed({id:44,kind:'bed',x:0,z:-1.4,orientation:3}),true);
 assert.equal(f.controls.mode,'sleep');
 assert.deepEqual([f.ctx.px,f.ctx.pz],[initial.x,initial.z]);
 assert.equal(f.sent.length,0,'the server must not receive non-authoritative teleports');
 assert.equal(f.controls.getUp(),true);
 assert.deepEqual([f.ctx.px,f.ctx.pz],[initial.x,initial.z]);
 assert.equal(f.sent.length,0);
});
