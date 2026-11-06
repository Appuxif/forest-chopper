import test from 'node:test';
import assert from 'node:assert/strict';
import {createRagdollStress} from '../src/debug-ragdoll-stress.js';

function fixture({failAt=0,refuseAt=0,wait=async()=>{}}={}){
 const pressed=new Set(),calls={falls:0,stands:0,keys:[],released:0};
 const ragdoll={active:false,physicsError:null,
  state(){return {active:this.active,physicsError:this.physicsError};}};
 const controls={mode:'none',busy:false,
  async ragdoll(){
   calls.falls++;
   if(calls.falls===refuseAt)return false;
   ragdoll.active=true;this.mode='manual';
   return true;
  },
  getUp(){
   calls.stands++;
   ragdoll.active=false;this.mode='none';
   return true;
  }};
 const ctx={px:0,pz:0,feetY:0,yaw:1.5,ownAvatar:{lowerState:'Walk'},
  ragdoll,ragdollControls:controls,isOnline:()=>false,
  deathSystem:{active:false},debugCheats:{flying:false}};
 let time=0;
 const runner=createRagdollStress(ctx,{
  press(code){pressed.add(code);calls.keys.push(code);},
  releaseAll(){pressed.clear();calls.released++;},
  async wait(ms,signal){
   assert.equal(signal.aborted,false);
   time+=ms;ctx.px+=ms/1000;
   ctx.ownAvatar.lowerState=pressed.has('ShiftLeft')?'Run':'Walk';
   if(failAt>0&&calls.falls===failAt&&ragdoll.active){
    ragdoll.active=false;ragdoll.physicsError='unreachable';
    controls.mode='none';
   }
   await wait(ms,signal);
   if(signal.aborted)throw Error('Cancelled');
  },
  now:()=>time,log:{info(){},error(){}},
 });
 return {ctx,calls,pressed,runner};
}

test('N ragdolls use real movement keys, restore original yaw and get up N times',async()=>{
 const f=fixture();
 const report=await f.runner.run(5,{walkMs:100,runMs:120,ragdollMs:200,recoverMs:30});
 assert.equal(report.status,'completed');
 assert.equal(report.completed,5);
 assert.equal(report.requested,5);
 assert.equal(report.cycles.length,5);
 assert.deepEqual(report.cycles.map(c=>c.status),Array(5).fill('passed'));
 assert.equal(f.calls.falls,5);
 assert.equal(f.calls.stands,5);
 assert.equal(f.ctx.yaw,1.5);
 assert.equal(f.pressed.size,0);
 assert.ok(f.calls.keys.includes('KeyW'));
 assert.ok(f.calls.keys.includes('KeyA'));
 assert.ok(f.calls.keys.includes('KeyD'));
 assert.ok(f.calls.keys.includes('KeyS'));
 assert.ok(f.calls.keys.includes('ShiftLeft'));
 assert.equal(new Set(report.cycles.map(c=>c.walk)).size,5);
 assert.equal(new Set(report.cycles.map(c=>c.run)).size,5);
 assert.equal(f.runner.status().status,'completed');
 assert.equal(report.phase,'done');
});

test('WASM physics failure aborts the batch and preserves the first failed cycle',async()=>{
 const f=fixture({failAt:2});
 const result=await f.runner.run(12,{walkMs:100,runMs:100,ragdollMs:200,recoverMs:100});
 assert.equal(result.status,'failed');
 assert.equal(result.completed,1);
 assert.equal(result.cycle,2);
 assert.equal(result.cycles[1].status,'failed');
 assert.equal(result.cycles[1].physicsError,'unreachable');
 assert.match(result.error,/Rapier world.step failed: unreachable/);
 assert.equal(f.calls.falls,2,'must not retry poisoned Rapier');
 assert.equal(f.pressed.size,0);
 assert.equal(f.ctx.yaw,1.5);
});

test('refused ragdoll activation stops the test with error rather than silently passing',async()=>{
 const f=fixture({refuseAt:1});
 const report=await f.runner.run(4,{walkMs:0,runMs:0,ragdollMs:0,recoverMs:0});
 assert.equal(report.status,'failed');
 assert.match(report.error,/Ragdoll activation failed/);
 assert.equal(report.completed,0);
 assert.equal(f.calls.falls,1);
 assert.equal(f.calls.stands,0);
});

test('preflight refuses invalid count, concurrent runs and online game',async()=>{
 const f=fixture({wait:(_,signal)=>new Promise((resolve,reject)=>
  signal.addEventListener('abort',()=>reject(Error('Cancelled')),{once:true}))});
 await assert.rejects(f.runner.run(0),/N must/);
 await assert.rejects(f.runner.run(1001),/N must/);
 await assert.rejects(f.runner.run(1,{runMs:-1}),/runMs must/);
 f.ctx.isOnline=()=>true;
 await assert.rejects(f.runner.run(1),/offline/);
 f.ctx.isOnline=()=>false;
 const ongoing=f.runner.run(3);
 await assert.rejects(f.runner.run(3),/already running/);
 f.runner.cancel();
 const cancelled=await ongoing;
 assert.equal(cancelled.status,'cancelled');
});

test('cancellation releases movement and returns ragdoll to standing',async()=>{
 let signalAbort;
 const f=fixture({wait:(_,signal)=>new Promise((resolve,reject)=>{
  signalAbort=()=>reject(Error('Cancelled'));
  signal.addEventListener('abort',signalAbort,{once:true});
 })});
 const task=f.runner.run(4);
 assert.equal(f.runner.status().status,'running');
 assert.equal(f.runner.cancel().status,'running','cancellation is asynchronous');
 const report=await task;
 assert.equal(report.status,'cancelled');
 assert.equal(report.completed,0);
 assert.equal(f.pressed.size,0);
 assert.equal(f.ctx.yaw,1.5);
 assert.equal(f.runner.status().status,'cancelled');
});

test('cancelling while ragdoll is active stands the player up',async()=>{
 let rejectFall;
 const f=fixture({wait:(ms,signal)=>ms===100
  ?new Promise((resolve,reject)=>{
   rejectFall=reject;
   signal.addEventListener('abort',()=>reject(Error('Cancelled')),{once:true});
  }):Promise.resolve()});
 const task=f.runner.run(7,{walkMs:0,runMs:0,ragdollMs:900,recoverMs:0});
 // The first fall is async. Allow Promise continuations to progress.
 for(let i=0;i<12&&f.calls.falls===0;i++)await Promise.resolve();
 assert.equal(f.calls.falls,1);
 assert.equal(f.ctx.ragdoll.active,true);
 f.runner.cancel();
 const report=await task;
 assert.equal(report.status,'cancelled');
 assert.equal(report.completed,0);
 assert.equal(f.ctx.ragdoll.active,false);
 assert.equal(f.ctx.ragdollControls.mode,'none');
 assert.equal(f.calls.stands,1);
 assert.equal(f.pressed.size,0);
});
