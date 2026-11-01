// World storage: chest inventories and log racks. One mesh set per placed structure.
// Online mutations are only applied when the server broadcasts the new snapshot.
import {CHEST_SLOTS,CHEST_MAX_WEIGHT,RACK_MAX_LOGS,STORAGE_COST,
 storageWeight,makeStorage,validStorage,transferStorage,renameStorage} from './storage-model.js';
import {itemWeight} from './inventory.js';

export function createStorages(ctx,doc=document){
 const {THREE,scene}=ctx,structures=new Map();
 let lastId=0,opened=null,chosen=-1;
 const geo=new THREE.BoxGeometry(1.45,.75,.95),woodMat=new THREE.MeshLambertMaterial({color:0x8b6139});
 const lidGeo=new THREE.BoxGeometry(1.58,.2,1.03),ironMat=new THREE.MeshLambertMaterial({color:0x454b49});
 const sideGeo=new THREE.BoxGeometry(.12,.82,1),beamGeo=new THREE.CylinderGeometry(.12,.12,2.8,7);
 const button=doc.createElement('button');button.type='button';button.className='fc-storage-open';
 button.style.cssText='position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:9;padding:10px 16px;border-radius:9px;background:#254734;color:white;border:1px solid #afc8a4;display:none';
 button.textContent='📦 Открыть хранилище (F)';doc.body.append(button);
 const modal=doc.createElement('section');modal.className='fc-storage-modal';modal.hidden=true;
 modal.style.cssText='position:fixed;z-index:38;top:50%;left:50%;transform:translate(-50%,-50%);width:min(550px,94vw);max-height:85dvh;overflow:auto;background:#172b22;color:#e5f0df;border:2px solid #a9c39b;border-radius:13px;padding:14px;box-shadow:0 18px 60px #000c';
 const style=doc.createElement('style');style.textContent='.fc-storage-modal[hidden]{display:none}.fc-storage-modal button{cursor:pointer;color:#f2f7e9;background:#305340;border:1px solid #8bba99;border-radius:6px;padding:7px}.fc-storage-modal button:disabled{opacity:.4}.fc-storage-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px}.fc-storage-cell{min-height:49px;font-size:12px;overflow:hidden}.fc-storage-cell[data-chosen=true]{outline:2px solid #f0cb7b}.fc-storage-modal .fc-storage-actions{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.fc-storage-name{width:75%;max-width:300px;padding:7px;border-radius:6px}.fc-storage-meter{margin:6px 0 10px;font-size:13px}';
 doc.head.append(style);doc.body.append(modal);
 const woodNames={log:'🪵',branch:'🌿',stone:'🪨',axe:'🪓',bench:'🪑',dry_grass:'🌾'};
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
   const board=new THREE.Mesh(new THREE.PlaneGeometry(1.18,.3),nameMaterial(item.name));
   board.position.set(0,.64,.485);group.add(board);group.userData.label=board;
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
  if(item.kind==='rack')updateRack(item);
  if(opened===item.id)render();
  return true;
 }
 function remove(id){const item=structures.get(id);if(!item)return false;
  scene.remove(item.group);
  const label=item.group.userData.label;if(label){label.material.map.dispose();label.material.dispose();label.geometry.dispose();}
  structures.delete(id);if(opened===id)close();return true;
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
  if(!Object.hasOwn(STORAGE_COST,kind))return false;
  const cost=STORAGE_COST[kind],state=ctx.inventory?.state;
  if(!state||!Object.entries(cost).every(([id,n])=>state.count(id)>=n))return false;
  const p=position();
  if(ctx.terrain.waterDepthAt(p.x,p.z)>.12 || [...structures.values()].some(s=>Math.hypot(s.x-p.x,s.z-p.z)<2.4))return false;
  if(ctx.isOnline?.()){ctx.sendNet({type:'storage_place',kind,x:p.x,z:p.z});return true;}
  const item=makeStorage(kind,--lastId,p.x,p.z);
  for(const [id,n] of Object.entries(cost))state.spend(id,n);
  if(!add(item))return false;
  ctx.wood=state.wood();ctx.inventory.render();ctx.offlineSave?.markDirty?.();
  return true;
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
 function rename(id,name){
  const item=structures.get(id);if(!item||item.kind!=='chest'||Math.hypot(item.x-ctx.px,item.z-ctx.pz)>3.2)return false;
  if(ctx.isOnline?.()){ctx.sendNet({type:'storage_rename',id,name});return true;}
  if(!renameStorage(item,name))return false;
  add({...item});ctx.offlineSave?.markDirty?.();return true;
 }
 function close(){opened=null;modal.hidden=true;}
 function open(id){const item=structures.get(id);if(!item||Math.hypot(item.x-ctx.px,item.z-ctx.pz)>3.2)return false;
  opened=id;chosen=-1;modal.hidden=false;ctx.inventory?.close?.();render();return true;}
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
   const title=doc.createElement('p');title.textContent='Содержимое сундука (выбери слот, затем количество)';modal.append(title);
   const grid=doc.createElement('div');grid.className='fc-storage-grid';
   for(let i=0;i<CHEST_SLOTS;i++){
    const slot=doc.createElement('button');slot.className='fc-storage-cell';slot.dataset.chosen=String(chosen===i);
    const value=item.slots[i];slot.title=value?value.id+' ×'+(value.count??1)+' · '+itemWeight(value)+' кг':'Пустой слот';
    slot.textContent=value?(woodNames[value.id]??'📦')+' ×'+(value.count??1):'·';
    slot.onclick=()=>{chosen=i;render();};grid.append(slot);
   }
   modal.append(grid);
  }
  const subtitle=doc.createElement('p');subtitle.textContent='Сумка игрока (выбери слот для передачи)';modal.append(subtitle);
  const playerGrid=doc.createElement('div');playerGrid.className='fc-storage-grid';
  for(let i=0;i<ctx.inventory.state.slots.length;i++){
   const value=ctx.inventory.state.slots[i],slot=doc.createElement('button');
   slot.className='fc-storage-cell';slot.textContent=value?(woodNames[value.id]??'📦')+' ×'+(value.count??1):'·';
   slot.dataset.chosen=String(chosen===CHEST_SLOTS+i);slot.title=value?.id??'Пусто';
   slot.onclick=()=>{chosen=CHEST_SLOTS+i;render();};playerGrid.append(slot);
  }
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
 button.onclick=()=>{const item=nearest();if(item)open(item.id);};
 function tick(){const found=nearest();button.style.display=found?'block':'none';
  if(found)button.textContent=found.kind==='chest'?'📦 '+found.name+' (F)':'🪵 Склад '+found.logs+'/'+RACK_MAX_LOGS+' (F)';
  if(opened!==null&&!structures.has(opened))close();
 }
 function use(){const found=nearest();return found?open(found.id):false;}
 return {add,remove,set,clear,snapshot,place,change,rename,open,close,use,tick,nearest,
  get structures(){return structures;},get opened(){return opened;}};
}
