import {itemDisplayName} from './item-display.js';

export const PICKUP_RETICLE_RADIUS=0.28;

// All coordinates are in normalized device space (the screen centre is 0, 0).
// Search only reachable items and prefer the object closest to the crosshair.
export function selectPickupTarget(candidates,project,{radius=PICKUP_RETICLE_RADIUS}={}){
  let best=null,score=Infinity;
  for(const item of candidates){
    if(item.distance>item.maxDistance)continue;
    const ndc=project(item);
    if(!ndc||ndc.z<=-1||ndc.z>=1)continue;
    const dx=ndc.x,dy=ndc.y;
    const screenDistance=Math.hypot(dx,dy);
    if(screenDistance>radius)continue;
    const current=screenDistance+item.distance*.007;
    if(current<score){best=item;score=current;}
  }
  return best;
}

export function nearestPickupTarget(resources,boxes){
  let best=null;
  for(const item of [...(resources??[]),...(boxes??[])]){
    if(item.distance>item.maxDistance)continue;
    if(!best||item.distance<best.distance)best=item;
  }
  return best;
}
export function pickupCandidates(ctx){
  const resources=[];
  for(const node of ctx.forestResources?.nodes??[]){
    const distance=Math.hypot(node.x-ctx.px,node.z-ctx.pz);
    if(distance>2.4||ctx.terrain.waterDepthAt(node.x,node.z)>.12)continue;
    if(ctx.forestResources?.isVisible&&!ctx.forestResources.isVisible(node.id))continue;
    resources.push({
      type:'resource',id:node.id,kind:node.kind,x:node.x,z:node.z,
      y:ctx.terrain.heightAt(node.x,node.z)+(node.kind==='branch'?.18:.23),
      maxDistance:2.4,distance,
      label:itemDisplayName(node.kind),
    });
  }
  const boxes=[];
  for(const node of ctx.groundBoxes?.pickupNodes??ctx.groundBoxes?.boxes??[]){
    const distance=Math.hypot(node.x-ctx.px,node.z-ctx.pz);
    if(distance>2.8)continue;
    boxes.push({
      type:'box',id:node.id,segment:node.segment,x:node.x,z:node.z,
      y:ctx.terrain.heightAt(node.x,node.z)+.28,maxDistance:2.8,distance,
      label:node.kind==='fallen_logs'?('Бревно · осталось '+node.item.count):itemDisplayName(node.item.id),
    });
  }
  return {resources,boxes};
}
// World interactions are resolved alongside pickups, so the crosshair,
// tooltip and E/touch actions all refer to exactly the same target.
export function worldInteractionCandidates(ctx){
 const storages=[],fires=[];
 for(const storage of ctx.storages?.structures?.values?.()??[]){
  const distance=Math.hypot(storage.x-ctx.px,storage.z-ctx.pz);
  if(distance>3.2)continue;
  storages.push({
   type:'storage',id:storage.id,x:storage.x,z:storage.z,
   y:ctx.terrain.heightAt(storage.x,storage.z)+(storage.kind==='chest'?1.05:.85),
   distance,maxDistance:3.2,
   label:storage.kind==='chest'?'Сундук':'Склад брёвен',
   verb:'Открыть',
  });
 }
 for(const fire of ctx.campStructures?.items?.values?.()??[]){
  if(!['campfire','torch'].includes(fire.kind))continue;
  const distance=Math.hypot(fire.x-ctx.px,fire.z-ctx.pz);
  if(distance>3.2)continue;
  fires.push({
   type:'camp',id:fire.id,x:fire.x,z:fire.z,
   y:ctx.terrain.heightAt(fire.x,fire.z)+(fire.kind==='torch'?1.65:.7),
   distance,maxDistance:3.2,
   label:fire.kind==='torch'?'Факел':'Костёр',
   verb:fire.lit?'Потушить':'Зажечь',
  });
 }
 return {storages,fires};
}
export function createPickupInteraction(ctx){
  const button=ctx.$('pickup');
  const scratch=new ctx.THREE.Vector3();
  let target=null,focused=null;
  const coarse=()=>matchMedia('(pointer:coarse)').matches;
  const project=item=>{
    scratch.set(item.x,item.y,item.z).project(ctx.camera);
    return scratch;
  };
  function calculate(){
    const {resources,boxes}=pickupCandidates(ctx);
    const {storages,fires}=worldInteractionCandidates(ctx);
    // Preserve the priority given to deliberately dropped boxes. Otherwise
    // select by on-screen crosshair proximity, not structure proximity alone.
    const centered=selectPickupTarget(boxes,project)
      ??selectPickupTarget([...storages,...fires,...resources],project);
    // When nothing is aimed at, keep E usable for the nearest world object.
    // The same fallback is also shown by the reticle; no phantom E prompts.
    const nearestWorld=nearestPickupTarget(fires,storages);
    const nearestPickup=nearestPickupTarget([],boxes)??nearestPickupTarget(resources,[]);
    return {focused:centered,selected:centered??nearestWorld??nearestPickup};
  }
  function update(){
    const result=calculate();
    focused=ctx.buildMode?null:result.focused;
    target=ctx.buildMode?null:result.selected;
    if(button){
      const available=!ctx.buildMode&&!!target;
      button.hidden=!coarse()||!available;
      button.disabled=!available;
      const label=target?.label;
      button.setAttribute('aria-label',label?'Взаимодействовать: '+label:'Взаимодействовать');
      button.title=label?'Взаимодействовать: '+label:'Взаимодействовать';
    }
    return focused;
  }
  function pickItem(item){
    if(!item)return false;
    return item.type==='box'
      ?(ctx.groundBoxes?.pickup(item.id,item.segment)??false)
      :(ctx.forestResources?.collect(item.id)??false);
  }
  function pickup(){
    const {focused,selected}=calculate();
    const item=focused?.type==='box'||focused?.type==='resource'?focused:
      selected?.type==='box'||selected?.type==='resource'?selected:null;
    return pickItem(item);
  }
  function interact(){
    if(ctx.buildMode||ctx.storages?.opened!=null)return false;
    const {selected}=calculate();
    if(!selected)return false;
    if(selected.type==='storage')return ctx.storages?.open?.(selected.id)??false;
    if(selected.type==='camp')return ctx.campStructures?.toggle?.(selected.id)??false;
    return pickItem(selected);
  }
  if(button)button.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    interact();
    update();
  });
  return {update,pickup,interact,
    get focused(){return focused;},get current(){return target;}};
}
