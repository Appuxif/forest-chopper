import {fallenLogSegments,segmentMask,FALLEN_LOG_LENGTH} from './fallen-log-layout.js';
import {DECOR_ITEM_NAMES} from './collectible-decor.js';
// Ordinary dropped stacks and fallen-tree segments share a 3600s TTL.
// Fallen segments are independently pickable within one compact pile record.
import {validItem} from './inventory.js';
export const BOX_LIFETIME_SECONDS=3600;
export const MAX_GROUND_DROPS=3000;
export const TREE_LOG_COUNT=3;
export const isFallenLogs=box=>box?.kind==='fallen_logs';
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
    ||Math.abs(box.x)>240000||Math.abs(box.z)>240000
    ||(boxes.size>=MAX_GROUND_DROPS&&!boxes.has(box.id)))return false;
  if(isFallenLogs(box)){
    const mask=segmentMask(box);
    if(box.item.id!=='log'||
       !Number.isFinite(box.direction??0)||Math.abs(box.direction??0)>100||
       mask<1||mask>31||mask.toString(2).replaceAll('0','').length!==box.item.count)return false;
    // Backward compatibility: formerly permanent piles get one hour from
    // their first load, not a fresh hour on every partial pickup.
    if(box.expires_at===0)box={...box,expires_at:Date.now()/1000+BOX_LIFETIME_SECONDS};
  }else if(box.kind!==undefined)return false;
  if(box.expires_at<=Date.now()/1000)return false;
  const prior=boxes.get(box.id);
  remove(box.id);
  const mesh=new THREE.Group();
  if(isFallenLogs(box)){
    // Stable centers: every instance uses its ORIGINAL segment index, even
    // when another segment was already collected.
    const segments=fallenLogSegments(box,ctx.logLength??FALLEN_LOG_LENGTH);
    const lumber=new THREE.InstancedMesh(ctx.logGeo,
      [ctx.logMat,ctx.endMat,ctx.endMat],segments.length);
    const dummy=new THREE.Object3D();
    for(let i=0;i<segments.length;i++){
      const segment=segments[i];
      dummy.position.set(segment.x-box.x,
        ctx.terrain.heightAt(segment.x,segment.z)-ctx.terrain.heightAt(box.x,box.z)
          +(ctx.logRadius??.29),
        segment.z-box.z);
      dummy.rotation.z=Math.PI/2;
      dummy.rotation.y=Math.PI/2-(box.direction??0);
      dummy.updateMatrix();
      lumber.setMatrixAt(i,dummy.matrix);
    }
    lumber.instanceMatrix.needsUpdate=true;
    lumber.castShadow=true;
    mesh.add(lumber);
  }else{
    const body=new THREE.Mesh(geo,mat);body.position.y=.21;
    const strap=new THREE.Mesh(strapGeo,strapMat);strap.position.y=.39;
    mesh.add(body,strap);
  }
  mesh.position.set(box.x,ctx.terrain.heightAt(box.x,box.z),box.z);
  // Preserve hidden state across server 'box_add' updates during tree fall.
  const pending=isFallenLogs(box)&&
    (box.pending===true || (prior?prior.pending:
      ctx.falling?.some(f=>f.tree?.userData?.id===box.tree)));
  mesh.visible=!pending;
  scene.add(mesh);boxes.set(box.id,{...box,item:{...box.item},pending:!!pending,mesh});
  next=Math.max(next,box.id+1);
  return true;
 }
 function remove(id){
  const box=boxes.get(id);if(!box)return false;
  scene.remove(box.mesh);
  if(isFallenLogs(box))box.mesh.children[0]?.dispose?.();
  boxes.delete(id);return true;
 }
 function set(list){clear();for(const box of list??[])add(box);}
 function clear(){for(const id of [...boxes.keys()])remove(id);hud.style.display='none';}
 function *pickupNodes(){
  for(const box of boxes.values()){
    if(box.pending||box.expires_at<=Date.now()/1000)continue;
    if(isFallenLogs(box))
      for(const segment of fallenLogSegments(box,ctx.logLength??FALLEN_LOG_LENGTH))
        yield {id:box.id,segment:segment.index,x:segment.x,z:segment.z,
          item:box.item,kind:box.kind};
    else yield box;
  }
 }
 function nearest(max=2.8){
  let result=null,smallest=max;
  for(const b of pickupNodes()){
    const d=Math.hypot(b.x-ctx.px,b.z-ctx.pz);
    if(d<smallest){result=b;smallest=d;}
  }
  return result?{...result,distance:smallest}:null;
 }
 function focused(){
  let best=null,distance=6;
  const fx=-Math.sin(ctx.yaw),fz=-Math.cos(ctx.yaw);
  for(const b of pickupNodes()){
   const dx=b.x-ctx.px,dz=b.z-ctx.pz;
   const forward=dx*fx+dz*fz;
   if(forward<0||forward>=distance||Math.abs(dx*fz-dz*fx)>.75)continue;
   best=b;distance=forward;
  }
  return best;
 }
 function revealTree(tree){
  for(const b of boxes.values()){
    if(b.pending&&b.tree===tree){
      b.pending=false;
      b.mesh.visible=true;
    }
  }
 }
 function tick(now=performance.now()){
  if(now-lastTick<500)return;lastTick=now;
  for(const b of boxes.values()){
    if(b.expires_at<=Date.now()/1000){
      remove(b.id);
      if(!ctx.isOnline?.())ctx.offlineSave?.markDirty?.();
      continue;
    }
    b.mesh.visible=!b.pending&&Math.hypot(b.x-ctx.px,b.z-ctx.pz)<85;
  }
  const target=focused();
  if(target){
    const amount=target.item.id==='axe'?1:target.item.count;
    hud.textContent=(isFallenLogs(target)?'🪵 Сегмент ствола':'📦 '+ITEM_NAMES[target.item.id])
      +(amount>1?' · осталось '+amount:'')
      +(Math.hypot(target.x-ctx.px,target.z-ctx.pz)<2.8
        ?(isFallenLogs(target)?' · E — поднять':' · E — подобрать'):'');
    hud.style.display='block';
  }else hud.style.display='none';
 }
 function dropSlot(index){
  if(ctx.isOnline?.()){ctx.sendNet?.({type:'drop_item',slot:index});return true;}
  const item=ctx.inventory?.state.slots[index];
  if(!item||boxes.size>=MAX_GROUND_DROPS)return false;
  const x=ctx.px-Math.sin(ctx.yaw)*1.5,z=ctx.pz-Math.cos(ctx.yaw)*1.5;
  const box={id:next++,x,z,expires_at:Date.now()/1000+BOX_LIFETIME_SECONDS,item};
  if(!add(box))return false;
  const removed=ctx.inventory.state.removeSlot(index);
  if(!removed){remove(box.id);return false;}
  ctx.wood=ctx.inventory.state.wood();ctx.inventory.render();
  ctx.offlineSave?.markDirty?.();return true;
 }
 function pickup(id=null,segment=null){
  const selected=id===null?nearest():{id,segment};
  const b=boxes.get(selected?.id);
  if(!b||b.pending)return false;
  if(b.expires_at<=Date.now()/1000){
    remove(b.id);
    if(!ctx.isOnline?.())ctx.offlineSave?.markDirty?.();
    return false;
  }
  const pieces=isFallenLogs(b)?fallenLogSegments(b,ctx.logLength??FALLEN_LOG_LENGTH):[b];
  let part=pieces.find(p=>p.index===(segment??selected.segment));
  // Old callers passing only the pile id pick the nearest reachable segment.
  if(!part&&segment==null&&selected.segment==null)
    part=pieces.reduce((best,p)=>Math.hypot(p.x-ctx.px,p.z-ctx.pz)<
      Math.hypot(best.x-ctx.px,best.z-ctx.pz)?p:best,pieces[0]);
  if(!part||Math.hypot(part.x-ctx.px,part.z-ctx.pz)>2.8)return false;
  if(ctx.isOnline?.()){
    ctx.sendNet?.({type:'pickup_box',id:b.id,...(isFallenLogs(b)?{segment:part.index}:{})});
    return true;
  }
  const received=isFallenLogs(b)?{id:'log',count:1}:b.item;
  if(!ctx.inventory?.state.addItem(received)){
    ctx.notify?.('Нет места или превышен лимит 100 кг','warning','box-full');return false;
  }
  if(isFallenLogs(b)&&b.item.count>1)
    add({...b,mask:segmentMask(b)&~(1<<part.index),
      item:{id:'log',count:b.item.count-1}});
  else remove(b.id);
  ctx.wood=ctx.inventory.state.wood();ctx.inventory.render();
  ctx.offlineSave?.markDirty?.();return true;
 }
 function spawnFallenLogs(x,z,count=TREE_LOG_COUNT,{direction=0,tree=null,pending=false}={}){
  if(!Number.isInteger(count)||count<1||count>TREE_LOG_COUNT
    ||boxes.size>=MAX_GROUND_DROPS)return false;
  const box={id:next++,x,z,kind:'fallen_logs',direction,tree,
    mask:(1<<count)-1,expires_at:Date.now()/1000+BOX_LIFETIME_SECONDS,
    item:{id:'log',count},pending};
  if(!add(box))return false;
  ctx.offlineSave?.markDirty?.();
  return true;
 }
 function snapshot(){return [...boxes.values()].map(({mesh,pending,...b})=>({...b,item:{...b.item}}));}
 function dispose(){clear();hud.remove();geo.dispose();mat.dispose();strapGeo.dispose();strapMat.dispose();}
 // Expose live box records as a lightweight iterable for the shared pickup reticle.
 // Iterating the Map avoids cloning every box on every animation frame.
 return {tick,add,remove,set,clear,nearest,pickup,dropSlot,spawnFallenLogs,revealTree,snapshot,dispose,
  get pickupNodes(){return pickupNodes();},
  get boxes(){return boxes.values();},get count(){return boxes.size}};
}
