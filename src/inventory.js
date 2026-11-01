import {DECOR_ITEM_IDS} from './collectible-decor.js';
// Server and offline inventory share the same item limits and recipes.
export const LOG_STACK=5, QUICK_SLOTS=4, BASE_BAG_SLOTS=12, SLOTS_PER_UPGRADE=4;
export const ITEM_STACK={log:5,branch:10,stone:10,bench:1,axe:1,'potion:health':10,'potion:stamina':10,...Object.fromEntries(DECOR_ITEM_IDS.map(id=>[id,10]))};
export const MAX_CARRY_WEIGHT=100;
// kg per item. Counts, not stacks, determine weight; axe has no count field.
export const ITEM_WEIGHT={log:10,branch:0.5,stone:2,bench:15,axe:3,'potion:health':0.5,'potion:stamina':0.5,
 ...Object.fromEntries(DECOR_ITEM_IDS.map(id=>[id,0.1]))};
export const itemWeight=item=>item?(ITEM_WEIGHT[item.id]??0)*(item.id==='axe'?1:item.count):0;
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
 let tier=0,slots=Array(BASE_BAG_SLOTS).fill(null),quick=0,quickRefs=[0,1,2,3],quickIds=['axe',null,null,null];
 slots[0]={id:'axe',tier:0};
 const capacity=()=>BASE_BAG_SLOTS+tier*SLOTS_PER_UPGRADE;
 const count=id=>slots.reduce((n,x)=>n+(x?.id===id?(id==='axe'?1:x.count):0),0);
 const wood=()=>count('log');
 const weight=()=>slots.reduce((n,item)=>n+itemWeight(item),0);
 const remainingWeight=()=>Math.max(0,MAX_CARRY_WEIGHT-weight());
 const freeStack=id=>slots.reduce((n,x)=>n+(x?.id===id?(id==='axe'?0:ITEM_STACK[id]-x.count):!x?ITEM_STACK[id]:0),0);
 const free=id=>Math.min(freeStack(id),Math.max(0,Math.floor((remainingWeight()+1e-8)/ITEM_WEIGHT[id])));
 const freeLogs=()=>free('log');
 const quickSlot=i=>{
  const id=quickIds[i],ref=quickRefs[i];
  if(!id)return -1;
  if(slots[ref]?.id===id)return ref;
  if(id==='axe')return -1; // Never silently equip a different upgraded axe.
  return slots.findIndex(x=>x?.id===id);
 };
 const selectedSlot=()=>quickSlot(quick);
 const quickItem=i=>slots[quickSlot(i)]??null;
 const selected=()=>quickItem(quick)?.id??null;
 const equipped=()=>selected()==='axe';
 const axe=()=>equipped()?AXE_STATS[quickItem(quick).tier]:null;
 const hasSpace=()=>slots.some(x=>x===null);
 function upgradeBag(next){
  if(!Number.isInteger(next)||next<tier||next>100)return false;
  while(tier<next){tier++;slots.push(...Array(SLOTS_PER_UPGRADE).fill(null));}
  return true;
 }
 function canAdd(item,{ignoreWeight=false}={}){
  if(!item||!Object.hasOwn(ITEM_STACK,item.id))return false;
  if(item.id==='axe')return Number.isInteger(item.tier)&&item.tier>=0&&item.tier<AXE_STATS.length&&hasSpace()&&(ignoreWeight||weight()+itemWeight(item)<=MAX_CARRY_WEIGHT+1e-8);
  if(!Number.isSafeInteger(item.count)||item.count<1||item.count>50000)return false;
  if(!ignoreWeight&&weight()+itemWeight(item)>MAX_CARRY_WEIGHT+1e-8)return false;
  if(item.id==='bench')return item.count===1&&hasSpace();
  return freeStack(item.id)>=item.count;
 }
 function addItem(item,options){
  if(!canAdd(item,options))return false;
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
 function addLogs(amount,{ignoreWeight=false}={}){if(!Number.isSafeInteger(amount)||amount<0)return 0;
  const n=Math.min(amount,ignoreWeight?freeStack('log'):freeLogs());
  if(n>0)addItem({id:'log',count:n},{ignoreWeight});return n;}
 function spendLogs(n){return spend('log',n);}
 function setWood(total,{migrate=false}={}){
  if(!Number.isSafeInteger(total)||total<0)return false;
  if(migrate)while(total>wood()+freeStack('log')&&tier<100)upgradeBag(tier+1);
  const delta=total-wood();
  return delta>=0?addLogs(delta,{ignoreWeight:migrate})===delta:spendLogs(-delta);
 }
 function transfer(a,b,{half=false}={}){
  if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=slots.length||b>=slots.length||a===b||!slots[a])return false;
  const source=slots[a],dest=slots[b];
  if(half&&source.id!=='axe'&&source.count>1){
    const amount=Math.floor(source.count/2);
    if(dest&&dest.id!==source.id)return false;
    if(dest&&dest.count+amount>ITEM_STACK[source.id])return false;
    source.count-=amount;
    if(dest)dest.count+=amount;else slots[b]={id:source.id,count:amount};
    return true;
  }
  if(dest?.id===source.id&&source.id!=='axe'){
    const space=ITEM_STACK[source.id]-dest.count;
    if(space<=0)return false;
    const amount=Math.min(space,source.count);
    dest.count+=amount;source.count-=amount;
    if(!source.count){
      slots[a]=null;
      if(!quickRefs.includes(b))quickRefs=quickRefs.map(ref=>ref===a?b:ref);
    }
    return true;
  }
  [slots[a],slots[b]]=[slots[b],slots[a]];
  quickRefs=quickRefs.map(ref=>ref===a?b:ref===b?a:ref);
  return true;
 }
 function move(a,b){return transfer(a,b);}
 function split(i){
  if(!Number.isInteger(i)||i<0||i>=slots.length||!slots[i]||slots[i].id==='axe'||slots[i].count<2)return false;
  const target=slots.findIndex(x=>x===null);
  return target>=0&&transfer(i,target,{half:true});
 }
 function assignQuick(index,slotIndex){
  if(!Number.isInteger(index)||index<0||index>=QUICK_SLOTS
    ||!Number.isInteger(slotIndex)||slotIndex<0||slotIndex>=slots.length)return false;
  const old=quickRefs[index];
  const other=quickRefs.indexOf(slotIndex);
  const oldId=quickIds[index];
  quickRefs[index]=slotIndex;
  quickIds[index]=slots[slotIndex]?.id??null;
  if(other>=0&&other!==index){quickRefs[other]=old;quickIds[other]=oldId;}
  return true;
 }
 function swapQuick(a,b){
  if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||a>=QUICK_SLOTS||b<0||b>=QUICK_SLOTS)return false;
  [quickRefs[a],quickRefs[b]]=[quickRefs[b],quickRefs[a]];
  [quickIds[a],quickIds[b]]=[quickIds[b],quickIds[a]];return true;
 }
 function select(i){if(!Number.isInteger(i)||i<0||i>=QUICK_SLOTS)return false;quick=i;return true;}
 function consumeAt(index,id){
  if(!Number.isInteger(index)||index<0||index>=slots.length)return false;
  const item=slots[index];
  if(!item||item.id!==id||!Number.isInteger(item.count)||item.count<=0)return false;
  item.count--;
  if(item.count===0)slots[index]=null;
  return true;
 }
 function consumeSelected(id){return consumeAt(selectedSlot(),id);}
 function takeAt(i,qty){
  if(!Number.isInteger(i)||i<0||i>=slots.length||!Number.isInteger(qty)||qty<1)return null;
  const item=slots[i],available=item?.id==='axe'?1:item?.count??0;
  if(!item||qty>available)return null;
  const result=item.id==='axe'?copy(item):{id:item.id,count:qty};
  if(qty===available)slots[i]=null;
  else item.count-=qty;
  return result;
 }
 function removeSlot(i){
  if(!Number.isInteger(i)||i<0||i>=slots.length||!slots[i])return null;
  const item=copy(slots[i]);slots[i]=null;return item;
 }
 function restoreSlot(i,item){
  if(!Number.isInteger(i)||i<0||i>=slots.length||slots[i]||!validItem(item)||!canAdd(item))return false;
  slots[i]=copy(item);return true;
 }
 function serialize(){return {version:1,bagTier:tier,selectedQuick:quick,quickRefs:[...quickRefs],quickIds:[...quickIds],slots:slots.map(copy)};}
 function restore(data,legacyWood=0){
  if(data!=null){
   if(!data||data.version!==1||!Number.isInteger(data.bagTier)||data.bagTier<0||data.bagTier>100
    ||!Number.isInteger(data.selectedQuick)||data.selectedQuick<0||data.selectedQuick>=QUICK_SLOTS
    ||!Array.isArray(data.slots)||data.slots.length!==BASE_BAG_SLOTS+SLOTS_PER_UPGRADE*data.bagTier
    ||data.slots.some(x=>x!==null&&!validItem(x))
    ||(data.quickIds!==undefined&&(!Array.isArray(data.quickIds)||data.quickIds.length!==QUICK_SLOTS
      ||data.quickIds.some(id=>id!==null&&!Object.hasOwn(ITEM_STACK,id))))
    ||(data.quickRefs!==undefined&&(!Array.isArray(data.quickRefs)||data.quickRefs.length!==QUICK_SLOTS
      ||new Set(data.quickRefs).size!==QUICK_SLOTS||data.quickRefs.some(x=>!Number.isInteger(x)||x<0||x>=data.slots.length)))
    ||data.slots.reduce((n,x)=>n+(x?.id==='log'?x.count:0),0)!==legacyWood)return false;
   tier=data.bagTier;slots=data.slots.map(copy);quick=data.selectedQuick;quickRefs=data.quickRefs?[...data.quickRefs]:[0,1,2,3];quickIds=data.quickIds?[...data.quickIds]:quickRefs.map(ref=>slots[ref]?.id??null);
   return true;
  }
  tier=0;slots=Array(BASE_BAG_SLOTS).fill(null);slots[0]={id:'axe',tier:0};quick=0;quickRefs=[0,1,2,3];quickIds=['axe',null,null,null];
  return setWood(legacyWood,{migrate:true});
 }
 return {capacity,count,wood,free,freeLogs,weight,remainingWeight,equipped,axe,selected,hasSpace,canAdd,addItem,spend,craft,
  upgradeBag,addLogs,spendLogs,setWood,move,transfer,split,assignQuick,swapQuick,quickItem,quickSlot,selectedSlot,select,consumeAt,consumeSelected,takeAt,removeSlot,restoreSlot,addBench,removeBench,craftBench,
  serialize,restore,get slots(){return slots.map(copy)},
  get bagTier(){return tier},get selectedQuick(){return quick},get quickRefs(){return [...quickRefs]},get quickIds(){return [...quickIds]}};
}
