// Shared, engine-neutral collision geometry. The controller and Rapier read
// the same live world objects; new solid props are registered here once.
import {BUILD_LOG_LENGTH,logHalfExtents} from './log-grid.js';

export const DEFAULT_TREE_RADIUS=.75;
export const collisionLog= (log,radius=.29)=>{
 const r=radius,vertical=log.orientation===2;
 return {kind:'log',shape:'capsule',x:log.x,y:log.y,z:log.z,
  axis:vertical?'y':log.orientation===0?'x':'z',
  halfLength:vertical?BUILD_LOG_LENGTH/2-r:BUILD_LOG_LENGTH/2,
  radius:r,half:logHalfExtents(log,r)};
};
export function collisionTree(tree){
 const height=tree.userData?.h??9;
 return {kind:'tree',shape:'cylinder',x:tree.position.x,
  y:(tree.position.y??0)+height/2,z:tree.position.z,
  radius:DEFAULT_TREE_RADIUS,hy:height/2};
}
export function collisionRock(rock){
 return {kind:'rock',shape:'cylinder',x:rock.x,
  y:(rock.bottom+rock.top)/2,z:rock.z,
  radius:rock.radius,hy:(rock.top-rock.bottom)/2};
}
export function* collisionStructure(structure){
 const group=structure.group;
 if(!group?.userData?.collisionBoxes?.length)return;
 const yaw=group.rotation?.y??(structure.orientation??0)*Math.PI/2;
 for(const b of group.userData.collisionBoxes){
  if(b.w<=0||b.h<=0||b.d<=0)continue;
  yield {kind:'structure',shape:'box',x:group.position?.x??structure.x,
   y:group.position?.y??0,z:group.position?.z??structure.z,yaw,local:{x:b.x,y:b.y,z:b.z},
   hx:b.w/2,hy:b.h/2,hz:b.d/2};
 }
}
export function collisionMattress(bed,terrain){
 return {kind:'mattress',shape:'box',x:bed.x,
  y:terrain.heightAt(bed.x,bed.z)+.51,z:bed.z,
  yaw:(bed.orientation??0)*Math.PI/2,hx:.52,hy:.09,hz:.83};
}
export function shapeHeight(shape){
 const center=shape.y+(shape.local?.y??0);
 const half=shape.shape==='capsule'
  ?(shape.axis==='y'?shape.halfLength+shape.radius:shape.radius)
  :shape.hy;
 return {bottom:center-half,top:center+half};
}
export function shapeFootprint(shape,x,z,margin=0){
 const dx=x-shape.x,dz=z-shape.z;
 if(shape.shape==='capsule'){
  const distance=shape.axis==='x'?Math.hypot(Math.max(0,Math.abs(dx)-shape.halfLength),dz)
   :shape.axis==='z'?Math.hypot(dx,Math.max(0,Math.abs(dz)-shape.halfLength))
   :Math.hypot(dx,dz);
  return distance<shape.radius+margin;
 }
 if(shape.shape==='cylinder')return Math.hypot(dx,dz)<shape.radius+margin;
 // Box is authored in a rotated structure group. Its own local axes and
 // offsets remain the source of truth for both adapters.
 const yaw=shape.yaw??0,cos=Math.cos(yaw),sin=Math.sin(yaw);
 const lx=cos*dx-sin*dz-(shape.local?.x??0);
 const lz=sin*dx+cos*dz-(shape.local?.z??0);
 const ox=Math.max(Math.abs(lx)-shape.hx,0);
 const oz=Math.max(Math.abs(lz)-shape.hz,0);
 return ox*ox+oz*oz<margin*margin || (margin===0&&ox===0&&oz===0);
}
export function makeGroundMesh(terrain,x,z,size=14,step=1.5){
 const vertices=[],indices=[],sections=Math.ceil(size*2/step);
 const side=sections+1,start=-sections*step/2;
 for(let ix=0;ix<=sections;ix++)for(let iz=0;iz<=sections;iz++){
  const dx=start+ix*step,dz=start+iz*step;
  vertices.push(dx,terrain.heightAt(x+dx,z+dz),dz);
 }
 for(let ix=0;ix<sections;ix++)for(let iz=0;iz<sections;iz++){
  const a=ix*side+iz,b=(ix+1)*side+iz,c=a+1,d=b+1;
  indices.push(a,c,b,b,c,d);
 }
 return {vertices:new Float32Array(vertices),indices:new Uint32Array(indices)};
}
export function createCollisionWorld(ctx){
 let revision=0;
 function* structures(){
  yield* ctx.crafting?.items?.values?.()??[];
  yield* ctx.campStructures?.items?.values?.()??[];
  yield* ctx.storages?.structures?.values?.()??[];
 }
 function forEachNear(x,z,radius,visit,{bed=null,includeTrees=true}={}){
  // Unlike the physics adapters, this module owns the only conversions from
  // authored world items to collision primitives. No persistent duplicate
  // world to synchronize after save/load, edits or destruction.
  for(const log of ctx.placed??[]){
   if(Math.hypot(log.x-x,log.z-z)<=radius+2)
    visit(collisionLog(log,ctx.logRadius??.29));
  }
  if(includeTrees)for(const tree of ctx.trees?.values?.()??[]){
   if(Math.hypot(tree.position.x-x,tree.position.z-z)<=radius+1)
    visit(collisionTree(tree));
  }
  const rocks=ctx.rockColliders,chunk=ctx.chunkSize??24;
  if(rocks?.size&&chunk>0){
   const minX=Math.floor((x-radius)/chunk)-1,maxX=Math.floor((x+radius)/chunk)+1;
   const minZ=Math.floor((z-radius)/chunk)-1,maxZ=Math.floor((z+radius)/chunk)+1;
   for(let ix=minX;ix<=maxX;ix++)for(let iz=minZ;iz<=maxZ;iz++){
    for(const rock of rocks.get(`${ix},${iz}`)??[]){
     if(Math.hypot(rock.x-x,rock.z-z)<=radius+rock.radius)
      visit(collisionRock(rock));
    }
   }
  }
  for(const item of structures()){
   if(bed&&item.kind==='bed'&&item.id===bed.id)continue;
   const reach=item.group?.userData?.collisionRadius??3;
   if(Math.hypot(item.x-x,item.z-z)>radius+reach)continue;
   for(const spec of collisionStructure(item))visit(spec);
  }
  if(bed)visit(collisionMattress(bed,ctx.terrain));
 }
 function collect(x,z,radius,options={}){
  const list=[];forEachNear(x,z,radius,s=>list.push(s),options);return list;
 }
 return {forEachNear,collect,structures,
  get revision(){return revision;},invalidate(){revision++;},
  terrainHeight:(x,z)=>ctx.terrain.heightAt(x,z),
  terrainMesh:(x,z,size=14,step=1.5)=>makeGroundMesh(ctx.terrain,x,z,size,step)};
}
