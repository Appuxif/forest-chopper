import {nearbyDecorResources,isDecorResourceId} from './collectible-decor.js';
// Deterministic loot generated around the player; existing decor meshes are collectible.
// Only collected IDs and respawn deadlines require persistence.
export const RESOURCE_ZONE_SIZE=10;
export const RESOURCE_PER_ZONE=2;
export const RESOURCE_LIMIT=9*RESOURCE_PER_ZONE;
export const RESOURCE_UPDATE_MS=1000;
export const RESOURCE_RESPAWN_SECONDS=600;

export function zoneCoords(x,z){
  return [Math.floor(x/RESOURCE_ZONE_SIZE),Math.floor(z/RESOURCE_ZONE_SIZE)];
}
export function resourceHash(seed,zx,zz,index,channel){
  let h=(seed>>>0)^Math.imul(zx,0x9e3779b1)^Math.imul(zz,0x85ebca77)
    ^Math.imul(index+1,0xc2b2ae3d)^Math.imul(channel+1,0x27d4eb2f);
  h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;
  h=Math.imul(h,0x846ca68b);h^=h>>>16;
  return (h>>>0)/4294967296;
}
export function zoneResources(seed,zx,zz){
  const result=[];
  for(let i=0;i<RESOURCE_PER_ZONE;i++){
    const u=resourceHash(seed,zx,zz,i,0),v=resourceHash(seed,zx,zz,i,1);
    result.push({
      id:String(zx)+','+String(zz)+':'+String(i),
      kind:resourceHash(seed,zx,zz,i,2)<.52?'branch':'stone',
      x:Math.round((zx+.14+u*.72)*RESOURCE_ZONE_SIZE*100)/100,
      z:Math.round((zz+.14+v*.72)*RESOURCE_ZONE_SIZE*100)/100,
    });
  }
  return result;
}
export function nearbyResources(seed,x,z,cooldowns={},now=Date.now()/1000){
  const [cx,cz]=zoneCoords(x,z),result=[];
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
    for(const resource of zoneResources(seed,cx+dx,cz+dz)){
      if((cooldowns[resource.id]??0)<=now)result.push(resource);
    }
  }
  result.push(...nearbyDecorResources(seed,x,z,cooldowns,now));
  return result;
}
export function createResourceZones({seed=0,now=()=>Date.now()/1000}={}){
  let worldSeed=seed,resources=[],cooldowns={};
  function update({x,z,seed:nextSeed=worldSeed}){
    worldSeed=nextSeed;
    const time=now();
    for(const [id,expires] of Object.entries(cooldowns))if(expires<=time)delete cooldowns[id];
    const next=nearbyResources(worldSeed,x,z,cooldowns,time);
    const changed=next.length!==resources.length||next.some((r,i)=>r.id!==resources[i]?.id);
    if(changed)resources=next;
    return changed;
  }
  function collect(id){
    if(!resources.some(r=>r.id===id))return false;
    cooldowns[id]=now()+RESOURCE_RESPAWN_SECONDS;
    resources=resources.filter(r=>r.id!==id);
    return true;
  }
  function restore(data){
    if(!data||typeof data!=='object'||Array.isArray(data))return false;
    const fresh={};
    for(const [id,expires] of Object.entries(data)){
      if(!(/^-?\d+,-?\d+:[01]$/.test(id)||isDecorResourceId(id))||!Number.isFinite(expires)
         ||expires>now()+RESOURCE_RESPAWN_SECONDS)return false;
      if(expires>now())fresh[id]=expires;
    }
    cooldowns=fresh;resources=[];return true;
  }
  function isCollected(id){return (cooldowns[id]??0)>now();}
  function clear({keepCooldowns=false}={}){
    resources=[];
    if(!keepCooldowns)cooldowns={};
  }
  return {update,collect,isCollected,restore,clear,get nodes(){return resources.map(x=>({...x}))},
    get cooldowns(){return {...cooldowns}},get count(){return resources.length}};
}
