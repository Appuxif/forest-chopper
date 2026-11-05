// Reactive steering only: a few collision probes, no path grid or route search.
export function steerMob(mob,{dt,speed,yaw,safePoint,random}){
 mob.avoidTime=Math.max(0,(mob.avoidTime??0)-dt);
 mob.avoidRetry=Math.max(0,(mob.avoidRetry??0)-dt);
 if(!(speed>0)||!(dt>0)){if(!speed){mob.avoidTime=0;mob.avoidRetry=0;}return null;}
 const travel=speed*Math.min(dt,.25);
 function corridor(angle,distance){
  const steps=Math.max(1,Math.ceil(distance/.2));let y=null;
  for(let i=1;i<=steps;i++){
   y=safePoint(mob.x+Math.sin(angle)*distance*i/steps,mob.z+Math.cos(angle)*distance*i/steps);
   if(y===null)return null;
  }
  return y;
 }
 let angle=mob.avoidTime>0?mob.avoidYaw:yaw,turned=false;
 let y=corridor(angle,travel);
 if(y===null){
  mob.avoidTime=0;if(mob.avoidRetry>0)return null;
  const side=random()<.5?-1:1;
  const offsets=[side*Math.PI/4,-side*Math.PI/4,side*Math.PI/2,-side*Math.PI/2,side*3*Math.PI/4,-side*3*Math.PI/4,Math.PI];
  for(const offset of offsets){
   const candidate=yaw+offset;
   if(corridor(candidate,Math.max(.8,travel))===null)continue;
   angle=candidate;y=corridor(angle,travel);turned=true;
   mob.avoidYaw=angle;mob.avoidTime=.6+random()*.4;break;
  }
  if(y===null){mob.avoidRetry=.3;return null;}
 }
 return {x:mob.x+Math.sin(angle)*travel,z:mob.z+Math.cos(angle)*travel,y,yaw:angle,turned};
}
