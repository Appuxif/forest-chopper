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
   pose:()=>null,
   async trigger(options){events.push(['trigger',options]);if(fail)throw Error('WASM error');this.active=true;},
   reset(){events.push(['reset']);this.active=false;return true;},
  },
  ownAvatar:{group:{
   position:{clone:()=>({copy(){}}),copy(){},set(x,y,z){this.x=x;this.y=y;this.z=z;}},
   quaternion:{clone:()=>({copy(){}}),copy(){}},
   rotation:{x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}},
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
test('waking from manual ragdoll realigns avatar root with camera yaw after looking around',async()=>{
 const f=fixture();
 f.ctx.px=3;f.ctx.pz=-8;f.ctx.feetY=1.5;
 f.ctx.yaw=.4;
 assert.equal(await f.controls.ragdoll(),true);
 // Simulate a mouse click acquiring pointer lock and a subsequent look turn.
 f.ctx.yaw=2.3;
 f.ctx.ownAvatar.group.rotation.set(.5,-.7,.8); // stale ragdoll root
 f.ctx.jumpRequested=true;
 assert.equal(f.controls.getUp(),true);
 assert.deepEqual(f.ctx.ownAvatar.group.rotation,{x:0,y:2.3,z:0,set:f.ctx.ownAvatar.group.rotation.set});
 assert.equal(f.ctx.ownAvatar.group.position.x,3);
 assert.equal(f.ctx.ownAvatar.group.position.y,1.5);
 assert.equal(f.ctx.ownAvatar.group.position.z,-8);
 assert.equal(f.ctx.jumpRequested,false);
 assert.equal(f.controls.getUp(),false);
});
test('physical ragdoll pose follows the real fall, then stands on the ground without falling twice',async()=>{
 const f=fixture();
 f.ctx.feetY=9; f.ctx.onGround=false; f.ctx.verticalSpeed=-7;
 f.ctx.ragdoll.pose=()=>({x:4,z:5,hipsY:.65,feetY:-.35,standingHipOffset:1,vy:-.06});
 f.ctx.ragdollStandingSupport=()=>0;
 assert.equal(await f.controls.ragdoll(),true);
 assert.equal(f.controls.syncPose(),true);
 assert.deepEqual([f.ctx.px,f.ctx.pz,f.ctx.feetY],[4,5,0]);
 assert.equal(f.controls.getUp(),true);
 assert.deepEqual([f.ctx.px,f.ctx.pz,f.ctx.feetY],[4,5,0]);
 assert.equal(f.ctx.onGround,true);
 assert.equal(f.ctx.verticalSpeed,0);
});
test('releasing ragdoll midair preserves physical altitude and downward velocity',async()=>{
 const f=fixture();
 f.ctx.feetY=8;
 f.ctx.ragdoll.pose=()=>({x:2,z:-4,hipsY:5.2,feetY:4.2,standingHipOffset:1,vy:-9});
 f.ctx.ragdollStandingSupport=()=>0;
 await f.controls.ragdoll();
 f.controls.syncPose();
 assert.equal(f.ctx.feetY,4.2);
 f.controls.getUp();
 assert.deepEqual([f.ctx.px,f.ctx.pz,f.ctx.feetY],[2,-4,4.2]);
 assert.equal(f.ctx.onGround,false);
 assert.equal(f.ctx.verticalSpeed,-9);
});
test('ragdoll landing on a log ramp returns to its support height',async()=>{
 const f=fixture();
 f.ctx.feetY=6;
 f.ctx.ragdoll.pose=()=>({x:1,z:2,hipsY:3.25,feetY:2.25,standingHipOffset:1,vy:0});
 f.ctx.ragdollStandingSupport=()=>2.58;
 await f.controls.ragdoll();
 f.controls.syncPose();
 f.controls.getUp();
 assert.deepEqual([f.ctx.px,f.ctx.pz,f.ctx.feetY],[1,2,2.58]);
 assert.equal(f.ctx.onGround,true);
});
test('online ragdoll does not overwrite authoritative player coordinates',async()=>{
 const f=fixture({online:true});
 f.ctx.px=1;f.ctx.pz=2;f.ctx.feetY=8;
 f.ctx.ragdoll.pose=()=>({x:5,z:6,hipsY:.6,feetY:-.4,standingHipOffset:1,vy:0});
 await f.controls.ragdoll();
 assert.equal(f.controls.syncPose(),false);
 f.controls.getUp();
 assert.deepEqual([f.ctx.px,f.ctx.pz,f.ctx.feetY],[1,2,8]);
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
 assert.equal(f.ctx.ownAvatar.group.rotation.y,f.ctx.yaw);
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

test('midair recovery does not reset fall tracker; grounded recovery does',async()=>{
 const f=fixture(),events=[];
 f.ctx.fallTracker={reset(){events.push('reset');}};
 f.ctx.ragdoll.pose=()=>({x:1,z:2,hipsY:5,feetY:4,
   standingHipOffset:1,vy:-7});
 f.ctx.ragdollStandingSupport=()=>0;
 await f.controls.ragdoll();
 f.controls.getUp();
 assert.deepEqual(events,[],'keep initial peak of an unfinished fall');
 f.ctx.ragdoll.pose=()=>({x:1,z:2,hipsY:1,feetY:0,
   standingHipOffset:1,vy:0});
 await f.controls.ragdoll();
 f.controls.getUp();
 assert.deepEqual(events,['reset'],'grounded get-up unlocks subsequent falls');
});


test('Rapier failure releases manual controls without changing death or save state',async()=>{
 const f=fixture();
 await f.controls.ragdoll();
 assert.equal(f.controls.mode,'manual');
 f.ctx.ragdoll.reset(); // Physics-failure handler restores actor first.
 f.controls.abort();
 assert.equal(f.controls.mode,'none');
 assert.equal(f.controls.busy,false);
 assert.equal(f.controls.getUp(),false,'Jump returns to normal after physics error');
 assert.equal(f.ctx.deathSystem.active,false);
 assert.equal(f.nodes[0].hidden,false,'manual ragdoll button remains usable');
});
