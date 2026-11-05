// Snapshot the group once per tick, so update order cannot drag the centroid.
export function buildMobFlocks(records){
 const groups=new Map();
 for(const mob of records){
  if(mob.hp<=0)continue;
  const key=mob.flockId??(mob.transient?mob.id:`${mob.cx},${mob.cz}`);
  if(!groups.has(key))groups.set(key,{x:0,z:0,birthX:0,birthZ:0,members:[],anchored:true});
  const group=groups.get(key);group.x+=mob.x;group.z+=mob.z;group.members.push({id:mob.id,x:mob.x,z:mob.z});
  if(Number.isFinite(mob.spawnX)&&Number.isFinite(mob.spawnZ)){group.birthX+=mob.spawnX;group.birthZ+=mob.spawnZ;}
  else group.anchored=false;
 }
 for(const group of groups.values()){
  group.x/=group.members.length;group.z/=group.members.length;
  if(group.anchored){group.birthX/=group.members.length;group.birthZ/=group.members.length;group.x=(group.x+group.birthX)/2;group.z=(group.z+group.birthZ)/2;}
 }
 return groups;
}
export function flockHeading(mob,group,desired,settings){
 if(!settings||!group||(group.members.length<2&&!group.anchored))return null;
 const dx=group.x-mob.x,dz=group.z-mob.z,distance=Math.hypot(dx,dz);
 const catchingUp=distance>settings.catchUpRadius||(mob.flockFollowing===true&&distance>settings.radius);
 let x=desired.x,z=desired.z,length=Math.hypot(x,z)||1;x/=length;z/=length;
 const bias=catchingUp?1:Math.min(settings.cohesion,Math.max(0,(distance-settings.radius)/settings.radius)*settings.cohesion);
 if(distance>0&&bias>0){
  const angle=Math.atan2(dx,dz)+Math.sin((mob.randomState??0)*.01)*.25;
  x=x*(1-bias)+Math.sin(angle)*bias;z=z*(1-bias)+Math.cos(angle)*bias;
 }
 for(const neighbor of group.members){
  if(neighbor.id===mob.id)continue;
  const sx=mob.x-neighbor.x,sz=mob.z-neighbor.z,d=Math.hypot(sx,sz);
  if(d>0&&d<settings.separation){const weight=(1-d/settings.separation)*1.2;x+=sx/d*weight;z+=sz/d*weight;}
 }
 return {yaw:Math.atan2(x,z),distance,needsMove:distance>settings.radius,catchingUp};
}
