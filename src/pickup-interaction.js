import {DECOR_ITEM_NAMES} from './collectible-decor.js';
import {ITEM_NAMES} from './ground-boxes.js';

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
      label:DECOR_ITEM_NAMES[node.kind]??(node.kind==='branch'?'Ветка':'Камень'),
    });
  }
  const boxes=[];
  for(const node of ctx.groundBoxes?.boxes??[]){
    const distance=Math.hypot(node.x-ctx.px,node.z-ctx.pz);
    if(distance>2.8)continue;
    boxes.push({
      type:'box',id:node.id,x:node.x,z:node.z,
      y:ctx.terrain.heightAt(node.x,node.z)+.28,maxDistance:2.8,distance,
      label:ITEM_NAMES[node.item.id]??'Предмет',
    });
  }
  return {resources,boxes};
}
export function createPickupInteraction(ctx){
  const button=ctx.$('pickup');
  const scratch=new ctx.THREE.Vector3();
  let target=null;
  const coarse=()=>matchMedia('(pointer:coarse)').matches;
  const project=item=>{
    scratch.set(item.x,item.y,item.z).project(ctx.camera);
    return scratch;
  };
  function calculate(){
    const {resources,boxes}=pickupCandidates(ctx);
    // Tree/craft placement reticles are independent; a reachable nearby item
    // remains available by E or the touch button even if not aimed at.
    const focused=selectPickupTarget([...resources,...boxes],project);
    return {focused,nearest:nearestPickupTarget(resources,boxes)};
  }
  function update(){
    const result=calculate();
    target=result.focused;
    if(button){
      const available=!ctx.buildMode&&!!(result.focused??result.nearest);
      button.hidden=!coarse()||!available;
      button.disabled=!available;
      const label=result.focused?.label??result.nearest?.label;
      button.setAttribute('aria-label',label?'Поднять: '+label:'Поднять предмет');
      button.title=label?'Поднять: '+label:'Поднять предмет';
    }
    return ctx.buildMode?null:target;
  }
  function pickup(){
    const {focused,nearest}=calculate();
    const item=focused??nearest;
    if(!item)return false;
    return item.type==='box'
      ?(ctx.groundBoxes?.pickup(item.id)??false)
      :(ctx.forestResources?.collect(item.id)??false);
  }
  if(button)button.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    pickup();
    update();
  });
  return {update,pickup,get focused(){return target;}};
}
