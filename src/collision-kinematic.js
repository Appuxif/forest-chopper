// The walking controller reads the same collision primitives as Rapier.
// This adapter keeps the existing axis sliding, step-up, headroom and
// landing rules; only the source of geometry has changed.
import {collisionLog,shapeFootprint,shapeHeight} from './collision-world.js';
export function createKinematicCollisionAdapter(world,ctx){
 const playerRadius=ctx.PLAYER_RADIUS??.31;
 const playerHeight=ctx.PLAYER_HEIGHT??1.7;
 const radiusFor=(s,margin)=>s.kind==='tree'?0:margin;
 function overlaps(s,x,z,margin){
  return shapeFootprint(s,x,z,radiusFor(s,margin));
 }
 function logFootprint(log,x,z,extra=0){
  return shapeFootprint(collisionLog(log,ctx.logRadius??.29),x,z,extra);
 }
 function logTop(log){return shapeHeight(collisionLog(log,ctx.logRadius??.29)).top;}
 function logBottom(log){return shapeHeight(collisionLog(log,ctx.logRadius??.29)).bottom;}
 function blocked(x,z,feet,{includeTrees=false}={}){
  let result=false;
  world.forEachNear(x,z,playerRadius+2,s=>{
   if(result)return;
   if(s.kind==='tree'){
    if(includeTrees&&overlaps(s,x,z,0))result=true;
    return;
   }
   if(!overlaps(s,x,z,playerRadius))return;
   const {top,bottom}=shapeHeight(s);
   if(feet<top-.045&&feet+playerHeight>bottom+.045)result=true;
  },{includeTrees});
  return result;
 }
 function support(x,z,previous,next,{baseline=-Infinity,ragdoll=false}={}){
  let result=baseline;
  world.forEachNear(x,z,playerRadius+2,s=>{
   if(s.kind==='tree'||s.kind==='mattress')return;
   const margin=s.kind==='log'?playerRadius*.65:playerRadius*.25;
   if(!overlaps(s,x,z,margin))return;
   const {top}=shapeHeight(s);
   const threshold=ragdoll&&s.kind==='log'?0:-.09;
   if(previous>=top+threshold && next<=top+.02 && top>result)result=top;
  },{includeTrees:false});
  return result;
 }
 function standingOn(x,z,feet){
  let result=false;
  world.forEachNear(x,z,playerRadius+2,s=>{
   if(result||s.kind==='tree'||s.kind==='mattress')return;
   const margin=s.kind==='log'?playerRadius*.65:playerRadius*.25;
   if(overlaps(s,x,z,margin)&&Math.abs(shapeHeight(s).top-feet)<.08)result=true;
  },{includeTrees:false});
  return result;
 }
 function ceiling(x,z,previous,next){
  let result=Infinity;
  world.forEachNear(x,z,playerRadius+2,s=>{
   if(s.kind!=='log'&&s.kind!=='structure')return;
   const margin=s.kind==='log'?playerRadius:playerRadius*.85;
   if(!overlaps(s,x,z,margin))return;
   const {bottom}=shapeHeight(s);
   if(previous+playerHeight<=bottom+.01&&next+playerHeight>bottom)
    result=Math.min(result,bottom-playerHeight-.012);
  },{includeTrees:false});
  return result;
 }
 function standingSupport(x,z,hipsY){
  const ground=world.terrainHeight(x,z);
  return Math.max(ground,support(x,z,hipsY+.15,-Infinity,
   {baseline:-Infinity,ragdoll:true}));
 }
 return {logFootprint,logTop,logBottom,blocked,support,standingOn,ceiling,standingSupport};
}
