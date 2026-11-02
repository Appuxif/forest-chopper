// Backwards-compatible geometry queries for authored construction parts.
// Geometry originates from collisionStructure in collision-world.js; runtime
// walking and ragdoll both read this same engine-independent description.
import {collisionStructure,shapeFootprint,shapeHeight} from './collision-world.js';
function* shapes(structures){
 for(const item of structures??[])yield* collisionStructure(item);
}
export function forEachStructureBox(structures,terrain,x,z,visit){
 for(const structure of structures??[]){
  const group=structure.group;
  if(!group?.userData?.collisionBoxes?.length)continue;
  const reach=group.userData.collisionRadius??3;
  if(Math.abs(x-structure.x)>reach||Math.abs(z-structure.z)>reach)continue;
  const yaw=(structure.orientation??0)*Math.PI/2;
  const dx=x-structure.x,dz=z-structure.z;
  const lx=Math.cos(yaw)*dx-Math.sin(yaw)*dz;
  const lz=Math.sin(yaw)*dx+Math.cos(yaw)*dz;
  for(const b of group.userData.collisionBoxes)visit(b,lx,lz,group.position.y);
 }
}
export function structureBlocksPlayer(structures,terrain,x,z,feet,radius,height){
 for(const s of shapes(structures)){
  if(!shapeFootprint(s,x,z,radius))continue;
  const {bottom,top}=shapeHeight(s);
  if(feet<top-.045&&feet+height>bottom+.045)return true;
 }
 return false;
}
export function highestStructureSupport(structures,terrain,x,z,previous,next,radius,baseline=-Infinity){
 let support=baseline;
 for(const s of shapes(structures)){
  if(!shapeFootprint(s,x,z,radius*.25))continue;
  const {top}=shapeHeight(s);
  if(previous>=top-.09&&next<=top+.02&&top>support)support=top;
 }
 return support;
}
export function standingOnStructure(structures,terrain,x,z,feet,radius){
 for(const s of shapes(structures))
  if(shapeFootprint(s,x,z,radius*.25)&&Math.abs(shapeHeight(s).top-feet)<.08)return true;
 return false;
}
export function structureCeiling(structures,terrain,x,z,previous,next,radius,height){
 let ceiling=Infinity;
 for(const s of shapes(structures)){
  if(!shapeFootprint(s,x,z,radius*.85))continue;
  const {bottom}=shapeHeight(s);
  if(previous+height<=bottom+.01&&next+height>bottom)
   ceiling=Math.min(ceiling,bottom-height-.012);
 }
 return ceiling;
}
