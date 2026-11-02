// Compatibility helpers for callers outside createPhysics. Shape geometry is
// owned by Collision World and shared with the kinematic and Rapier adapters.
import {collisionRock,shapeFootprint,shapeHeight} from './collision-world.js';
export function rockFootprint(rock,x,z,margin=0){
 return shapeFootprint(collisionRock(rock),x,z,margin);
}
export function nearbyRocks(chunks,chunkSize,x,z,visit){
 if(!chunks||!Number.isFinite(chunkSize)||chunkSize<=0)return;
 const cx=Math.floor(x/chunkSize),cz=Math.floor(z/chunkSize);
 for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
  const rocks=chunks.get((cx+dx)+','+(cz+dz));
  if(!rocks)continue;
  for(const rock of rocks)visit(rock);
 }
}
export function rockBlocksPlayer(rocks,chunkSize,x,z,feet,radius,height){
 let blocked=false;
 nearbyRocks(rocks,chunkSize,x,z,rock=>{
  const shape=collisionRock(rock),{bottom,top}=shapeHeight(shape);
  if(shapeFootprint(shape,x,z,radius)&&feet<top-.045&&feet+height>bottom+.045)blocked=true;
 });
 return blocked;
}
export function highestRockSupport(rocks,chunkSize,x,z,previous,next,radius,baseline=0){
 let highest=baseline;
 nearbyRocks(rocks,chunkSize,x,z,rock=>{
  const shape=collisionRock(rock),{top}=shapeHeight(shape);
  if(shapeFootprint(shape,x,z,radius*.25)&&previous>=top-.09&&
    next<=top+.02&&top>highest)highest=top;
 });
 return highest;
}
export function standingOnRock(rocks,chunkSize,x,z,feet,radius){
 let supported=false;
 nearbyRocks(rocks,chunkSize,x,z,rock=>{
  const shape=collisionRock(rock);
  if(shapeFootprint(shape,x,z,radius*.25)&&
    Math.abs(shapeHeight(shape).top-feet)<.08)supported=true;
 });
 return supported;
}
