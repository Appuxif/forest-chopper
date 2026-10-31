// Transient, non-seeded resource zones. Each 10m square generates only once
// while active; moving outside the neighbouring 3x3 zone grid forgets it.
// No re-spawn while standing still (even after collecting every item).
export const RESOURCE_ZONE_SIZE=10;
export const RESOURCE_RADIUS=10;
export const RESOURCE_LIMIT=10;
export const RESOURCE_PER_ZONE=2;
export const RESOURCE_UPDATE_MS=3000;
export const RESOURCE_VIEW_DOT=-0.25; // spawn only distinctly behind the player

export function zoneCoords(x,z){
  return [Math.floor(x/RESOURCE_ZONE_SIZE),Math.floor(z/RESOURCE_ZONE_SIZE)];
}
export function behindPlayer(x,z,yaw,pointX,pointZ){
  const dx=pointX-x,dz=pointZ-z,distance=Math.hypot(dx,dz);
  if(distance<1e-6)return false;
  // Player forward in Three.js world space: (-sin(yaw),-cos(yaw)).
  return (dx*-Math.sin(yaw)+dz*-Math.cos(yaw))/distance<=RESOURCE_VIEW_DOT;
}

export function createResourceZones({random=Math.random}={}){
  let resources=new Map(),zones=new Map(),nextId=0,lastCell=null;
  function update({x,z,yaw=0}){
    const [cx,cz]=zoneCoords(x,z);
    const currentCell=cx+','+cz;
    const enteredNewCell=currentCell!==lastCell;
    lastCell=currentCell;
    let changed=false;
    // Keep the current square and its 8 neighbours. Leaving them starts a
    // fresh visit, but never restores previously collected items by seed.
    for(const key of zones.keys()){
      const [zx,zz]=key.split(',').map(Number);
      if(Math.abs(zx-cx)>1||Math.abs(zz-cz)>1){
        zones.delete(key);changed=true;
      }
    }
    for(const [id,r] of resources){
      if(!zones.has(r.zone)||Math.hypot(r.x-x,r.z-z)>RESOURCE_RADIUS){
        resources.delete(id);changed=true;
      }
    }
    // Do not refill a partly collected patch while the player stands still.
    // Entering a new square may activate new adjacent zones.
    if(!enteredNewCell && resources.size>=2)return changed;
    // Visit current zone first, then nearest neighbours. Maximum of 10 live
    // instances total, regardless of how many zones are nearby.
    const cells=[];
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
      const zx=cx+dx,zz=cz+dz;
      const centerX=(zx+.5)*RESOURCE_ZONE_SIZE,centerZ=(zz+.5)*RESOURCE_ZONE_SIZE;
      cells.push({zx,zz,key:zx+','+zz,dist:Math.hypot(centerX-x,centerZ-z)});
    }
    cells.sort((a,b)=>a.dist-b.dist);
    for(const cell of cells){
      if(zones.has(cell.key))continue;
      if(resources.size>=RESOURCE_LIMIT)break; // Leave untouched zones pending.
      // Pick candidate points INSIDE this zone, and only in the rear sector.
      // No eligible points => try again after the player turns (not a visit).
      const points=[];
      for(let i=0;i<32&&points.length<RESOURCE_PER_ZONE;i++){
        const px=(cell.zx+random())*RESOURCE_ZONE_SIZE;
        const pz=(cell.zz+random())*RESOURCE_ZONE_SIZE;
        const dist=Math.hypot(px-x,pz-z);
        if(dist<3||dist>RESOURCE_RADIUS||!behindPlayer(x,z,yaw,px,pz))continue;
        if(points.some(p=>Math.hypot(px-p.x,pz-p.z)<.9)
           || [...resources.values()].some(p=>Math.hypot(px-p.x,pz-p.z)<.9))continue;
        points.push({x:px,z:pz});
      }
      if(!points.length)continue;
      zones.set(cell.key,true);
      for(const point of points){
        if(resources.size>=RESOURCE_LIMIT)break;
        const id=++nextId;
        resources.set(id,{id,kind:random()<.52?'branch':'stone',...point,zone:cell.key});
      }
      changed=true;
    }
    return changed;
  }
  function collect(id){return resources.delete(id);}
  function clear(){resources.clear();zones.clear();lastCell=null;}
  return {update,collect,clear,get nodes(){return [...resources.values()]},
    get zones(){return [...zones.keys()]},get count(){return resources.size}};
}
