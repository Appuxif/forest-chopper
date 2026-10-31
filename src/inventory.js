import {DECOR_ITEM_IDS} from './collectible-decor.js';
// Server and offline inventory share the same item limits and recipes.
export const LOG_STACK=5, QUICK_SLOTS=4, BASE_BAG_SLOTS=12, SLOTS_PER_UPGRADE=4;
export const ITEM_STACK={log:5,branch:10,stone:10,bench:1,axe:1,...Object.fromEntries(DECOR_ITEM_IDS.map(id=>[id,10]))};
export const RECIPES={bench:{log:3},axe:{branch:3,stone:2}};
export const AXE_STATS=[
  {name:'Обычный топор',damage:1,speed:1},
  {name:'Стальной топор',damage:2,speed:1.2},
  {name:'Усиленный топор',damage:3,speed:1.45},
  {name:'Мастерский топор',damage:4,speed:1.7},
];
const copy=x=>x?{...x}:null;
export function validItem(x){
 if(!x||typeof x!=='object'||!Object.hasOwn(ITEM_STACK,x.id))return false;
 if(x.id==='axe')return Number.isInteger(x.tier)&&x.tier>=0&&x.tier<AXE_STATS.length;
 return Number.isInteger(x.count)&&x.count>=1&&x.count<=ITEM_STACK[x.id];
}
export function createInventoryModel(){
 let tier=0,slots=Array(BASE_BAG_SLOTS).fill(null),quick=0,dropped=null;
 slots[0]={id:'axe',tier:0};
 const capacity=()=>BASE_BAG_SLOTS+tier*SLOTS_PER_UPGRADE;
 const count=id=>slots.reduce((n,x)=>n+(x?.id===id?(id==='axe'?1:x.count):0),0);
 const wood=()=>count('log');
 const free=id=>slots.reduce((n,x)=>n+(x?.id===id?(id==='axe'?0:ITEM_STACK[id]-x.count):!x?ITEM_STACK[id]:0),0);
 const freeLogs=()=>free('log');
 const selected=()=>slots[quick]?.id??null;
 const equipped=()=>selected()==='axe';
 const axe=()=>equipped()?AXE_STATS[slots[quick].tier]:null;
 const hasSpace=()=>slots.some(x=>x===null);
 function upgradeBag(next){
  if(!Number.isInteger(next)||next<tier||next>100)return false;
  while(tier<next){tier++;slots.push(...Array(SLOTS_PER_UPGRADE).fill(null));}
  return true;
 }
 function canAdd(item){
  if(!item||!Object.hasOwn(ITEM_STACK,item.id))return false;
  if(item.id==='axe')return Number.isInteger(item.tier)&&item.tier>=0&&item.tier<AXE_STATS.length&&hasSpace();
  if(!Number.isSafeInteger(item.count)||item.count<1||item.count>50000)return false;
  if(item.id==='bench')return item.count===1&&hasSpace();
  return free(item.id)>=item.count;
 }
 function addItem(item){
  if(!canAdd(item))return false;
  let remaining=item.id==='axe'?1:item.count;
  if(item.id!=='axe'&&item.id!=='bench'){
   for(const x of slots)if(x?.id===item.id&&remaining){
    const n=Math.min(remaining,ITEM_STACK[item.id]-x.count);
    x.count+=n;remaining-=n;
   }
  }
  for(let i=0;i<slots.length&&remaining;i++)if(!slots[i]){
   if(item.id==='axe'){slots[i]={id:'axe',tier:item.tier};remaining=0;}
   else {const n=Math.min(remaining,ITEM_STACK[item.id]);slots[i]={id:item.id,count:n};remaining-=n;}
  }
  return remaining===0;
 }
 function spend(id,amount){
  if(!Number.isSafeInteger(amount)||amount<0||count(id)<amount)return false;
  for(let i=slots.length-1;i>=0&&amount;i--){
   const x=slots[i];if(x?.id!==id)continue;
   const n=Math.min(amount,x.id==='axe'?1:x.count);
   if(x.id==='axe')slots[i]=null;
   else {x.count-=n;if(!x.count)slots[i]=null;}
   amount-=n;
  }
  return true;
 }
 function craft(recipe){
  const ingredients=RECIPES[recipe];if(!ingredients)return false;
  if(!Object.entries(ingredients).every(([id,n])=>count(id)>=n))return false;
  const snapshot=slots.map(copy);
  for(const [id,n] of Object.entries(ingredients))spend(id,n);
  const item=recipe==='axe'?{id:'axe',tier:0}:{id:'bench',count:1};
  if(addItem(item))return true;
  slots=snapshot;return false;
 }
 function addBench(){return addItem({id:'bench',count:1});}
 function removeBench(i){if(slots[i]?.id!=='bench')return false;slots[i]=null;return true;}
 function craftBench(){return craft('bench');}
 function addLogs(amount){if(!Number.isSafeInteger(amount)||amount<0)return 0;
  const n=Math.min(amount,freeLogs());if(n>0)addItem({id:'log',count:n});return n;}
 function spendLogs(n){return spend('log',n);}
 function setWood(total,{migrate=false}={}){
  if(!Number.isSafeInteger(total)||total<0)return false;
  if(migrate)while(total>wood()+freeLogs()&&tier<100)upgradeBag(tier+1);
  const delta=total-wood();
  return delta>=0?addLogs(delta)===delta:spendLogs(-delta);
 }
 function move(a,b){
  if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=slots.length||b>=slots.length)return false;
  [slots[a],slots[b]]=[slots[b],slots[a]];return true;
 }
 function select(i){if(!Number.isInteger(i)||i<0||i>=QUICK_SLOTS)return false;quick=i;return true;}
 function consumeSelected(id){if(selected()!==id)return false;return spend(id,1);}
 function removeSlot(i){
  if(!Number.isInteger(i)||i<0||i>=slots.length||!slots[i])return null;
  const item=copy(slots[i]);slots[i]=null;return item;
 }
 function restoreSlot(i,item){
  if(!Number.isInteger(i)||i<0||i>=slots.length||slots[i]||!validItem(item))return false;
  slots[i]=copy(item);return true;
 }
 function dropAxe(position){
  if(dropped||!equipped()||!position||!Number.isFinite(position.x)||!Number.isFinite(position.z))return false;
  dropped={x:position.x,z:position.z,tier:slots[quick].tier};slots[quick]=null;return true;
 }
 function pickupAxe(){if(!dropped||!addItem({id:'axe',tier:dropped.tier}))return false;dropped=null;return true;}
 function serialize(){return {version:1,bagTier:tier,selectedQuick:quick,slots:slots.map(copy),dropped:dropped?{...dropped}:null};}
 function restore(data,legacyWood=0){
  if(data!=null){
   if(!data||data.version!==1||!Number.isInteger(data.bagTier)||data.bagTier<0||data.bagTier>100
    ||!Number.isInteger(data.selectedQuick)||data.selectedQuick<0||data.selectedQuick>=QUICK_SLOTS
    ||!Array.isArray(data.slots)||data.slots.length!==BASE_BAG_SLOTS+SLOTS_PER_UPGRADE*data.bagTier
    ||data.slots.some(x=>x!==null&&!validItem(x))
    ||(data.dropped&&(!Number.isFinite(data.dropped.x)||!Number.isFinite(data.dropped.z)
      ||Math.abs(data.dropped.x)>240000||Math.abs(data.dropped.z)>240000
      ||!Number.isInteger(data.dropped.tier)||data.dropped.tier<0||data.dropped.tier>=AXE_STATS.length))
    ||data.slots.reduce((n,x)=>n+(x?.id==='log'?x.count:0),0)!==legacyWood)return false;
   tier=data.bagTier;slots=data.slots.map(copy);quick=data.selectedQuick;dropped=data.dropped?{...data.dropped}:null;
   return true;
  }
  tier=0;slots=Array(BASE_BAG_SLOTS).fill(null);slots[0]={id:'axe',tier:0};quick=0;dropped=null;
  return setWood(legacyWood,{migrate:true});
 }
 return {capacity,count,wood,free,freeLogs,equipped,axe,selected,hasSpace,canAdd,addItem,spend,craft,
  upgradeBag,addLogs,spendLogs,setWood,move,select,consumeSelected,removeSlot,restoreSlot,addBench,removeBench,craftBench,
  dropAxe,pickupAxe,serialize,restore,get slots(){return slots.map(copy)},
  get bagTier(){return tier},get selectedQuick(){return quick},get dropped(){return dropped?{...dropped}:null}};
}
