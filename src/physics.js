import {createCollisionWorld} from './collision-world.js';
import {createKinematicCollisionAdapter} from './collision-kinematic.js';
// Motion remains kinematic; geometry is shared with the Rapier adapter.
export function createPhysics(ctx){
const collisions=createKinematicCollisionAdapter(ctx.collisionWorld??createCollisionWorld(ctx),ctx);
const {logFootprint,logTop,logBottom}=collisions;
function blocksPlayerAt(x,z,feet,{includeTrees=false}={}){return collisions.blocked(x,z,feet,{includeTrees});}
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
   return !collisions.blocked(nx,nz,Math.max(ctx.feetY,floor),{includeTrees:true});
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
 const impactSpeed=ctx.verticalSpeed;
 let next=ctx.feetY+ctx.verticalSpeed*dt;
 const ground=ctx.terrain.heightAt(ctx.px,ctx.pz);
 if(ctx.verticalSpeed>0){
   const ceiling=collisions.ceiling(ctx.px,ctx.pz,previous,next);
   if(next>ceiling){next=ceiling;ctx.verticalSpeed=0;}
 }
 if(ctx.verticalSpeed<=0){
   const support=Math.max(ground,collisions.support(ctx.px,ctx.pz,previous,next));
   if(next<=support){next=support;ctx.verticalSpeed=0;ctx.onGround=true;}
   else ctx.onGround=false;
 }
 ctx.feetY=next;
 // A sloped terrain surface is support just like a log or a boulder.
 if(ctx.onGround&&ctx.feetY>ground+.02 &&
   !collisions.standingOn(ctx.px,ctx.pz,ctx.feetY))ctx.onGround=false;
 ctx.fallTracker?.observe(previous,ctx.feetY,ctx.onGround,impactSpeed);
}
// Highest reachable solid surface *beneath the ragdoll pelvis* for standing
// back up. Use the same log/rock/building footprints as walking physics.
function ragdollStandingSupport(x,z,hipsY){
 return collisions.standingSupport(x,z,hipsY);
}
function requestJump(){
  if(!ctx.onGround||ctx.jumpRequested)return;
  if(ctx.vitals&&!ctx.vitals.jump())return;
  if(ctx.isOnline?.())ctx.sendNet?.({type:'jump'});
  ctx.jumpRequested=true;
  ctx.audio?.jump?.();
}

return {logFootprint, logTop, logBottom, blocksPlayerAt, moveHorizontal,
 simulateVertical, ragdollStandingSupport, requestJump};
}
