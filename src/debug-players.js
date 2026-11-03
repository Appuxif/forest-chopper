import {createVitals} from './vitals.js';
import {createInventoryModel} from './inventory.js';
import {createRagdoll} from './ragdoll.js?v=20261103-ragdoll-save-recovery1';

export const MAX_DEBUG_PLAYERS=8;
const FOLLOW_DISTANCE=2.8;
const MAX_STEP=.14;

// Runs an offline simulated *client* through the same remote-player model,
// animation, nametag, caster LOD and cleanup path as real multiplayer peers.
// Each simulated player owns a separate survival/inventory/ragdoll state; it
// never changes the real player's inventory or persisted offline save.
export function createDebugPlayers(ctx,{
 findSafePoint,
 ragdollFactory=createRagdoll,
 now=()=>performance.now(),
}={}){
 if(typeof findSafePoint!=='function')throw Error('Safe spawn point finder is required');
 const bots=new Map();
 let sequence=0;
 let lastSimulationAt=null;

 function onlineGuard(){
  if(ctx.isOnline?.())throw Error('Тестовые игроки доступны только в одиночной игре');
 }
 const entry=id=>{
  const bot=bots.get(Number(id));
  if(!bot)throw Error('Тестовый игрок не найден');
  return bot;
 };
 function publicState(bot){
  const {health,hunger,stamina}=bot.vitals.snapshot();
  return {id:bot.id,name:bot.name,
   x:bot.avatar.goal.x,z:bot.avatar.goal.z,
   health,hunger,stamina,following:bot.following,
   dead:bot.dead,ragdoll:bot.ragdoll?.active===true,
   inventory:bot.inventory.serialize(),};
 }
 const list=()=>[...bots.values()].map(publicState);

 function findSpawn(i=0){
  // Side of the local player's view instead of the exact camera position.
  const angle=(ctx.yaw??0)+Math.PI/2;
  const distance=3+i*1.6;
  const x=ctx.px-Math.sin(angle)*distance;
  const z=ctx.pz-Math.cos(angle)*distance;
  return findSafePoint(ctx,x,z,{maxRadius:15});
 }
 function physicalContext(bot){
  const wrapper=Object.create(ctx);
  Object.defineProperties(wrapper,{
   ownAvatar:{get:()=>bot.avatar.actor},
   px:{get:()=>bot.avatar.group.position.x},
   pz:{get:()=>bot.avatar.group.position.z},
   feetY:{get:()=>bot.avatar.group.position.y},
   verticalSpeed:{get:()=>0},
   onGround:{get:()=>true},
   motionVelocity:{get:()=>bot.motion},
  });
  // ctx exposes these as getter-only properties: shadow them explicitly,
  // otherwise an assignment to an inherited accessor throws TypeError.
  Object.defineProperties(wrapper,{
   isOnline:{value:()=>false},
   ragdollCamera:{value:{enter(){},exit(){}}},
   ragdollControls:{value:{abort(){}}},
   notify:{value:message=>console.warn('Debug player ragdoll:',message)},
  });
  return wrapper;
 }
 function createOne(){
  onlineGuard();
  if(bots.size>=MAX_DEBUG_PLAYERS)throw Error('Максимум '+MAX_DEBUG_PLAYERS+' тестовых игроков');
  const position=findSpawn(bots.size);
  if(!position)throw Error('Нет свободного места для тестового игрока рядом');
  // Negative IDs cannot clash with server-assigned positive player IDs.
  const id=-(1_000_000+ ++sequence);
  const name='Тестовый игрок '+sequence;
  ctx.addAvatar({id,name,x:position.x,y:position.y,z:position.z,yaw:ctx.yaw??0});
  const avatar=ctx.avatars.get(id);
  if(!avatar?.actor){
   ctx.removeAvatar(id);
   throw Error('Модель лесоруба ещё не загрузилась');
  }
  const bot={id,name,avatar,spawn:position,following:false,dead:false,
   vitals:createVitals({now:()=>now()/1000}),
   inventory:createInventoryModel(),ragdoll:null,loading:null,
   motion:{x:0,z:0,angularY:0}};
  avatar.debugSimulated=true;
  bots.set(id,bot);
  return publicState(bot);
 }
 function spawn(count=1){
  onlineGuard();
  count=Number(count);
  if(!Number.isInteger(count)||count<1||count>MAX_DEBUG_PLAYERS)
   throw Error('Количество: 1–'+MAX_DEBUG_PLAYERS);
  if(bots.size+count>MAX_DEBUG_PLAYERS)
   throw Error('Максимум '+MAX_DEBUG_PLAYERS+' тестовых игроков');
  const result=[];
  try{
   for(let i=0;i<count;i++)result.push(createOne());
  }catch(error){
   // A batch is atomic; don't leave half the requested players around.
   for(const bot of result)remove(bot.id);
   throw error;
  }
  return result;
 }
 function follow(id,enabled=true){
  onlineGuard();
  const bot=entry(id);
  if(bot.dead)throw Error('Сначала возроди игрока');
  bot.following=!!enabled;
  return publicState(bot);
 }
 function die(bot){
  if(bot.dead)return;
  bot.dead=true;bot.following=false;
  bot.avatar.debugDead=true;
  bot.avatar.jumping=false;
  bot.motion={x:0,z:0,angularY:0};
  // Reuse the very same bone-based Rapier ragdoll implementation as the
  // playable character. A failed or unavailable WASM simulation leaves a
  // stable dead avatar, never crashes the main game loop.
  let physics;
  try{physics=ragdollFactory(physicalContext(bot));}
  catch(error){
   // Debug-only characters must never interrupt the real player's frame.
   console.warn('Debug ragdoll could not initialize:',error);
   return;
  }
  bot.ragdoll=physics;
  const token=bot;
  bot.loading=Promise.resolve().then(()=>physics.trigger({allowOnline:true,impactSpeed:0}))
   .catch(error=>{if(bots.get(bot.id)===token)console.warn('Debug ragdoll unavailable:',error);})
   .finally(()=>{
    if(bots.get(bot.id)!==token||!bot.dead){
     try{physics.reset();}catch(error){console.warn('Debug ragdoll cleanup:',error);}
    }
    bot.loading=null;
   });
 }
 function damage(id,amount=1){
  onlineGuard();
  const bot=entry(id);
  if(bot.dead)return publicState(bot);
  amount=Number(amount);
  if(!Number.isInteger(amount)||amount<1||amount>5)throw Error('Урон: от 1 до 5');
  bot.vitals.damage(amount);
  if(bot.vitals.health<=0)die(bot);
  return publicState(bot);
 }
 function respawn(id){
  onlineGuard();
  const bot=entry(id);
  if(!bot.dead)throw Error('Игрок уже жив');
  const place=findSpawn()??findSafePoint(ctx,bot.spawn.x,bot.spawn.z,{maxRadius:15});
  if(!place)throw Error('Нет свободной точки возрождения');
  bot.dead=false;bot.avatar.debugDead=false;
  bot.ragdoll?.reset();
  bot.ragdoll=null;
  bot.avatar.group.position.set(place.x,place.y,place.z);
  bot.avatar.goal.set(place.x,place.y,place.z);
  bot.avatar.jumping=false;
  bot.vitals.reset();
  bot.motion={x:0,z:0,angularY:0};
  return publicState(bot);
 }
 function remove(id){
  const bot=entry(id);
  bots.delete(bot.id);
  bot.dead=false;
  try{bot.ragdoll?.reset();}catch(error){console.warn('Debug ragdoll cleanup:',error);}
  ctx.removeAvatar(bot.id);
  return true;
 }
 function clear(){
  for(const id of [...bots.keys()])remove(id);
  lastSimulationAt=null;
 }
 function safeMove(bot,x,z){
  const old=bot.avatar.goal;
  const feet=ctx.terrain.heightAt(x,z);
  if(!Number.isFinite(feet)||ctx.terrain.waterDepthAt(x,z)>.8||
    Math.abs(feet-old.y)>.45||ctx.blocksPlayerAt(x,z,feet,{includeTrees:true}))return false;
  if(Math.hypot(x-ctx.px,z-ctx.pz)<1.2)return false;
  for(const other of bots.values()){
   if(other===bot)continue;
   if(Math.hypot(x-other.avatar.goal.x,z-other.avatar.goal.z)<.85)return false;
  }
  return true;
 }
 function walk(bot,dt){
  if(!bot.following||bot.dead)return false;
  const goal=bot.avatar.goal;
  const dx=ctx.px-goal.x,dz=ctx.pz-goal.z;
  const distance=Math.hypot(dx,dz);
  if(distance<=FOLLOW_DISTANCE)return false;
  const sprint=distance>8&&bot.vitals.canSprint();
  const speed=sprint?4.6:2.5;
  const step=Math.min(distance-FOLLOW_DISTANCE,Math.min(.05,dt)*speed);
  const vx=dx/distance,vz=dz/distance;
  const count=Math.max(1,Math.ceil(step/MAX_STEP));
  const sub=step/count;
  let moved=false;
  const previousX=goal.x,previousZ=goal.z;
  for(let i=0;i<count;i++){
   const x=goal.x+vx*sub,z=goal.z+vz*sub;
   if(safeMove(bot,x,z)){
    goal.set(x,ctx.terrain.heightAt(x,z),z);moved=true;
   }else if(safeMove(bot,x,goal.z)){
    goal.set(x,ctx.terrain.heightAt(x,goal.z),goal.z);moved=true;
   }else if(safeMove(bot,goal.x,z)){
    goal.set(goal.x,ctx.terrain.heightAt(goal.x,z),z);moved=true;
   }else break;
  }
  if(moved){
   const actualDx=goal.x-previousX,actualDz=goal.z-previousZ;
   bot.avatar.angle=Math.atan2(-actualDx,-actualDz);
   bot.motion={x:actualDx/Math.max(dt,1e-4),z:actualDz/Math.max(dt,1e-4),angularY:0};
  }else bot.motion={x:0,z:0,angularY:0};
  return moved&&sprint;
 }
 function tick(time=now(),dt=.016){
  if(ctx.isOnline?.()){
   if(bots.size)clear();
   return;
  }
  if(lastSimulationAt===null)lastSimulationAt=time;
  lastSimulationAt=time;
  for(const bot of bots.values()){
   if(bot.dead){
    try{bot.ragdoll?.tick(dt);}catch(error){console.warn('Debug ragdoll frame:',error);}
    continue;
   }
   const sprinting=walk(bot,Math.min(.05,dt));
   bot.vitals.tick({sprinting});
   if(bot.vitals.health<=0)die(bot);
  }
 }
 return {spawn,follow,damage,respawn,remove,clear,tick,list,
  get size(){return bots.size;}};
}
