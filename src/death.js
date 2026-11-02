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
export function createDeathSystem(ctx,{epoch=()=>Date.now()/1000}={}){
 let marker=null,bedId=null,handling=false;
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
  ctx.px=x;ctx.pz=z;ctx.feetY=ctx.terrain.heightAt(x,z);
  ctx.verticalSpeed=0;ctx.onGround=true;ctx.buildMode=false;
  ctx.disposePreview?.();
  if(ctx.ownAvatar)ctx.ownAvatar.group.position.set(x,ctx.feetY,z);
 }
 function onDeath(){
  if(handling||ctx.isOnline?.()||ctx.vitals?.health>0)return false;
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
   const bed=ctx.campStructures?.items?.get(bedId);
   const originBed=bed?.kind==='bed'?{x:bed.x+2.5,z:bed.z}:{x:0,z:0};
   if(!bed||bed.kind!=='bed')bedId=null;
   respawnAt(originBed.x,originBed.z);
   ctx.vitals.restore({health:5,hunger:3,stamina:5,staminaLocked:false,hungerProgress:0,starvationProgress:0});
   setMarker({...origin,expires_at});
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
  respawnAt(data.x,data.z);
  ctx.inventory?.close?.();
  ctx.notify?.('☠️ Вы погибли! Ищите вещи по метке на миникарте.','warning','player-death');
 }
 function restore(value){
  bedId=Number.isSafeInteger(value?.bedId)?value.bedId:null;
  if(ctx.campStructures?.items?.get(bedId)?.kind!=='bed')bedId=null;
  marker=validDeathMarker(value?.marker,epoch())?{...value.marker}:null;
 }
 function snapshot(){
  return {bedId,marker:validDeathMarker(marker,epoch())?{...marker}:null};
 }
 return {setBed,acceptBed,onStructureRemoved,onDeath,receive,restore,snapshot,setMarker,
   get marker(){return validDeathMarker(marker,epoch())?marker:null},
   get bedId(){return bedId}};
}
