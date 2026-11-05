// This module is imported only by the debug cheats entrypoint.
export function createDebugMobSpawner(ctx,{findSafePoint}){
 let flockCounter=0;
 return function spawnMob(type='chicken',{count=1,subcategory}={}){
  if(ctx.isOnline())throw new Error('Читы недоступны в сетевой игре');
  count=Number(count);if(!Number.isInteger(count)||count<1||count>8)throw new Error('Количество: от 1 до 8');
  const definition=ctx.mobs?.registry.get(type);if(!definition)throw new Error('Неизвестная категория моба');
  if(subcategory!==undefined&&!Object.hasOwn(definition.subcategories,subcategory))throw new Error('Неизвестный окрас');
  const created=[],flockId=`debug-flock:${++flockCounter}`;
  for(let i=0;i<count;i++){
   const angle=ctx.yaw+(i-(count-1)/2)*.45,distance=4+Math.floor(i/3)*1.5;
   const p=findSafePoint(ctx,ctx.px-Math.sin(angle)*distance,ctx.pz-Math.cos(angle)*distance,{maxRadius:12});
   if(!p)continue;
   const mob=ctx.mobs.spawnDebug(type,p.x,p.z,{subcategory,flockId});if(mob)created.push(mob);
  }
  if(!created.length)throw new Error('Нет безопасного места или достигнут лимит 8 тестовых мобов');
  return created;
 };
}
