import {fallenLogSegments,segmentMask,FALLEN_LOG_LENGTH} from './fallen-log-layout.js';
import {ITEM_DISPLAY_NAMES} from './item-display.js';
// Ordinary dropped stacks and fallen-tree segments share a 3600s TTL.
// Fallen segments are independently pickable within one compact pile record.
import {validItem} from './inventory.js';
import {GroundBoxIndex,BOX_CELL_SIZE} from './ground-box-index.js';
export const BOX_LIFETIME_SECONDS=3600;
export const MAX_GROUND_DROPS=10_000;
export const TREE_LOG_COUNT=3;
export const isFallenLogs=box=>box?.kind==='fallen_logs';
export const ITEM_NAMES=ITEM_DISPLAY_NAMES;
export function createGroundBoxes(ctx,doc=document){
 const {THREE,scene}=ctx,boxes=new Map();
 const index=new GroundBoxIndex(),batches=new Map(),dirtyChunks=new Set(),pendingTrees=new Map();
 const batched=!!(THREE.InstancedMesh&&THREE.Matrix4&&THREE.CanvasTexture&&THREE.MeshLambertMaterial);
 const cellKey=(x,z)=>Math.floor(x/BOX_CELL_SIZE)+','+Math.floor(z/BOX_CELL_SIZE);
 function markDirty(box){
   if(!batched)return;
   if(isFallenLogs(box))for(const p of fallenLogSegments(box))dirtyChunks.add(cellKey(p.x,p.z));
   else dirtyChunks.add(cellKey(box.x,box.z));
 }
 function makeTexture(){
   const canvas=doc.createElement('canvas');
   canvas.width=64;canvas.height=64;
   const g=canvas.getContext?.('2d');
   if(!g)return null;
   g.fillStyle='#bc894e';g.fillRect(0,0,64,64);
   for(let y=0;y<64;y+=16){
     g.fillStyle=y%32?'#c18c53':'#aa7645';g.fillRect(0,y,64,15);
     g.fillStyle='#67492d';g.fillRect(0,y+14,64,2);
     g.fillStyle='#916338';g.fillRect(0,y+4,64,1);
   }
   g.fillStyle='#674326';g.fillRect(27,0,10,64);g.fillRect(0,29,64,6);
   g.fillStyle='#d2a369';g.fillRect(29,0,2,64);
   const texture=new THREE.CanvasTexture(canvas);
   texture.colorSpace=THREE.SRGBColorSpace??texture.colorSpace;
   return texture;
 }
 const texture=batched?makeTexture():null;
 const boxGeo=batched?new THREE.BoxGeometry(.43,.32,.43):null;
 const boxMat=batched?new THREE.MeshLambertMaterial({color:0xffffff,map:texture}):null;
 const dummy=batched?new THREE.Object3D():null;
 function disposeBatches(cell){
   for(const mesh of batches.get(cell)??[]){scene.remove(mesh);mesh.dispose?.();}
   batches.delete(cell);
 }
 function rebuildChunk(cell,now=Date.now()/1000){
   if(!batched)return;
   disposeBatches(cell);
   const bucket=index.cells.get(cell);if(!bucket)return;
   const crates=[],logs=[];
   for(const nodes of bucket.values())for(const node of nodes){
     const box=boxes.get(node.id);
     if(!box||box.pending||box.expires_at<=now)continue;
     (isFallenLogs(box)?logs:crates).push({node,box});
   }
   const meshes=[];
   if(crates.length){
     const inst=new THREE.InstancedMesh(boxGeo,boxMat,crates.length);
     for(let i=0;i<crates.length;i++){
       const {node}=crates[i];
       dummy.position.set(node.x,ctx.terrain.heightAt(node.x,node.z)+.21,node.z);
       dummy.rotation.set(0,0,0);dummy.scale.set(1,1,1);dummy.updateMatrix();
       inst.setMatrixAt(i,dummy.matrix);
     }
     inst.instanceMatrix.needsUpdate=true;inst.castShadow=true;
     inst.frustumCulled=true;inst.computeBoundingSphere?.();scene.add(inst);meshes.push(inst);
   }
   if(logs.length){
     const geometry=ctx.fallenLogGeo??ctx.logGeo;
     if(geometry){
       const inst=new THREE.InstancedMesh(geometry,[ctx.logMat,ctx.endMat,ctx.endMat],logs.length);
       for(let i=0;i<logs.length;i++){
         const {node,box}=logs[i];
         dummy.position.set(node.x,ctx.terrain.heightAt(node.x,node.z)+(ctx.logRadius??.29),node.z);
         dummy.rotation.set(0,Math.PI/2-(box.direction??0),Math.PI/2);
         dummy.scale.set(1,1,1);dummy.updateMatrix();
         inst.setMatrixAt(i,dummy.matrix);
       }
       inst.instanceMatrix.needsUpdate=true;inst.castShadow=true;
       inst.frustumCulled=true;inst.computeBoundingSphere?.();scene.add(inst);meshes.push(inst);
     }
   }
   if(meshes.length)batches.set(cell,meshes);
 }
 function visibleCells(x,z){
   const cells=new Set(),radius=85+BOX_CELL_SIZE;
   const minX=Math.floor((x-radius)/BOX_CELL_SIZE),maxX=Math.floor((x+radius)/BOX_CELL_SIZE);
   const minZ=Math.floor((z-radius)/BOX_CELL_SIZE),maxZ=Math.floor((z+radius)/BOX_CELL_SIZE);
   for(let cx=minX;cx<=maxX;cx++)for(let cz=minZ;cz<=maxZ;cz++){
     const midX=(cx+.5)*BOX_CELL_SIZE,midZ=(cz+.5)*BOX_CELL_SIZE;
     if(Math.hypot(midX-x,midZ-z)<=85+BOX_CELL_SIZE*Math.SQRT2/2)cells.add(cx+','+cz);
   }
   return cells;
 }
 const geo=batched?null:new THREE.BoxGeometry(.43,.32,.43);
 const mat=new THREE.MeshLambertMaterial({color:0xc39553});
 const strapMat=new THREE.MeshLambertMaterial({color:0x694525});
 const strapGeo=batched?null:new THREE.BoxGeometry(.45,.06,.10);
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
  const mesh=batched?null:new THREE.Group();
  if(!batched&&isFallenLogs(box)){
    // Stable centers: every instance uses its ORIGINAL segment index, even
    // when another segment was already collected.
    const segments=fallenLogSegments(box,FALLEN_LOG_LENGTH);
    const lumber=new THREE.InstancedMesh(ctx.fallenLogGeo??ctx.logGeo,
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
  }else if(!batched){
    const body=new THREE.Mesh(geo,mat);body.position.y=.21;
    const strap=new THREE.Mesh(strapGeo,strapMat);strap.position.y=.39;
    mesh.add(body,strap);
  }
  if(mesh)mesh.position.set(box.x,ctx.terrain.heightAt(box.x,box.z),box.z);
  // Preserve hidden state across server 'box_add' updates during tree fall.
  const pending=isFallenLogs(box)&&
    (box.pending===true || (prior?prior.pending:
      ctx.falling?.some(f=>f.tree?.userData?.id===box.tree)));
  if(mesh){mesh.visible=!pending;scene.add(mesh);}
  const entry={...box,item:{...box.item},pending:!!pending,mesh};
  boxes.set(box.id,entry);index.set(entry);markDirty(entry);
  if(pending&&entry.tree){
    if(!pendingTrees.has(entry.tree))pendingTrees.set(entry.tree,new Set());
    pendingTrees.get(entry.tree).add(entry.id);
  }
  next=Math.max(next,box.id+1);
  return true;
 }
 function remove(id){
  const box=boxes.get(id);if(!box)return false;
  if(box.mesh){
    scene.remove(box.mesh);
    if(isFallenLogs(box))box.mesh.children[0]?.dispose?.();
  }
  markDirty(box);index.remove(id);boxes.delete(id);
  if(box.tree)pendingTrees.get(box.tree)?.delete(id);
  return true;
 }
 function set(list){clear();for(const box of list??[])add(box);}
 function clear(){
  for(const id of [...boxes.keys()])remove(id);
  index.clear();pendingTrees.clear();
  for(const cell of [...batches.keys()])disposeBatches(cell);
  dirtyChunks.clear();hud.style.display='none';
}
 function *pickupNodes(){
  for(const box of boxes.values()){
    if(box.pending||box.expires_at<=Date.now()/1000)continue;
    if(isFallenLogs(box))
      for(const segment of fallenLogSegments(box,FALLEN_LOG_LENGTH))
        yield {id:box.id,segment:segment.index,x:segment.x,z:segment.z,
          item:box.item,kind:box.kind};
    else yield box;
  }
 }
 function *nearbyPickupNodes(x=ctx.px,z=ctx.pz,radius=3){
   const now=Date.now()/1000;
   for(const node of index.near(x,z,radius)){
     const box=boxes.get(node.id);
     if(!box||box.pending||box.expires_at<=now)continue;
     yield node;
   }
 }
 function nearest(max=2.8){
  let result=null,smallest=max;
  for(const b of nearbyPickupNodes(ctx.px,ctx.pz,max)){
    const d=Math.hypot(b.x-ctx.px,b.z-ctx.pz);
    if(d<smallest){result=b;smallest=d;}
  }
  return result?{...result,distance:smallest}:null;
 }
 function focused(){
  let best=null,distance=6;
  const fx=-Math.sin(ctx.yaw),fz=-Math.cos(ctx.yaw);
  for(const b of nearbyPickupNodes(ctx.px,ctx.pz,6)){
   const dx=b.x-ctx.px,dz=b.z-ctx.pz;
   const forward=dx*fx+dz*fz;
   if(forward<0||forward>=distance||Math.abs(dx*fz-dz*fx)>.75)continue;
   best=b;distance=forward;
  }
  return best;
 }
 function revealTree(tree){
  for(const id of pendingTrees.get(tree)??[]){
    const b=boxes.get(id);
    if(!b||!b.pending)continue;
    b.pending=false;
    if(b.mesh)b.mesh.visible=true;
    markDirty(b);
  }
  pendingTrees.delete(tree);
 }
 function tick(now=performance.now()){
  if(now-lastTick<500)return;lastTick=now;
  const nowSeconds=Date.now()/1000;
  for(const id of index.expired(nowSeconds)){
    if(remove(id)&&!ctx.isOnline?.())ctx.offlineSave?.markDirty?.();
  }
  if(batched){
    const visible=visibleCells(ctx.px,ctx.pz);
    for(const cell of [...batches.keys()])if(!visible.has(cell))disposeBatches(cell);
    for(const cell of visible)if(index.cells.has(cell)&&
      (!batches.has(cell)||dirtyChunks.has(cell)))rebuildChunk(cell,nowSeconds);
    for(const cell of dirtyChunks)if(!index.cells.has(cell))disposeBatches(cell);
    dirtyChunks.clear();
  }else{
    // Legacy-compatible mock renderer; real Three.js uses per-chunk instancing.
    for(const b of boxes.values())
      b.mesh.visible=!b.pending&&Math.hypot(b.x-ctx.px,b.z-ctx.pz)<85;
  }
  // The global interaction reticle owns all prompts when available.
  // Avoid a second independent E hint competing with chest/camp actions.
  if(ctx.pickupInteraction){hud.style.display='none';return;}
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
  const pieces=isFallenLogs(b)?fallenLogSegments(b,FALLEN_LOG_LENGTH):[b];
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
 function dispose(){clear();hud.remove();geo?.dispose();mat.dispose();strapGeo?.dispose();strapMat.dispose();boxGeo?.dispose();boxMat?.dispose();texture?.dispose();}
 // Expose live box records as a lightweight iterable for the shared pickup reticle.
 // Iterating the Map avoids cloning every box on every animation frame.
 return {tick,add,remove,set,clear,nearest,pickup,dropSlot,spawnFallenLogs,revealTree,snapshot,dispose,
  get pickupNodes(){return pickupNodes();},nearbyPickupNodes,
  get batchCount(){return [...batches.values()].reduce((n,arr)=>n+arr.length,0);},
  get boxes(){return boxes.values();},get count(){return boxes.size}};
}
