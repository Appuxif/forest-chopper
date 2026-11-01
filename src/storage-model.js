// Shared constants and pure storage mutations (offline). Server mirrors these checks.
import {ITEM_STACK,ITEM_WEIGHT,itemWeight,validItem} from './inventory.js';
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
const spaceFor=(slots,item)=>item.id==='axe'||item.id==='bench'
  ?slots.some(s=>s===null)
  :slots.reduce((n,s)=>n+(s?.id===item.id?ITEM_STACK[item.id]-s.count:!s?ITEM_STACK[item.id]:0),0)>=item.count;
export function canStore(chest,item){
 return chest.kind==='chest'&&validItem(item)&&
   storageWeight(chest)+itemWeight(item)<=CHEST_MAX_WEIGHT+1e-8&&spaceFor(chest.slots,item);
}
export function storeItem(chest,item){
 if(!canStore(chest,item))return false;
 let remaining=item.id==='axe'?1:item.count;
 if(!['axe','bench'].includes(item.id)){
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
export const renameStorage=(storage,name)=>{
 if(storage.kind!=='chest'||typeof name!=='string')return false;
 const clean=name.trim().slice(0,40);
 if(!clean)return false;
 storage.name=clean;return true;
};
