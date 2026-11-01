// All cooking and alchemy recipes require their world workstation within 10m.
// This includes future recipes added to these book categories.
export const CRAFT_STATION_RADIUS=10;
export const recipeStationKind=entry=>entry?.tab==='food'?'campfire':
  entry?.tab==='alchemy'?'alchemy_table':null;
export const nearbyCraftStation=(structures,kind,x,z,radius=CRAFT_STATION_RADIUS)=>
  !kind||[...(structures?.values?.()??structures??[])].some(item=>
    item.kind===kind&&Math.hypot(item.x-x,item.z-z)<=radius);
export const canCraftAtStation=(ctx,entry)=>
  nearbyCraftStation(ctx.campStructures?.items,recipeStationKind(entry),ctx.px,ctx.pz);
