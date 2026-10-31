// Deterministic pond shape, bank depression and water level.
// Mirrored in ponds.py for multiplayer/headless physics.
import {GLADE_CELL,gladeAt,gladesForTile} from './grass-glades.js';
import {baseTerrainHeight} from './terrain-noise.js';
import {lakesNearTile,lakeNormalized,lakeHeightAt} from './lakes.js';

const cache=new Map();
let cacheSeed=null;
const smooth=t=>t*t*(3-2*t);
const clamp=t=>Math.max(0,Math.min(1,t));

export function pondPoint(patch,u,angle){
  const edge=1+.075*Math.sin(3*angle+patch.phase)
    +.055*Math.sin(5*angle-patch.phase*.7);
  const vx=Math.cos(angle)*patch.rx*u*edge;
  const vz=Math.sin(angle)*patch.rz*u*edge;
  return [patch.x+vx*patch.cos-vz*patch.sin,
          patch.z+vx*patch.sin+vz*patch.cos];
}
function pondPatch(seed,gx,gz){
  if(cacheSeed!==seed){cache.clear();cacheSeed=seed;}
  const key=gx+','+gz;
  if(cache.has(key))return cache.get(key);
  // Fast candidate rejection: only build shape/level for pond cells.
  // gladeAt performs the final shoreline and trail/spawn eligibility check.
  const site=gladeAt(seed,gx,gz);
  let patch=null;
  if(site.kind===5 && !lakesNearTile(seed,site.x-26,site.z-26,52)
    .some(lake=>Math.hypot(site.x-lake.x,site.z-lake.z)<
      Math.max(lake.rx,lake.rz)*1.35+26)){
    let level=Infinity;
    // Put the water below the entire *uncarved* rim, even on a hillside.
    for(let i=0;i<16;i++){
      const [px,pz]=pondPoint(site,1.09,i*Math.PI/8);
      level=Math.min(level,baseTerrainHeight(seed,px,pz));
    }
    // Variation is deterministic and independent of surrounding chunks.
    const depth=1.5+Math.abs(Math.sin(seed*.871+gx*19.53+gz*33.17))*1.5;
    patch={...site,level:level-.28,depth};
  }
  if(cache.size>=512)cache.clear();
  cache.set(key,patch);
  return patch;
}
function shape(patch,x,z){
  const dx=x-patch.x,dz=z-patch.z;
  if(Math.abs(dx)>patch.reach||Math.abs(dz)>patch.reach)return null;
  const rx=(dx*patch.cos+dz*patch.sin)/patch.rx;
  const rz=(-dx*patch.sin+dz*patch.cos)/patch.rz;
  const d=Math.hypot(rx,rz);
  if(d>1.2)return null;
  const angle=Math.atan2(rz,rx);
  const boundary=1+.075*Math.sin(3*angle+patch.phase)
    +.055*Math.sin(5*angle-patch.phase*.7);
  return d/boundary;
}
function nearbyPonds(seed,x,z){
  const gx=Math.floor(x/GLADE_CELL),gz=Math.floor(z/GLADE_CELL);
  const result=[];
  for(let ix=gx-1;ix<=gx+1;ix++)for(let iz=gz-1;iz<=gz+1;iz++){
    const patch=pondPatch(seed,ix,iz);
    if(patch)result.push(patch);
  }
  result.push(...lakesNearTile(seed,x,z,0));
  return result;
}
export function pondHeightBeforeLakes(seed,x,z,base=baseTerrainHeight(seed,x,z)){
  let height=base;
  const gx=Math.floor(x/GLADE_CELL),gz=Math.floor(z/GLADE_CELL);
  for(let ix=gx-1;ix<=gx+1;ix++)for(let iz=gz-1;iz<=gz+1;iz++){
    const patch=pondPatch(seed,ix,iz);
    if(!patch)continue;
    const u=shape(patch,x,z);
    if(u===null||u>=.99)continue;
    const t=clamp((u-.27)/(.99-.27));
    const amount=1-smooth(t);
    const basin=patch.level-patch.depth*(1-.10*clamp(u/.35)**2);
    height=Math.min(height,base+(basin-base)*amount);
  }
  return height;
}
export function pondHeightAt(seed,x,z,base=baseTerrainHeight(seed,x,z)){
  return lakeHeightAt(seed,x,z,pondHeightBeforeLakes(seed,x,z,base));
}
export function pondDepthAt(seed,x,z){
  const height=pondHeightAt(seed,x,z);
  let depth=0;
  for(const patch of nearbyPonds(seed,x,z)){
    const u=patch.kind==='lake'?lakeNormalized(patch,x,z):shape(patch,x,z);
    if(u===null||u>=.995)continue;
    depth=Math.max(depth,patch.level-height);
  }
  return Math.max(0,depth);
}
// Coastal color is separate from height generation: it never modifies
// physics, seed positions, or the water surface.
export function pondSandAt(pond,x,z,groundY){
  const u=pond.kind==='lake'?lakeNormalized(pond,x,z):shape(pond,x,z);
  if(u===null||u>=1.18)return {sand:0,wet:0};
  // Sand covers the basin and a roughly 2–4m transition beyond the rim.
  const shore=1-smooth(clamp((u-.94)/(pond.kind==='lake'?.13:.24)));
  // Do not paint a high hillside sandy just because it is close in X/Z.
  const heightFade=1-smooth(clamp((groundY-pond.level-.25)/1.9));
  const sand=shore*heightFade;
  const wet=1-smooth(clamp((groundY-pond.level+.05)/.95));
  return {sand,wet};
}

export function pondsNearTile(seed,x0,z0,size){
  return [
    ...gladesForTile(seed,x0,z0,size)
      .filter(p=>p.kind===5)
      .map(p=>pondPatch(seed,p.gx,p.gz))
      .filter(Boolean),
    ...lakesNearTile(seed,x0,z0,size),
  ];
}
export function pondsForTile(seed,x0,z0,size){
  return pondsNearTile(seed,x0,z0,size)
    .filter(p=>p.x>=x0&&p.x<x0+size&&p.z>=z0&&p.z<z0+size);
}
