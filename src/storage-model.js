import {isStructureItem} from './structure-items.js';
// Shared constants and pure storage mutations (offline). Server mirrors these checks.
import {ITEM_STACK,ITEM_WEIGHT,MAX_CARRY_WEIGHT,itemWeight,validItem} from './inventory.js';
export const CHEST_SLOTS=24, CHEST_MAX_WEIGHT=300, RACK_MAX_LOGS=48;
export const STORAGE_COST={chest:{log:2,branch:4},rack:{log:2}};
export const storageWeight=chest=>chest.slots.reduce((n,item)=>n+itemWeight(item),0);
export const validStorage=data=>{
 if(!data||!Number.isInteger(data.id)||!Number.isFinite(data.x)||!Number.isFinite(data.z)
   ||Math.abs(data.x)>240000||Math.abs(data.z)>240000)return false;
 if(data.kind==='rack')return Number.isInteger(data.logs)&&data.logs>=0&&data.logs<=RACK_MAX_LOGS;
 if(data.kind!=='chest'||typeof data.name!=='string'||data.name.length>40
   ||!Array.isArray(data.slots)||data.slots.length!==CHEST_SLOTS
   ||data.slots.some(item=>item!==null&&!validItem(item)))return false;
 return storageWeight(data)<=CHEST_MAX_WEIGHT+1e-8;
};
export const makeStorage=(kind,id,x,z)=>kind==='chest'
 ?{kind,id,x,z,name:'Сундук',slots:Array(CHEST_SLOTS).fill(null)}
 :{kind,id,x,z,logs:0};
const spaceFor=(slots,item)=>item.id==='axe'||item.id==='bench'||isStructureItem(item.id)
  ?slots.some(s=>s===null)
  :slots.reduce((n,s)=>n+(s?.id===item.id?ITEM_STACK[item.id]-s.count:!s?ITEM_STACK[item.id]:0),0)>=item.count;
export function canStore(chest,item){
 return chest.kind==='chest'&&validItem(item)&&
   storageWeight(chest)+itemWeight(item)<=CHEST_MAX_WEIGHT+1e-8&&spaceFor(chest.slots,item);
}
export function storeItem(chest,item){
 if(!canStore(chest,item))return false;
 let remaining=item.id==='axe'?1:item.count;
 if(!['axe','bench'].includes(item.id)&&!isStructureItem(item.id)){
  for(const slot of chest.slots){
   if(slot?.id!==item.id||!remaining)continue;
   const n=Math.min(remaining,ITEM_STACK[item.id]-slot.count);slot.count+=n;remaining-=n;
  }
 }
 for(let i=0;i<chest.slots.length&&remaining;i++)if(!chest.slots[i]){
  if(item.id==='axe'){chest.slots[i]={id:'axe',tier:item.tier};remaining=0;}
  else {const n=Math.min(remaining,ITEM_STACK[item.id]);chest.slots[i]={id:item.id,count:n};remaining-=n;}
 }
 return remaining===0;
}
export function transferStorage(chest,player,{direction,slot,qty=1}){
 if(chest.kind!=='chest'||!Number.isInteger(slot)||!Number.isInteger(qty)||qty<1)return false;
 if(direction==='deposit'){
  const source=player.slots[slot];
  if(!source)return false;
  const count=source.id==='axe'?1:source.count;
  if(qty>count)return false;
  const moving=source.id==='axe'?{...source}:{id:source.id,count:qty};
  if(!canStore(chest,moving))return false;
  // No partial mutation until both sides have passed validation.
  const removed=player.takeAt(slot,qty);
  if(!removed)return false;
  return storeItem(chest,removed);
 }
 if(direction==='withdraw'){
  const source=chest.slots[slot];
  if(!source)return false;
  const count=source.id==='axe'?1:source.count;
  if(qty>count)return false;
  const moving=source.id==='axe'?{...source}:{id:source.id,count:qty};
  if(!player.canAdd(moving))return false;
  if(!player.addItem(moving))return false;
  if(qty===count)chest.slots[slot]=null;
  else source.count-=qty;
  return true;
 }
 return false;
}
// Slot-exact drag-and-drop (offline), mirrored by the authoritative server.
// Work on copies, validate both inventories, then commit atomically.
export function moveStorageSlot(chest,player,{fromArea,from,toArea,to,half=false}){
 if(chest.kind!=='chest'||!['chest','bag'].includes(fromArea)
   ||!['chest','bag'].includes(toArea)||!Number.isInteger(from)||!Number.isInteger(to)
   ||typeof half!=='boolean')return false;
 const bagBefore=player.serialize(),bags=bagBefore.slots.map(x=>x?{...x}:null);
 const chests=chest.slots.map(x=>x?{...x}:null);
 const sourceSlots=fromArea==='chest'?chests:bags;
 const targetSlots=toArea==='chest'?chests:bags;
 if(from<0||from>=sourceSlots.length||to<0||to>=targetSlots.length
   ||(fromArea===toArea&&from===to)||!sourceSlots[from])return false;
 const source=sourceSlots[from],target=targetSlots[to];
 const count=source.id==='axe'?1:source.count;
 const partial=half&&count>1;
 const qty=partial?Math.floor(count/2):count;
 if(partial&&target&&target.id!==source.id)return false;
 if(target&&target.id===source.id&&source.id!=='axe'
   &&source.id!=='bench'&&!isStructureItem(source.id)){
  const amount=Math.min(qty,ITEM_STACK[source.id]-target.count);
  if(amount<=0)return false;
  target.count+=amount;source.count-=amount;
  if(source.count===0)sourceSlots[from]=null;
 }else if(!target){
  if(partial){
   source.count-=qty;
   targetSlots[to]={id:source.id,count:qty};
  }else{
   targetSlots[to]=source;
   sourceSlots[from]=null;
  }
 }else if(!partial){
  targetSlots[to]=source;
  sourceSlots[from]=target;
 }else return false;
 if(chests.some(x=>x!==null&&!validItem(x))||bags.some(x=>x!==null&&!validItem(x))
   ||chests.reduce((n,x)=>n+itemWeight(x),0)>CHEST_MAX_WEIGHT+1e-8
   ||bags.reduce((n,x)=>n+itemWeight(x),0)>MAX_CARRY_WEIGHT+1e-8)return false;
 const newWood=bags.reduce((n,x)=>n+(x?.id==='log'?x.count:0),0);
 if(!player.restore({...bagBefore,slots:bags},newWood))return false;
 chest.slots=chests;
 return true;
}
export const renameStorage=(storage,name)=>{
 if(storage.kind!=='chest'||typeof name!=='string')return false;
 const clean=name.trim().slice(0,40);
 if(!clean)return false;
 storage.name=clean;return true;
};
