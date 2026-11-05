import {createCorpseLootActions} from './corpse-loot-actions.js';

const HEN_ITEMS=new Set(['chicken_meat','feather']);
export function createHenLootActions(ctx,options){
 return createCorpseLootActions(ctx,{...options,validItem:item=>HEN_ITEMS.has(item),
  transport:{takePacket:(id,item)=>({type:'hen_take',id,item}),receiptField:'hen_loot'},
  maxDistance:2.8});
}
