import test from 'node:test';
import assert from 'node:assert/strict';
import {createDebugPlayers,MAX_DEBUG_PLAYERS} from '../src/debug-players.js';
import {createInventoryModel} from '../src/inventory.js';

function fixture({safe=true}={}){
 const avatars=new Map(),events=[];
 let online=false,clock=0;
 const fakePhysics=[];
 function vec(x,y,z){return {x,y,z,set(a,b,c){this.x=a;this.y=b;this.z=c;return this;}};}
 const ctx={
  px:0,pz:0,yaw:0,avatars,THREE:{},terrain:{
   heightAt(x,z){return 2;},waterDepthAt(){return 0;}
  },
  GRAVITY:19,
  blocksPlayerAt(x,z,y,opts){
   events.push(['collision',x,z,y,opts]);
   return x>5&&x<8&&Math.abs(z)<3;
  },
  addAvatar(data){
   if(avatars.has(data.id))throw Error('duplicate');
   events.push(['join',data.id]);
   const group={position:vec(data.x,data.y,data.z)};
   avatars.set(data.id,{
    group,actor:{group,visual:{},mixer:{stopAllAction(){}}},
    name:data.name,goal:vec(data.x,data.y,data.z),angle:data.yaw,jumping:false
   });
  },
  removeAvatar(id){events.push(['leave',id]);avatars.delete(id);},
  get isOnline(){return ()=>online;},
  get ragdollCamera(){return {enter(){throw Error('must not touch camera')},exit(){throw Error('must not touch camera')}};},
  get ragdollControls(){return {abort(){throw Error('must not reset local player controls')}};},
  get notify(){return ()=>{throw Error('must not show local player ragdoll notifications')};},
 };
 const ragdollFactory=(context)=>{
  const state={active:false};
  fakePhysics.push({context,state});
  return {
   get active(){return state.active;},
   async trigger(){state.active=true;return state;},
   reset(){state.active=false;},
   tick(dt){events.push(['ragdoll',dt]);},
  };
 };
 const controller=createDebugPlayers(ctx,{
  findSafePoint:(unused,x,z)=>safe?{x,y:2,z}:null,
  ragdollFactory,
  now:()=>clock,
 });
 return {controller,ctx,events,avatars,fakePhysics,
  setOnline:v=>{online=v;},setClock:t=>{clock=t;}};
}

test('cheat player is a real multiplayer avatar with independent survival and inventory',()=>{
 const f=fixture();
 const [player]=f.controller.spawn();
 assert.equal(player.name,'Тестовый игрок 1');
 assert.ok(player.id<0);
 assert.equal(f.avatars.has(player.id),true);
 assert.equal(f.avatars.get(player.id).debugSimulated,true);
 assert.deepEqual([player.health,player.hunger,player.stamina],[5,5,5]);
 assert.equal(player.inventory.slots.length,createInventoryModel().slots.length);
 assert.equal(player.inventory.slots[0].id,'axe');
 assert.ok(f.events.some(ev=>ev[0]==='join'&&ev[1]===player.id),
  'same addAvatar path used by real connected players');
 assert.equal(f.controller.size,1);
 assert.equal(f.controller.follow(player.id,true).following,true);
 assert.equal(f.controller.follow(player.id,false).following,false);
 f.controller.clear();
 assert.equal(f.avatars.size,0);
 assert.equal(f.events.at(-1)[0],'leave');
});

test('offline simulated players obey player collision, terrain, water and follow',()=>{
 const f=fixture();
 const [player]=f.controller.spawn();
 const avatar=f.avatars.get(player.id);
 f.controller.follow(player.id,true);
 f.ctx.px=20;
 for(let t=0;t<=3000;t+=20){f.setClock(t);f.controller.tick(t,.02);}
 assert.ok(avatar.goal.x<=5.01,'simulated player cannot walk through blocked wall');
 assert.ok(f.events.some(ev=>ev[0]==='collision'&&ev[4]?.includeTrees===true),
  'the same tree/collision filtering as walking physics is used');
 assert.ok(avatar.goal.x>2,'AI followed the real player before hitting wall');
 assert.ok(f.controller.list()[0].stamina<=5);
 f.controller.clear();
});

test('damage, death, shared ragdoll implementation, respawn and player cleanup',async()=>{
 const f=fixture();
 const [{id}]=f.controller.spawn();
 assert.equal(f.controller.damage(id,1).health,4);
 const dead=f.controller.damage(id,5);
 assert.equal(dead.health,0);
 assert.equal(dead.dead,true);
 assert.equal(f.avatars.get(id).debugDead,true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.fakePhysics.length,1);
 assert.equal(f.fakePhysics[0].state.active,true);
 assert.equal(f.fakePhysics[0].context.ownAvatar,f.avatars.get(id).actor);
 assert.equal(f.fakePhysics[0].context.isOnline(),false,'simulated player is independent of network');
 assert.doesNotThrow(()=>f.fakePhysics[0].context.ragdollCamera.enter());
 assert.doesNotThrow(()=>f.fakePhysics[0].context.ragdollControls.abort());
 f.controller.tick(2000,.02);
 assert.ok(f.events.some(ev=>ev[0]==='ragdoll'));
 const revived=f.controller.respawn(id);
 assert.equal(revived.health,5);
 assert.equal(revived.dead,false);
 assert.equal(f.avatars.get(id).debugDead,false);
 assert.equal(f.fakePhysics[0].state.active,false);
 f.controller.remove(id);
 assert.equal(f.avatars.size,0);
});

test('network transition cleans up all debug avatars; cannot create players online',()=>{
 const f=fixture();
 f.controller.spawn(2);
 assert.equal(f.controller.size,2);
 f.setOnline(true);
 f.controller.tick(1000,.016);
 assert.equal(f.avatars.size,0);
 assert.equal(f.controller.size,0);
 assert.throws(()=>f.controller.spawn(),/только в одиночной игре/);
 assert.throws(()=>f.controller.follow(-1000001),/только в одиночной игре/);
});

test('invalid spawn locations/count and upper limit are checked atomically',()=>{
 const f=fixture();
 assert.throws(()=>f.controller.spawn(0),/Количество/);
 assert.throws(()=>f.controller.spawn(100),/Количество/);
 assert.equal(f.controller.spawn(MAX_DEBUG_PLAYERS).length,MAX_DEBUG_PLAYERS);
 assert.throws(()=>f.controller.spawn(1),/Максимум/);
 assert.equal(f.controller.size,MAX_DEBUG_PLAYERS);
 f.controller.clear();
 const noSpace=fixture({safe:false});
 assert.throws(()=>noSpace.controller.spawn(1),/Нет свободного места/);
 assert.equal(noSpace.avatars.size,0);
});

test('bad Rapier initialization does not crash simulation or corrupt normal avatar',()=>{
 const f=fixture();
 const controller=createDebugPlayers(f.ctx,{
  findSafePoint:(ctx,x,z)=>({x,z,y:2}),
  ragdollFactory:()=>{throw Error('Rapier temporarily unavailable');},
  now:()=>0,
 });
 const [{id}]=controller.spawn();
 const warn=console.warn;
 try{
  console.warn=()=>{};
  const dead=controller.damage(id,5);
  assert.equal(dead.dead,true);
  assert.equal(dead.health,0);
  assert.equal(f.avatars.get(id).debugDead,true);
  assert.doesNotThrow(()=>controller.tick(1000,.016));
  assert.equal(controller.respawn(id).health,5);
  assert.equal(f.avatars.get(id).debugDead,false);
 }finally{console.warn=warn;controller.clear();}
});
