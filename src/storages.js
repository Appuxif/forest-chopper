// World storage: chest inventories and log racks. One mesh set per placed structure.
// Online mutations are only applied when the server broadcasts the new snapshot.
import {CHEST_SLOTS,CHEST_MAX_WEIGHT,RACK_MAX_LOGS,STORAGE_COST,
 storageWeight,makeStorage,validStorage,transferStorage,moveStorageSlot,renameStorage} from './storage-model.js';
import {itemWeight} from './inventory.js';
import {itemDisplayIcon,itemDisplayName} from './item-display.js';
import {itemIconKey} from './item-icons.js';

export function createStorages(ctx,doc=document){
 const {THREE,scene}=ctx,structures=new Map();
 let lastId=0,opened=null,chosen=-1,drag=null,suppressClickUntil=0;
 const geo=new THREE.BoxGeometry(1.45,.75,.95),woodMat=new THREE.MeshLambertMaterial({color:0x8b6139});
 const lidGeo=new THREE.BoxGeometry(1.58,.2,1.03),ironMat=new THREE.MeshLambertMaterial({color:0x454b49});
 const sideGeo=new THREE.BoxGeometry(.12,.82,1),beamGeo=new THREE.CylinderGeometry(.12,.12,2.8,7);
 // Own top-level backdrop and stacking layer: neither vitals nor other HUD
 // overlays can cover the chest title or intercept pointer drops.
 const backdrop=doc.createElement('div');backdrop.className='fc-storage-backdrop';backdrop.hidden=true;
 const modal=doc.createElement('section');modal.className='fc-storage-modal';modal.hidden=true;
 modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Хранилище');
 const style=doc.createElement('style');
 style.textContent=[
  '.fc-storage-backdrop{position:fixed;inset:0;z-index:1000;background:#07130dcc;backdrop-filter:blur(3px)}',
  '.fc-storage-backdrop[hidden],.fc-storage-modal[hidden]{display:none!important}',
  '.fc-storage-modal{position:fixed;z-index:1001;top:50%;left:50%;transform:translate(-50%,-50%);width:min(570px,94vw);max-height:min(82dvh,760px);overflow:auto;background:#10251ff7;color:#e5f0df;border:1px solid #a4c19c;border-radius:14px;padding:14px;box-shadow:0 20px 80px #000c}',
  '.fc-storage-modal header{position:sticky;top:-14px;z-index:3;background:#10251f;min-height:44px;padding:7px 3px;border-bottom:1px solid #789b8366}',
  '.fc-storage-modal h2{font-size:19px;line-height:1.3;overflow-wrap:anywhere}',
  '.fc-storage-modal button{cursor:pointer;color:#f2f7e9;background:#305340;border:1px solid #8bba99;border-radius:8px;padding:7px}',
  '.fc-storage-modal button:disabled{opacity:.4}',
  '.fc-storage-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;margin:8px 0 12px}',
  '.fc-storage-player-grid{grid-template-columns:repeat(4,minmax(0,1fr))}',
  '.fc-storage-modal .fc-storage-cell.fc-slot{width:100%;height:59px;min-height:0;overflow:hidden;padding:0;position:relative;display:flex;align-items:center;justify-content:center;background:#1e382ce8;border:1px solid #789b83;border-radius:8px;color:white;font-size:24px;touch-action:none;user-select:none;-webkit-user-select:none}',
  '.fc-storage-modal .fc-storage-cell.fc-slot[data-chosen=true]{outline:3px solid #e8c56a;outline-offset:-3px;background:#40553b}',
  '.fc-storage-modal .fc-storage-cell.fc-slot.fc-drop-hover{outline:3px solid #8af5b0;outline-offset:-2px}',
  '.fc-storage-modal .fc-storage-cell .fc-item-icon{display:block;width:72%;height:72%;object-fit:contain;pointer-events:none;filter:drop-shadow(0 2px 2px #0007)}',
  '.fc-storage-modal .fc-storage-cell small{position:absolute;right:5px;bottom:3px;color:#fff;font-size:11px;font-weight:bold;text-shadow:0 1px 2px #000}',
  '.fc-storage-modal .fc-storage-actions{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}',
  '.fc-storage-name{width:75%;max-width:300px;padding:7px;border-radius:6px;background:#19372b;color:#f2f7e9;border:1px solid #789b83}',
  '.fc-storage-meter{margin:8px 0 10px;font-size:13px;color:#c7d7cd}',
  '.fc-storage-hint{font-size:12px;color:#c7d7cd;line-height:1.4;margin:6px 0}',
  '@media(max-width:650px){.fc-storage-modal{padding:10px;max-height:84dvh}.fc-storage-modal header{top:-10px}.fc-storage-grid{gap:4px}.fc-storage-modal .fc-storage-cell.fc-slot{height:49px;font-size:19px}}',
 ].join('');
 doc.head.append(style);doc.body.append(backdrop,modal);
 function nameMaterial(name){
  const canvas=doc.createElement('canvas');canvas.width=512;canvas.height=128;
  const g=canvas.getContext('2d');g.fillStyle='#d5b985';g.fillRect(0,0,512,128);
  g.strokeStyle='#5f452e';g.lineWidth=8;g.strokeRect(4,4,504,120);
  g.font='bold 36px sans-serif';g.fillStyle='#2e2418';g.textAlign='center';g.textBaseline='middle';
  g.fillText(name,256,64,475);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshLambertMaterial({map:texture,side:THREE.DoubleSide});
 }
 function visual(item){
  const group=new THREE.Group();
  if(item.kind==='chest'){
   const body=new THREE.Mesh(geo,woodMat);body.position.y=.48;group.add(body);
   const lid=new THREE.Mesh(lidGeo,woodMat);lid.position.y=.97;group.add(lid);
   for(const x of [-.6,.6]){const hinge=new THREE.Mesh(sideGeo,ironMat);hinge.position.set(x,.52,0);group.add(hinge);}
   // Nameplate is inlaid on the TOP of the lid, facing a player at +Z.
   const board=new THREE.Mesh(new THREE.PlaneGeometry(1.28,.34),nameMaterial(item.name));
   board.rotation.x=-Math.PI/2;
   board.position.set(0,1.074,0);
   board.receiveShadow=false;
   group.add(board);group.userData.label=board;
  }else{
   // Two end supports with neat rows of instanced logs; no rigid bodies.
   for(const x of [-1.25,1.25])for(const z of [-.56,.56]){
    const support=new THREE.Mesh(new THREE.CylinderGeometry(.09,.12,1.15,6),woodMat);
    support.position.set(x,.55,z);group.add(support);
   }
   const rack=new THREE.InstancedMesh(ctx.logGeo,ctx.logMat,RACK_MAX_LOGS);
   rack.castShadow=false;rack.frustumCulled=false;rack.count=0;
   group.add(rack);group.userData.logs=rack;
  }
  // The shared Collision World consumes the exact authored solids, including
  // storage items. Both ordinary walking and Rapier see these same boxes.
  group.userData.collisionBoxes=item.kind==='chest'
   ?[{x:0,y:.48,z:0,w:1.45,h:.75,d:.95},
     {x:0,y:.97,z:0,w:1.58,h:.20,d:1.03}]
   :Array.from({length:4},(_,i)=>({
     x:i<2?-1.25:1.25,y:.55,z:i%2===0?-.56:.56,
     w:.24,h:1.15,d:.24,
   }));
  group.userData.collisionRadius=item.kind==='chest'?1.5:2;
  group.position.set(item.x,ctx.terrain.heightAt(item.x,item.z),item.z);
  group.traverse(node=>{if(node.isMesh)node.castShadow=true;});
  return group;
 }
 const dummy=new THREE.Object3D();
 function updateRack(item){
  const rack=item.group.userData.logs;
  if(!rack)return;
  for(let i=0;i<item.logs;i++){
   // 8 logs per layer, 6 layers; overlap-free repeated positions.
   const row=i%8,layer=Math.floor(i/8);
   dummy.position.set((row%4-1.5)*.62,.28+layer*.34,(Math.floor(row/4)-.5)*.64);
   dummy.rotation.set(0,0,Math.PI/2);dummy.scale.set(.24,.52,.24);
   dummy.updateMatrix();rack.setMatrixAt(i,dummy.matrix);
  }
  rack.count=item.logs;rack.instanceMatrix.needsUpdate=true;
  // Stacked logs form a growing obstacle inside the rack. Both adapters
  // receive the same geometry whenever inventory changes.
  const base=item.group.userData.collisionBoxes.slice(0,4);
  if(item.logs>0)base.push({x:0,y:.28+(Math.ceil(item.logs/8)-1)*.17,
    z:0,w:2.65,h:Math.ceil(item.logs/8)*.34,d:.9});
  item.group.userData.collisionBoxes=base;
  ctx.collisionWorld?.invalidate?.();
 }
 function add(raw){
  if(!validStorage(raw))return false;
  const existing=structures.get(raw.id);
  if(existing&&existing.kind===raw.kind&&existing.x===raw.x&&existing.z===raw.z){
   const changedLabel=existing.kind==='chest'&&existing.name!==raw.name;
   const group=existing.group;
   Object.assign(existing,{...raw,slots:raw.slots?.map(x=>x?{...x}:null),group});
   if(changedLabel){
    const label=group.userData.label;
    label.material.map?.dispose();
    label.material.dispose();
    label.material=nameMaterial(existing.name);
   }
   if(existing.kind==='rack')updateRack(existing);
   if(opened===existing.id)render();
   return true;
  }
  if(existing)remove(raw.id);
  const item={...raw,slots:raw.slots?.map(x=>x?{...x}:null),group:null};
  item.group=visual(item);structures.set(item.id,item);scene.add(item.group);
  ctx.collisionWorld?.invalidate?.();
  if(item.kind==='rack')updateRack(item);
  if(opened===item.id)render();
  return true;
 }
 function remove(id){const item=structures.get(id);if(!item)return false;
  scene.remove(item.group);
  const label=item.group.userData.label;if(label){label.material.map.dispose();label.material.dispose();label.geometry.dispose();}
  structures.delete(id);ctx.collisionWorld?.invalidate?.();if(opened===id)close();return true;
 }
 function clear(){for(const id of [...structures.keys()])remove(id);}
 function snapshot(){return [...structures.values()].map(({group,...item})=>({...item,slots:item.slots?.map(s=>s?{...s}:null)}));}
 function set(list){clear();for(const entry of list??[])add(entry);}
 function nearest(max=3.2){
  let best=null,dist=max;
  for(const item of structures.values()){const d=Math.hypot(item.x-ctx.px,item.z-ctx.pz);
   if(d<dist){dist=d;best=item;}}
  return best;
 }
 function position(){return {x:Math.round((ctx.px-Math.sin(ctx.yaw)*3)*2)/2,z:Math.round((ctx.pz-Math.cos(ctx.yaw)*3)*2)/2};}
 function place(kind){
  const state=ctx.inventory?.state;
  if(!Object.hasOwn(STORAGE_COST,kind)||ctx.inventory?.selected!==kind||
     !state||state.count(kind)<1||structures.size>=120)return false;
  const p=position();
  if(ctx.terrain.waterDepthAt(p.x,p.z)>.12 ||
    [...structures.values()].some(s=>Math.hypot(s.x-p.x,s.z-p.z)<2.4)||
    [...ctx.campStructures?.items?.values()??[]].some(s=>Math.hypot(s.x-p.x,s.z-p.z)<2.4))return false;
  if(ctx.isOnline?.()){ctx.sendNet({type:'storage_place',kind,x:p.x,z:p.z});return true;}
  const item=makeStorage(kind,--lastId,p.x,p.z);
  if(!add(item))return false;
  if(!state.consumeSelected(kind)){remove(item.id);return false;}
  ctx.wood=state.wood();ctx.inventory.render();ctx.offlineSave?.markDirty?.();
  return true;
 }
 function dismantle(id){
  const item=structures.get(id),state=ctx.inventory?.state;
  if(!item||!ctx.inventory?.equipped||!state||
    Math.hypot(ctx.px-item.x,ctx.pz-item.z)>6)return false;
  if((item.kind==='chest'&&item.slots.some(Boolean))||
     (item.kind==='rack'&&item.logs>0)){
    ctx.notify?.('Сначала освободи хранилище','warning');return false;
  }
  const reward={id:item.kind,count:1};
  if(!state.canAdd(reward)){ctx.notify?.('Сумка заполнена или превышен вес','warning');return false;}
  if(ctx.isOnline?.()){ctx.sendNet({type:'hit_structure',kind:'storage',id});return true;}
  if(!state.addItem(reward))return false;
  remove(id);ctx.inventory.render();ctx.offlineSave?.markDirty?.();
  ctx.notify?.('Хранилище возвращено в сумку','success');return true;
 }
 function change(id,direction,slot,qty=1){
  const item=structures.get(id);
  if(!item||Math.hypot(item.x-ctx.px,item.z-ctx.pz)>3.2)return false;
  if(ctx.isOnline?.()){ctx.sendNet({type:'storage_transfer',id,direction,slot,qty});return true;}
  if(item.kind==='chest'&&!transferStorage(item,ctx.inventory.state,{direction,slot,qty}))return false;
  if(item.kind==='rack'){
   if(direction==='deposit'){
    if(item.logs+qty>RACK_MAX_LOGS||ctx.inventory.state.count('log')<qty)return false;
    ctx.inventory.state.spend('log',qty);item.logs+=qty;
   }else if(direction==='withdraw'){
    if(item.logs<qty||ctx.inventory.state.freeLogs()<qty)return false;
    ctx.inventory.state.addLogs(qty);item.logs-=qty;
   }else return false;
   updateRack(item);
  }
  ctx.wood=ctx.inventory.state.wood();ctx.inventory.render();ctx.offlineSave?.markDirty?.();render();return true;
 }
 // Drag/drop is an atomic slot-to-slot move, not the legacy auto-stacking
 // 'put/take' button operation. The server validates and broadcasts it online.
 function move(id,fromArea,from,toArea,to,half=false){
  const item=structures.get(id);
  if(!item||item.kind!=='chest'||Math.hypot(item.x-ctx.px,item.z-ctx.pz)>3.2)return false;
  if(ctx.isOnline?.()){
   ctx.sendNet({type:'storage_move',id,fromArea,from,toArea,to,half});
   return true;
  }
  if(!moveStorageSlot(item,ctx.inventory.state,{fromArea,from,toArea,to,half}))return false;
  ctx.wood=ctx.inventory.state.wood();
  ctx.inventory.render();
  ctx.offlineSave?.markDirty?.();
  render();
  return true;
 }
 function rename(id,name){
  const item=structures.get(id);if(!item||item.kind!=='chest'||Math.hypot(item.x-ctx.px,item.z-ctx.pz)>3.2)return false;
  if(ctx.isOnline?.()){ctx.sendNet({type:'storage_rename',id,name});return true;}
  if(!renameStorage(item,name))return false;
  add({...item});ctx.offlineSave?.markDirty?.();return true;
 }
 function resetDrag(){
  drag?.ghost?.remove();drag=null;
  modal.querySelectorAll?.('.fc-drop-hover')?.forEach(el=>el.classList.remove('fc-drop-hover'));
 }
 function close(){opened=null;resetDrag();modal.hidden=true;backdrop.hidden=true;}
 function open(id){const item=structures.get(id);if(!item||Math.hypot(item.x-ctx.px,item.z-ctx.pz)>3.2)return false;
  opened=id;chosen=-1;modal.hidden=false;backdrop.hidden=false;ctx.inventory?.close?.();render();return true;}
 function storageCell(value,area,i,item){
  const slot=doc.createElement('button');
  slot.type='button';slot.className='fc-slot fc-storage-cell';
  slot.dataset.area=area;slot.dataset.slot=String(i);
  slot.dataset.chosen=String(chosen===(area==='chest'?i:CHEST_SLOTS+i));
  slot.title=value?itemDisplayName(value.id)+' ×'+(value.count??1)
    +' · '+itemWeight(value).toFixed(1)+' кг':'Пустой слот';
  slot.setAttribute('aria-label',(area==='chest'?'Сундук':'Сумка')+' слот '+(i+1)+': '+slot.title);
  const image=ctx.inventory?.getIcon?.(itemIconKey(value));
  if(image){
   const img=doc.createElement('img');
   img.className='fc-item-icon';img.src=image;img.alt='';img.draggable=false;
   slot.append(img);
  }else if(value){
   const icon=doc.createElement('span');icon.textContent=itemDisplayIcon(value.id);
   slot.append(icon);
  }
  if(value&&value.id!=='axe'){
   const quantity=doc.createElement('small');quantity.textContent=String(value.count);slot.append(quantity);
  }
  slot.onclick=()=>{
   if(performance.now()<suppressClickUntil)return;
   chosen=area==='chest'?i:CHEST_SLOTS+i;
   render();
  };
  return slot;
 }
 // Same pointer + floating-ghost interaction as inventory (mouse and touch).
 function pointerStart(e){
  if(e.button!==0||drag||opened===null||modal.hidden)return;
  const cell=e.target.closest?.('.fc-storage-cell[data-area][data-slot]');
  if(!cell||!modal.contains(cell))return;
  const item=structures.get(opened),area=cell.dataset.area,index=Number(cell.dataset.slot);
  if(item?.kind!=='chest')return;
  const value=area==='chest'?item.slots[index]:ctx.inventory.state.slots[index];
  if(!value)return;
  drag={pointerId:e.pointerId,area,index,x:e.clientX,y:e.clientY,start:performance.now(),
   half:e.shiftKey,itemId:item.id,started:false,ghost:null};
 }
 function pointerMove(e){
  if(!drag||e.pointerId!==drag.pointerId)return;
  if(!drag.started&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<8)return;
  if(!drag.started){
   drag.started=true;
   const item=structures.get(drag.itemId);
   const value=drag.area==='chest'?item?.slots[drag.index]:ctx.inventory.state.slots[drag.index];
   const ghost=doc.createElement('div');ghost.className='fc-drag-ghost';
   ghost.style.cssText='position:fixed;z-index:10020;pointer-events:none;opacity:.87;transform:translate(-50%,-50%);width:56px;height:56px;background:#365c42f2;border:2px solid #d6f1b7;border-radius:10px;color:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;box-shadow:0 8px 25px #0009';
   const image=ctx.inventory?.getIcon?.(itemIconKey(value));
   if(image){
    const img=doc.createElement('img');img.src=image;img.alt='';img.draggable=false;
    img.style.cssText='width:90%;height:90%;object-fit:contain';ghost.append(img);
   }else ghost.textContent=itemDisplayIcon(value?.id);
   doc.body.append(ghost);drag.ghost=ghost;
  }
  e.preventDefault();
  drag.ghost.style.left=e.clientX+'px';drag.ghost.style.top=e.clientY+'px';
  modal.querySelectorAll('.fc-drop-hover').forEach(cell=>cell.classList.remove('fc-drop-hover'));
  const cell=doc.elementFromPoint(e.clientX,e.clientY)?.closest?.('.fc-storage-cell[data-area][data-slot]');
  if(cell&&modal.contains(cell))cell.classList.add('fc-drop-hover');
 }
 function pointerEnd(e){
  if(!drag||e.pointerId!==drag.pointerId)return;
  const current=drag;resetDrag();
  if(!current.started||e.type==='pointercancel')return;
  suppressClickUntil=performance.now()+320;
  const cell=doc.elementFromPoint(e.clientX,e.clientY)?.closest?.('.fc-storage-cell[data-area][data-slot]');
  if(cell&&modal.contains(cell)){
   const partial=current.half||(e.pointerType==='touch'&&performance.now()-current.start>650);
   if(!move(current.itemId,current.area,current.index,cell.dataset.area,Number(cell.dataset.slot),partial))
    ctx.notify?.('Нельзя перенести предмет: нет места или превышен вес','warning');
  }
 }
 modal.addEventListener('pointerdown',pointerStart);
 doc.addEventListener('pointermove',pointerMove,{passive:false});
 doc.addEventListener('pointerup',pointerEnd);
 doc.addEventListener('pointercancel',pointerEnd);
 backdrop.onclick=close;
 function render(){
  if(opened===null||modal.hidden)return;
  const item=structures.get(opened);if(!item){close();return;}
  modal.replaceChildren();
  const header=doc.createElement('header');header.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px';
  const h=doc.createElement('h2');h.textContent=item.kind==='chest'?'📦 '+item.name:'🪵 Склад брёвен';h.style.margin='0';
  const x=doc.createElement('button');x.textContent='✕';x.onclick=close;header.append(h,x);modal.append(header);
  const meter=doc.createElement('p');meter.className='fc-storage-meter';
  meter.textContent=item.kind==='chest'
    ?item.slots.filter(Boolean).length+' / '+CHEST_SLOTS+' слотов · '+storageWeight(item).toFixed(1)+' / '+CHEST_MAX_WEIGHT+' кг'
    :item.logs+' / '+RACK_MAX_LOGS+' брёвен';modal.append(meter);
  if(item.kind==='chest'){
   const input=doc.createElement('input');input.className='fc-storage-name';input.value=item.name;input.maxLength=40;input.setAttribute('aria-label','Подпись сундука');
   const save=doc.createElement('button');save.textContent='✎ Сохранить название';save.onclick=()=>rename(item.id,input.value);modal.append(input,save);
   const title=doc.createElement('p');title.className='fc-storage-hint';
   title.textContent='Перетаскивай предметы между ячейками и сумкой. Shift + перетаскивание — половина стака.';
   modal.append(title);
   const grid=doc.createElement('div');grid.className='fc-storage-grid';
   for(let i=0;i<CHEST_SLOTS;i++)grid.append(storageCell(item.slots[i],'chest',i,item));
   modal.append(grid);
  }
  const subtitle=doc.createElement('p');subtitle.textContent='Сумка игрока (выбери слот для передачи)';modal.append(subtitle);
  const playerGrid=doc.createElement('div');playerGrid.className='fc-storage-grid fc-storage-player-grid';
  for(let i=0;i<ctx.inventory.state.slots.length;i++)
   playerGrid.append(storageCell(ctx.inventory.state.slots[i],'bag',i,item));
  modal.append(playerGrid);
  const actions=doc.createElement('div');actions.className='fc-storage-actions';
  for(const qty of [1,5]){
   const put=doc.createElement('button');put.textContent='↓ Положить '+qty;
   put.onclick=()=>change(item.id,'deposit',item.kind==='rack'?0:chosen-CHEST_SLOTS,qty);
   put.disabled=item.kind==='chest'&&chosen<CHEST_SLOTS;actions.append(put);
   const take=doc.createElement('button');take.textContent='↑ Забрать '+qty;
   take.onclick=()=>change(item.id,'withdraw',item.kind==='rack'?0:chosen,qty);
   take.disabled=item.kind==='chest'&&(chosen<0||chosen>=CHEST_SLOTS);actions.append(take);
  }
  if(item.kind==='chest'){
   const putAll=doc.createElement('button');putAll.textContent='↓ Весь стак';
   putAll.disabled=chosen<CHEST_SLOTS;
   putAll.onclick=()=>{const st=ctx.inventory.state.slots[chosen-CHEST_SLOTS];if(st)change(item.id,'deposit',chosen-CHEST_SLOTS,st.count??1);};actions.append(putAll);
   const takeAll=doc.createElement('button');takeAll.textContent='↑ Весь стак';
   takeAll.disabled=chosen<0||chosen>=CHEST_SLOTS;
   takeAll.onclick=()=>{const st=item.slots[chosen];if(st)change(item.id,'withdraw',chosen,st.count??1);};actions.append(takeAll);
  }
  modal.append(actions);
 }
 function tick(){
  if(opened!==null&&!structures.has(opened))close();
 }
 function use(){const found=nearest();return found?open(found.id):false;}
 return {add,remove,set,clear,snapshot,place,dismantle,change,move,rename,open,close,use,tick,nearest,refresh:render,createIconModel:kind=>{
    const group=visual(makeStorage(kind,1,0,0));
    if(kind==='rack')updateRack({group,logs:4});
    return group;
  },
  get structures(){return structures;},get opened(){return opened;}};
}
