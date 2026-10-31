// Extracted from the original single-file game. Shared game state is passed explicitly.
import {rockBlocksPlayer,highestRockSupport,standingOnRock} from './rock-collisions.js';
export function createPhysics(ctx) {
function logFootprint(p,x,z,extra=0){
 // Logs lie horizontally along X (orientation 0) or Z (orientation 1).
 const along=p.orientation===0?x-p.x:z-p.z;
 const across=p.orientation===0?z-p.z:x-p.x;
 const half=ctx.logLength/2,dx=Math.max(0,Math.abs(along)-half);
 return Math.hypot(dx,across)<ctx.logRadius+extra;
}
function logTop(p){return p.y+ctx.logRadius}
function logBottom(p){return p.y-ctx.logRadius}
function blocksPlayerAt(x,z,feet){
 for(const p of ctx.placed){
   if(!logFootprint(p,x,z,ctx.PLAYER_RADIUS))continue;
   if(feet<logTop(p)-.045 && feet+ctx.PLAYER_HEIGHT>logBottom(p)+.045)return true;
 }
 return rockBlocksPlayer(ctx.rockColliders,ctx.chunkSize,x,z,feet,
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
 if(safe(ctx.px+dx,ctx.pz))ctx.px+=dx;
 if(safe(ctx.px,ctx.pz+dz))ctx.pz+=dz;
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
 }
 if(ctx.verticalSpeed<=0){
   let support=ground;
   for(const p of ctx.placed){if(!logFootprint(p,ctx.px,ctx.pz,ctx.PLAYER_RADIUS*.65))continue;
     const top=logTop(p);
     if(previous>=top-.09&&next<=top+.02&&top>support)support=top;
   }
   support=Math.max(support,highestRockSupport(ctx.rockColliders,ctx.chunkSize,
     ctx.px,ctx.pz,previous,next,ctx.PLAYER_RADIUS,-Infinity));
   if(next<=support){next=support;ctx.verticalSpeed=0;ctx.onGround=true}
   else ctx.onGround=false;
 }
 ctx.feetY=next;
 // A sloped terrain surface is support just like a log or a boulder.
 if(ctx.onGround&&ctx.feetY>ground+.02){
   const hasSupport=ctx.placed.some(p=>logFootprint(p,ctx.px,ctx.pz,ctx.PLAYER_RADIUS*.65)&&Math.abs(logTop(p)-ctx.feetY)<.08)
     || standingOnRock(ctx.rockColliders,ctx.chunkSize,ctx.px,ctx.pz,
       ctx.feetY,ctx.PLAYER_RADIUS);
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
