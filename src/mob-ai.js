import {flockHeading} from './mob-flocking.js';
import {steerMob} from './mob-steering.js';
// Behavior implementations mutate only engine-neutral state. Geometry comes
// from canStand/safePoint; rendering and damage application are external.
export function createMobBehaviorRegistry(){
 const entries=new Map([['passive',(mob,env)=>tickBehavior(mob,env,false)],['wary',(mob,env)=>tickBehavior(mob,env,true)]]);
 return {register(id,update){if(entries.has(id)||typeof update!=='function')throw new Error('Invalid or duplicate mob behavior');entries.set(id,update);},get(id){const fn=entries.get(id);if(!fn)throw new Error('Unknown mob behavior: '+id);return fn;}};
}
function tickBehavior(mob,{dt,targets,definition,random,beginState,safePoint,flock},fearful){
 const a=definition.animations,b=definition.behavior,speeds=definition.stats.speeds;
 const nearby=targets.map(player=>({player,d2:(mob.x-player.x)**2+(mob.z-player.z)**2}));
 const nearest=nearby.reduce((best,item)=>item.d2<best.d2?item:best,{d2:Infinity,player:null});
 if(fearful&&nearest.d2<b.noticeRadius**2){mob.flockFollowing=false;mob.fleeClearTime=0;if(mob.state!==a.run)beginState(mob,a.run);}
 else if(fearful&&mob.state===a.run&&!mob.flockFollowing){
  mob.fleeClearTime=nearest.d2>b.safeRadius**2?mob.fleeClearTime+dt:0;
  if(mob.fleeClearTime>=b.calmSeconds)beginState(mob,a.fast);
 }
 if(!fearful||mob.state!==a.run){
  mob.actionTime-=dt;
  if(mob.actionTime<=0){
   if(a.forage.includes(mob.state))beginState(mob,random(mob)<.5?a.idle:a.walk);
   else{let roll=random(mob)*a.peaceful.reduce((n,p)=>n+p.weight,0);for(const entry of a.peaceful){roll-=entry.weight;if(roll<0){beginState(mob,entry.clip);break;}}}
  }
 }
 const fleeing=fearful&&mob.state===a.run&&!mob.flockFollowing;
 let groupMove=null;
 if(!fleeing){
  groupMove=flockHeading(mob,flock,{x:mob.targetX-mob.x,z:mob.targetZ-mob.z},b.flock);
  if(groupMove?.catchingUp){mob.flockFollowing=true;if(mob.state!==a.run)beginState(mob,a.run);}
  else if(mob.flockFollowing){mob.flockFollowing=false;beginState(mob,a.walk);}
  if(groupMove?.needsMove&&![a.walk,a.fast,a.run].includes(mob.state))beginState(mob,a.walk);
 }
 const speed=mob.state===a.run?speeds.run:mob.state===a.fast?speeds.fast:mob.state===a.walk?speeds.walk:0;
 mob.velocityX=mob.velocityZ=0;if(!speed){mob.avoidTime=0;mob.avoidRetry=0;return;}
 if(fleeing&&nearest.player){
  let x=mob.x-nearest.player.x,z=mob.z-nearest.player.z,length=Math.hypot(x,z);
  if(!length){x=Math.sin(mob.yaw);z=Math.cos(mob.yaw);length=1;}
  mob.targetX=mob.x+x/length*20;mob.targetZ=mob.z+z/length*20;
 }else if(!groupMove?.needsMove&&Math.hypot(mob.targetX-mob.x,mob.targetZ-mob.z)<.4){beginState(mob,a.idle);return;}
 const x=mob.targetX-mob.x,z=mob.targetZ-mob.z;
 const move=steerMob(mob,{dt,speed,yaw:groupMove?.yaw??Math.atan2(x,z),safePoint,random:()=>random(mob)});
 if(!move)return;
 mob.velocityX=(move.x-mob.x)/Math.max(dt,.0001);mob.velocityZ=(move.z-mob.z)/Math.max(dt,.0001);
 mob.x=move.x;mob.z=move.z;mob.y=move.y;mob.yaw=move.yaw;
 if(move.turned&&mob.state!==a.run){mob.targetX=mob.x+Math.sin(move.yaw)*8;mob.targetZ=mob.z+Math.cos(move.yaw)*8;}
}
