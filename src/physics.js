// Extracted from the original single-file game. Shared game state is passed explicitly.
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
 return false;
}
function moveHorizontal(dx,dz){
 // Axis-by-axis so walls allow sliding and diagonal movement does not stick.
 function safe(nx,nz){for(const t of ctx.trees.values())if(Math.hypot(nx-t.position.x,nz-t.position.z)<.75)return false;
 return !blocksPlayerAt(nx,nz,ctx.feetY)}
 if(safe(ctx.px+dx,ctx.pz))ctx.px+=dx;
 if(safe(ctx.px,ctx.pz+dz))ctx.pz+=dz;
}
function simulateVertical(dt){
 if(ctx.jumpRequested&&ctx.onGround){ctx.verticalSpeed=ctx.JUMP_SPEED;ctx.onGround=false;}
 ctx.jumpRequested=false;
 const previous=ctx.feetY;
 if(!ctx.onGround)ctx.verticalSpeed-=ctx.GRAVITY*dt;
 let next=Math.max(-3,ctx.feetY+ctx.verticalSpeed*dt);
 if(ctx.verticalSpeed>0){
   // Do not phase upward through a log: check collision with the player's head.
   for(const p of ctx.placed){if(!logFootprint(p,ctx.px,ctx.pz,ctx.PLAYER_RADIUS))continue;
     const bottom=logBottom(p);
     if(previous+ctx.PLAYER_HEIGHT<=bottom+.01&&next+ctx.PLAYER_HEIGHT>bottom){next=Math.min(next,bottom-ctx.PLAYER_HEIGHT-.012);ctx.verticalSpeed=0;break}
   }
 }
 if(ctx.verticalSpeed<=0){
   let support=0;
   for(const p of ctx.placed){if(!logFootprint(p,ctx.px,ctx.pz,ctx.PLAYER_RADIUS*.65))continue;
     const top=logTop(p);
     if(previous>=top-.09&&next<=top+.02&&top>support)support=top;
   }
   if(next<=support){next=support;ctx.verticalSpeed=0;ctx.onGround=true}
   else ctx.onGround=false;
 }
 ctx.feetY=Math.max(0,next);
 // Leave an edge naturally; grounded is true only while supported.
 if(ctx.onGround&&ctx.feetY>0){
   const hasSupport=ctx.placed.some(p=>logFootprint(p,ctx.px,ctx.pz,ctx.PLAYER_RADIUS*.65)&&Math.abs(logTop(p)-ctx.feetY)<.08);
   if(!hasSupport)ctx.onGround=false;
 }
}
function requestJump(){if(ctx.onGround)ctx.jumpRequested=true}

return {logFootprint, logTop, logBottom, blocksPlayerAt, moveHorizontal, simulateVertical, requestJump};
}
