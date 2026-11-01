import {logHalfExtents} from './log-grid.js';
// Extracted from the original single-file game. Shared game state is passed explicitly.
import {rockBlocksPlayer,highestRockSupport,standingOnRock} from './rock-collisions.js';
import {structureBlocksPlayer,highestStructureSupport,standingOnStructure,structureCeiling} from './structure-collisions.js';
export function createPhysics(ctx) {
function* allStructures(){
 yield* ctx.crafting?.items?.values()??[];
 yield* ctx.campStructures?.items?.values()??[];
}
function logFootprint(p,x,z,extra=0){
 const along=p.orientation===0?x-p.x:z-p.z;
 const across=p.orientation===0?z-p.z:x-p.x;
 if(p.orientation===2)return Math.hypot(x-p.x,z-p.z)<ctx.logRadius+extra;
 const half=logHalfExtents(p,ctx.logRadius)[p.orientation===0?'x':'z'];
 const dx=Math.max(0,Math.abs(along)-half);
 return Math.hypot(dx,across)<ctx.logRadius+extra;
}
function logTop(p){return p.y+logHalfExtents(p,ctx.logRadius).y}
function logBottom(p){return p.y-logHalfExtents(p,ctx.logRadius).y}
function blocksPlayerAt(x,z,feet){
 for(const p of ctx.placed){
   if(!logFootprint(p,x,z,ctx.PLAYER_RADIUS))continue;
   if(feet<logTop(p)-.045 && feet+ctx.PLAYER_HEIGHT>logBottom(p)+.045)return true;
 }
 return structureBlocksPlayer(allStructures(),ctx.terrain,x,z,feet,
   ctx.PLAYER_RADIUS,ctx.PLAYER_HEIGHT) ||
   rockBlocksPlayer(ctx.rockColliders,ctx.chunkSize,x,z,feet,
     ctx.PLAYER_RADIUS,ctx.PLAYER_HEIGHT);
}
function moveHorizontal(dx,dz){
 // Axis-by-axis movement, with a small step-up allowance for terrain slopes.
 const oldGround=ctx.terrain.heightAt(ctx.px,ctx.pz);
 const walkingOnGround=ctx.onGround&&Math.abs(ctx.feetY-oldGround)<.12;
 function safe(nx,nz){
   const floor=ctx.terrain.heightAt(nx,nz);
   // No swimming yet: shallow edges are walkable, deep pond water is not.
   const water=ctx.terrain.waterDepthAt(nx,nz);
   if(water>.8&&water>=ctx.terrain.waterDepthAt(ctx.px,ctx.pz)-.01)return false;
   if(walkingOnGround && floor>ctx.feetY+.45)return false;
   for(const t of ctx.trees.values())if(Math.hypot(nx-t.position.x,nz-t.position.z)<.75)return false;
   return !blocksPlayerAt(nx,nz,Math.max(ctx.feetY,floor));
 }
 // Substep movement to avoid tunnelling through thin walls/armrests when
 // sprinting or when a frame takes longer than usual.
 const steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dz))/
   Math.max(.12,ctx.PLAYER_RADIUS*.5)));
 const startX=ctx.px,startZ=ctx.pz;
 let blockedX=false,blockedZ=false;
 for(let i=1;i<=steps;i++){
   if(!blockedX){
     const nx=startX+dx*(i/steps);
     if(safe(nx,ctx.pz))ctx.px=nx;else blockedX=true;
   }
   if(!blockedZ){
     const nz=startZ+dz*(i/steps);
     if(safe(ctx.px,nz))ctx.pz=nz;else blockedZ=true;
   }
 }
 if(walkingOnGround){
   const floor=ctx.terrain.heightAt(ctx.px,ctx.pz);
   if(Math.abs(floor-oldGround)<=.45){ctx.feetY=floor;ctx.verticalSpeed=0;}
   else if(floor>ctx.feetY){ctx.feetY=floor;ctx.verticalSpeed=0;}
 }
}
function simulateVertical(dt){
 if(ctx.jumpRequested&&ctx.onGround){ctx.verticalSpeed=ctx.JUMP_SPEED;ctx.onGround=false;}
 ctx.jumpRequested=false;
 const previous=ctx.feetY;
 if(!ctx.onGround)ctx.verticalSpeed-=ctx.GRAVITY*dt;
 let next=ctx.feetY+ctx.verticalSpeed*dt;
 const ground=ctx.terrain.heightAt(ctx.px,ctx.pz);
 if(ctx.verticalSpeed>0){
   // Do not phase upward through a log: check collision with the player's head.
   for(const p of ctx.placed){if(!logFootprint(p,ctx.px,ctx.pz,ctx.PLAYER_RADIUS))continue;
     const bottom=logBottom(p);
     if(previous+ctx.PLAYER_HEIGHT<=bottom+.01&&next+ctx.PLAYER_HEIGHT>bottom){next=Math.min(next,bottom-ctx.PLAYER_HEIGHT-.012);ctx.verticalSpeed=0;break}
   }
   const ceiling=structureCeiling(allStructures(),ctx.terrain,
     ctx.px,ctx.pz,previous,next,ctx.PLAYER_RADIUS,ctx.PLAYER_HEIGHT);
   if(next>ceiling){next=ceiling;ctx.verticalSpeed=0;}
 }
 if(ctx.verticalSpeed<=0){
   let support=ground;
   for(const p of ctx.placed){if(!logFootprint(p,ctx.px,ctx.pz,ctx.PLAYER_RADIUS*.65))continue;
     const top=logTop(p);
     if(previous>=top-.09&&next<=top+.02&&top>support)support=top;
   }
   support=Math.max(support,highestRockSupport(ctx.rockColliders,ctx.chunkSize,
     ctx.px,ctx.pz,previous,next,ctx.PLAYER_RADIUS,-Infinity),
     highestStructureSupport(allStructures(),ctx.terrain,
       ctx.px,ctx.pz,previous,next,ctx.PLAYER_RADIUS,-Infinity));
   if(next<=support){next=support;ctx.verticalSpeed=0;ctx.onGround=true}
   else ctx.onGround=false;
 }
 ctx.feetY=next;
 // A sloped terrain surface is support just like a log or a boulder.
 if(ctx.onGround&&ctx.feetY>ground+.02){
   const hasSupport=ctx.placed.some(p=>logFootprint(p,ctx.px,ctx.pz,ctx.PLAYER_RADIUS*.65)&&Math.abs(logTop(p)-ctx.feetY)<.08)
     || standingOnRock(ctx.rockColliders,ctx.chunkSize,ctx.px,ctx.pz,
       ctx.feetY,ctx.PLAYER_RADIUS)
     || standingOnStructure(allStructures(),ctx.terrain,
       ctx.px,ctx.pz,ctx.feetY,ctx.PLAYER_RADIUS);
   if(!hasSupport)ctx.onGround=false;
 }
}
function requestJump(){
  if(!ctx.onGround||ctx.jumpRequested)return;
  if(ctx.vitals&&!ctx.vitals.jump())return;
  if(ctx.isOnline?.())ctx.sendNet?.({type:'jump'});
  ctx.jumpRequested=true;
}

return {logFootprint, logTop, logBottom, blocksPlayerAt, moveHorizontal, simulateVertical, requestJump};
}
