import {DECOR_ITEM_NAMES} from './collectible-decor.js';
// Dropped stacks are real ground objects with a fixed 3600s TTL.
// No distance-to-player tracking: expiration is strictly wall-clock based.
import {validItem} from './inventory.js';
export const BOX_LIFETIME_SECONDS=3600;
export const ITEM_NAMES={log:'Бревно',branch:'Ветка',stone:'Камень',bench:'Скамейка',axe:'Топор',...DECOR_ITEM_NAMES};
export function createGroundBoxes(ctx,doc=document){
 const {THREE,scene}=ctx,boxes=new Map();
 const geo=new THREE.BoxGeometry(.43,.32,.43);
 const mat=new THREE.MeshLambertMaterial({color:0xc39553});
 const strapMat=new THREE.MeshLambertMaterial({color:0x694525});
 const strapGeo=new THREE.BoxGeometry(.45,.06,.10);
 const hud=doc.createElement('div');
 hud.className='fc-box-tooltip';
 hud.style.cssText='position:fixed;left:50%;top:58%;transform:translate(-50%,-50%);z-index:7;color:white;background:#172a20de;padding:6px 10px;border:1px solid #a5bf8c;border-radius:8px;font:13px system-ui;pointer-events:none;display:none;text-align:center';
 doc.body.append(hud);
 let next=1,lastTick=-Infinity;
 function add(box){
  if(!Number.isInteger(box?.id)||!validItem(box.item)
    ||!Number.isFinite(box.x)||!Number.isFinite(box.z)||!Number.isFinite(box.expires_at)
    ||Math.abs(box.x)>240000||Math.abs(box.z)>240000||boxes.size>=500)return false;
  if(box.expires_at<=Date.now()/1000)return false;
  remove(box.id);
  const mesh=new THREE.Group();
  const body=new THREE.Mesh(geo,mat);body.position.y=.21;
  const strap=new THREE.Mesh(strapGeo,strapMat);strap.position.y=.39;
  mesh.add(body,strap);mesh.position.set(box.x,ctx.terrain.heightAt(box.x,box.z),box.z);
  scene.add(mesh);boxes.set(box.id,{...box,item:{...box.item},mesh});
  next=Math.max(next,box.id+1);
  return true;
 }
 function remove(id){
  const box=boxes.get(id);if(!box)return false;
  scene.remove(box.mesh);boxes.delete(id);return true;
 }
 function set(list){clear();for(const box of list??[])add(box);}
 function clear(){for(const b of boxes.values())scene.remove(b.mesh);boxes.clear();hud.style.display='none';}
 function nearest(max=2.8){
  let result=null,smallest=max;
  for(const b of boxes.values()){
   const d=Math.hypot(b.x-ctx.px,b.z-ctx.pz);
   if(d<smallest){result=b;smallest=d;}
  }
  return result?{id:result.id,item:result.item,x:result.x,z:result.z,distance:smallest}:null;
 }
 function focused(){
  let best=null,distance=6;
  const fx=-Math.sin(ctx.yaw),fz=-Math.cos(ctx.yaw);
  for(const b of boxes.values()){
   const dx=b.x-ctx.px,dz=b.z-ctx.pz;
   const forward=dx*fx+dz*fz;
   if(forward<0||forward>=distance||Math.abs(dx*fz-dz*fx)>.75)continue;
   best=b;distance=forward;
  }
  return best;
 }
 function tick(now=performance.now()){
  if(now-lastTick<500)return;lastTick=now;
  for(const b of boxes.values())if(b.expires_at<=Date.now()/1000)remove(b.id);
  const focusedBox=focused();
  if(focusedBox){
   const amount=focusedBox.item.id==='axe'?1:focusedBox.item.count;
   hud.textContent='📦 '+ITEM_NAMES[focusedBox.item.id]+(amount>1?' ×'+amount:'')
     +(Math.hypot(focusedBox.x-ctx.px,focusedBox.z-ctx.pz)<2.8?' · E — подобрать':'');
   hud.style.display='block';
  }else hud.style.display='none';
 }
 function dropSlot(index){
  if(ctx.isOnline?.()){ctx.sendNet?.({type:'drop_item',slot:index});return true;}
  const item=ctx.inventory?.state.slots[index];
  if(!item||boxes.size>=500)return false;
  const x=ctx.px-Math.sin(ctx.yaw)*1.5,z=ctx.pz-Math.cos(ctx.yaw)*1.5;
  const box={id:next++,x,z,expires_at:Date.now()/1000+BOX_LIFETIME_SECONDS,item};
  if(!add(box))return false;
  const removed=ctx.inventory.state.removeSlot(index);
  if(!removed){remove(box.id);return false;}
  ctx.wood=ctx.inventory.state.wood();ctx.inventory.render();
  ctx.offlineSave?.markDirty?.();return true;
 }
 function pickup(id=null){
  const b=id===null?nearest():boxes.get(id);
  if(!b||Math.hypot(b.x-ctx.px,b.z-ctx.pz)>2.8)return false;
  if(ctx.isOnline?.()){ctx.sendNet?.({type:'pickup_box',id:b.id});return true;}
  if(!ctx.inventory?.state.addItem(b.item)){ctx.notify?.('Нет места для предмета','warning','box-full');return false;}
  remove(b.id);ctx.wood=ctx.inventory.state.wood();ctx.inventory.render();
  ctx.offlineSave?.markDirty?.();return true;
 }
 function snapshot(){return [...boxes.values()].map(({mesh,...b})=>({...b,item:{...b.item}}));}
 function dispose(){clear();hud.remove();geo.dispose();mat.dispose();strapGeo.dispose();strapMat.dispose();}
 return {tick,add,remove,set,clear,nearest,pickup,dropSlot,snapshot,dispose,get count(){return boxes.size}};
}
