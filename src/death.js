import {createDeathScreen,DEATH_SCREEN_DELAY_MS} from './death-screen.js';
import {BOX_LIFETIME_SECONDS,MAX_GROUND_DROPS} from './ground-boxes.js';
export const DEATH_MARKER_TTL=BOX_LIFETIME_SECONDS;
export function deathDropPosition(x,z,index){
 const angle=index*2.399963229728653;
 const radius=.8+.39*Math.sqrt(index);
 return {x:Math.round((x+Math.cos(angle)*radius)*100)/100,
         z:Math.round((z+Math.sin(angle)*radius)*100)/100};
}
export function validDeathMarker(marker,now=Date.now()/1000){
 return marker!=null && Number.isFinite(marker.x)&&Number.isFinite(marker.z)
  &&Math.abs(marker.x)<=240000&&Math.abs(marker.z)<=240000
  &&Number.isFinite(marker.expires_at)
  &&marker.expires_at>now&&marker.expires_at<=now+DEATH_MARKER_TTL+2;
}
export function createDeathSystem(ctx,{
 epoch=()=>Date.now()/1000,clock=()=>performance.now(),
 screen=typeof document==='undefined'?null:createDeathScreen(document),
}={}){
 let marker=null,bedId=null,handling=false,phase='alive',startedAt=0;
 let pendingRespawn=null,deathOnline=false;
 const active=()=>phase!=='alive';
 function begin({skipPhysics=false}={}){
  if(active())return false;
  phase='falling';startedAt=clock();deathOnline=!!ctx.isOnline?.();
  ctx.audio?.death?.();
  ctx.fallTracker?.reset?.();
  ctx.ragdollControls?.clearForDeath?.();
  for(const key in ctx.keys??{})ctx.keys[key]=false;
  ctx.jumpRequested=false;
  ctx.inventory?.close?.();
  ctx.storages?.close?.();
  if(typeof document!=='undefined'&&document.pointerLockElement)document.exitPointerLock?.();
  screen?.begin?.(()=>respawn());
  // If Rapier/CDN fails, the death screen and manual respawn still work.
  const impactSpeed=ctx.fallImpactSpeed??0;
  if(!skipPhysics)Promise.resolve()
   .then(()=>ctx.ragdoll?.trigger?.({allowOnline:true,impactSpeed}))
   .then(()=>{if(!active())ctx.ragdoll?.reset?.();})
   .catch(error=>console.warn('Death ragdoll unavailable:',error));
  return true;
 }
 function tick(now=clock()){
  if(phase!=='falling'||now-startedAt<DEATH_SCREEN_DELAY_MS)return;
  phase='ready';
  screen?.show?.(!deathOnline||!!pendingRespawn);
 }
 function respawn(){
  if(phase!=='ready')return false;
  if(deathOnline){
   if(!pendingRespawn)return false;
   const data=pendingRespawn;
   pendingRespawn=null;
   ctx.ragdoll?.reset?.();
   respawnAt(data.x,data.z);
   ctx.inventory?.close?.();
   ctx.notify?.('☠️ Вы погибли! Ищите вещи по метке на миникарте.','warning','player-death');
  }else{
   const bed=ctx.campStructures?.items?.get(bedId);
   const spawn=bed?.kind==='bed'?{x:bed.x+2.5,z:bed.z}:{x:0,z:0};
   if(!bed||bed.kind!=='bed')bedId=null;
   ctx.ragdoll?.reset?.();
   respawnAt(spawn.x,spawn.z);
   ctx.vitals.restore({health:5,hunger:3,stamina:5,staminaLocked:false,hungerProgress:0,starvationProgress:0});
   ctx.vitals.render?.();
  }
  phase='alive';
  screen?.end?.();
  if(!deathOnline)ctx.offlineSave?.save?.();
  return true;
 }
 function setMarker(value){
  marker=validDeathMarker(value,epoch())?{x:value.x,z:value.z,expires_at:value.expires_at}:null;
  if(!ctx.isOnline?.())ctx.offlineSave?.markDirty?.();
 }
 function setBed(id){
  const bed=ctx.campStructures?.items?.get(id);
  if(!bed||bed.kind!=='bed')return false;
  if(ctx.isOnline?.()){ctx.sendNet({type:'bed_spawn',id});return true;}
  bedId=id;ctx.notify?.('🛏️ Точка возрождения установлена','success','bed-spawn');
  ctx.offlineSave?.markDirty?.();return true;
 }
 function acceptBed(id){
  bedId=Number.isSafeInteger(id)?id:null;
  if(bedId!==null)ctx.notify?.('🛏️ Точка возрождения установлена','success','bed-spawn');
  else ctx.notify?.('Кровать убрана — возрождение на старте','warning','bed-gone');
 }
 function onStructureRemoved(id){
  if(bedId===id){bedId=null;ctx.offlineSave?.markDirty?.();ctx.notify?.('Кровать убрана — возрождение на старте','warning');}
 }
 function respawnAt(x,z){
  ctx.fallTracker?.reset?.();
  ctx.px=x;ctx.pz=z;ctx.feetY=ctx.terrain.heightAt(x,z);
  ctx.verticalSpeed=0;ctx.onGround=true;ctx.buildMode=false;
  ctx.characterOrientation?.alignToCamera?.();
  ctx.disposePreview?.();
  if(ctx.ownAvatar){
   ctx.ownAvatar.group.position.set(x,ctx.feetY,z);
   ctx.ownAvatar.group.rotation.set(0,ctx.yaw,0);
   ctx.ownAvatar.group.updateMatrixWorld?.(true);
  }
 }
 function onDeath(){
  if(handling||active()||ctx.vitals?.health>0)return false;
  if(ctx.isOnline?.())return begin();
  const entries=ctx.inventory.state.slots.map((item,slot)=>({item,slot})).filter(v=>v.item);
  if(ctx.groundBoxes.count+entries.length>MAX_GROUND_DROPS){
   ctx.notify?.('Нет места для всех коробок — вещи сохранены, повторяем позже','warning','death-drop-full');
   return false;
  }
  handling=true;
  const origin={x:ctx.px,z:ctx.pz},created=[],expires_at=epoch()+DEATH_MARKER_TTL;
  try{
   const prior=new Set([...ctx.groundBoxes.boxes].map(b=>b.id));
   let nextId=1;
   for(const {item,slot} of entries){
    while(prior.has(nextId))nextId++;
    prior.add(nextId);
    const pos=deathDropPosition(origin.x,origin.z,created.length);
    const box={id:nextId++, ...pos,expires_at,item};
    if(!ctx.groundBoxes.add(box))throw new Error('drop rejected');
    created.push(box.id);
   }
   for(const {slot} of entries)ctx.inventory.state.removeSlot(slot);
   ctx.wood=ctx.inventory.state.wood();ctx.inventory.render();
   setMarker({...origin,expires_at});
   begin();
   ctx.notify?.('☠️ Вы погибли! Вещи остались на месте смерти на 1 час.','warning','player-death');
   ctx.offlineSave?.save?.();
   return true;
  }catch{
   for(const id of created)ctx.groundBoxes.remove(id);
   ctx.notify?.('Не удалось безопасно выбросить вещи. Инвентарь сохранён.','warning','death-drop-error');
   return false;
  }finally{handling=false;}
 }
 function receive(data){
  if(!data||!Number.isFinite(data.x)||!Number.isFinite(data.z))return;
  if(data.marker)setMarker(data.marker);
  pendingRespawn={x:data.x,z:data.z};
  if(!active())begin();
  if(phase==='ready')screen?.enable?.(true);
 }
 function restore(value){
  if(active()){
   ctx.ragdoll?.reset?.();
   phase='alive';pendingRespawn=null;screen?.end?.();
  }
  bedId=Number.isSafeInteger(value?.bedId)?value.bedId:null;
  if(ctx.campStructures?.items?.get(bedId)?.kind!=='bed')bedId=null;
  marker=validDeathMarker(value?.marker,epoch())?{...value.marker}:null;
  if(value?.pending===true&&!active()&&!ctx.isOnline?.()){
   // Restore an interrupted death without dropping the inventory twice.
   ctx.ownAvatar?.group?.position?.set(ctx.px,ctx.feetY,ctx.pz);
   if(ctx.ownAvatar)ctx.ownAvatar.group.rotation.y=ctx.yaw;
   // Never instantiate Rapier while restoring a previously pending death:
   // the save already contains its inventory drop and death marker. We need
   // only the death/respawn UI, not a second physics simulation. A poisoned
   // ragdoll world must never prevent access to a valid offline save.
   begin({skipPhysics:true});
  }
 }
 function snapshot(){
  return {bedId,marker:validDeathMarker(marker,epoch())?{...marker}:null,
   ...(active()&&!deathOnline?{pending:true}:{})};
 }
 return {setBed,acceptBed,onStructureRemoved,onDeath,receive,restore,snapshot,setMarker,
   tick,respawn,
   get phase(){return phase},get active(){return active()},
   get marker(){return validDeathMarker(marker,epoch())?marker:null},
   get bedId(){return bedId}};
}
