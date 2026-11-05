export function hasCorpseLoot(record){return Object.values(record?.loot??{}).some(count=>Number.isFinite(count)&&count>0);}

export function createCorpseLootActions(ctx,{getRecord,world,refresh,now=()=>performance.now(),transport={},validItem=item=>typeof item==='string'&&item.length>0,maxDistance=2.8}={}){
 const pending=new Map();
 const takePacket=transport.takePacket??((id,item)=>({type:'corpse_take',id,item}));
 const receiptField=transport.receiptField??'corpse_loot';
 function take(id,item){
  const record=getRecord(id);if(!record||record.hp>0||!validItem(item)||!(record.loot?.[item]>0))return false;
  if(Math.hypot(record.x-ctx.px,record.z-ctx.pz)>maxDistance){ctx.notify?.('Слишком далеко','warning');return false;}
  const state=ctx.inventory.state;
  if(!state.canAdd({id:item,count:record.loot[item]})){ctx.notify?.('В сумке нет места','warning');return false;}
  if(ctx.isOnline()){
   const key=id+':'+item,time=now();prune();if(pending.has(key))return false;
   pending.set(key,time);ctx.sendNet(takePacket(id,item));return true;
  }
  const count=world().take(id,item,record.loot[item],(kind,n)=>state.canAdd({id:kind,count:n}),(kind,n)=>state.addItem({id:kind,count:n}));
  if(count){ctx.inventory.render();ctx.offlineSave?.markDirty();ctx.audio?.effect('pickup');}
  refresh();return !!count;
 }
 function accept(data){
  const receipt=data?.[receiptField];
  if(!receipt||!Number.isInteger(receipt.count)||receipt.count<1||!validItem(receipt.item))return;
  if(pending.delete(receipt.id+':'+receipt.item))ctx.audio?.effect('pickup');
 }
 function prune(){for(const [key,time] of pending)if(now()-time>=5000)pending.delete(key);}
 return {take,accept,prune,clear:()=>pending.clear()};
}
