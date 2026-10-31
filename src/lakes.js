// Very rare, large deterministic lakes. Geometry/height rules mirrored by lakes.py.
// Cell size 512m; random lakes average around one per several square kilometres.
import {baseTerrainHeight} from './terrain-noise.js';

export const LAKE_CELL=512;
export const LAKE_MAX_REACH=260;
const clamp=t=>Math.max(0,Math.min(1,t));
const smooth=t=>t*t*(3-2*t);
const cache=new Map();
let cacheSeed=null;

function hash(seed,gx,gz,channel){
  let n=(seed|0)^Math.imul(gx,0x1b873593)^
    Math.imul(gz,0x85ebca6b)^Math.imul(channel+1,0xc2b2ae35);
  n=Math.imul(n^(n>>>16),0x7feb352d);
  n=Math.imul(n^(n>>>15),0x846ca68b);
  return ((n^(n>>>16))>>>0)/4294967296;
}
function hasLake(seed,gx,gz){
  // One accessible showcase lake. Others are much rarer.
  if(gx===0&&gz===-1)return true;
  if(Math.hypot((gx+.5)*LAKE_CELL,(gz+.5)*LAKE_CELL)<540)return false;
  const priority=hash(seed,gx,gz,83);
  if(priority>.035)return false;
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
    if(!dx&&!dz)continue;
    if(hash(seed,gx+dx,gz+dz,83)<priority)return false;
  }
  return true;
}
export function lakePoint(site,u,angle){
  const boundary=1+.085*Math.sin(3*angle+site.phase)
    +.06*Math.sin(7*angle-site.phase*.65)
    +.035*Math.sin(11*angle+site.phase*.4);
  const dx=Math.cos(angle)*site.rx*u*boundary;
  const dz=Math.sin(angle)*site.rz*u*boundary;
  return [site.x+dx*site.cos-dz*site.sin,
    site.z+dx*site.sin+dz*site.cos];
}
export function lakeAt(seed,gx,gz){
  if(cacheSeed!==seed){cache.clear();cacheSeed=seed;}
  const key=gx+','+gz;
  if(cache.has(key))return cache.get(key);
  let lake=null;
  if(hasLake(seed,gx,gz)){
    const radius=100+hash(seed,gx,gz,21)*40;
    const angle=hash(seed,gx,gz,22)*Math.PI*2;
    lake={
      kind:'lake',id:'lake:'+key,gx,gz,
      x:(gx+.5)*LAKE_CELL+(hash(seed,gx,gz,24)-.5)*115,
      z:(gz+.5)*LAKE_CELL+(hash(seed,gx,gz,25)-.5)*115,
      rx:radius*(.89+hash(seed,gx,gz,26)*.20),
      rz:radius*(.72+hash(seed,gx,gz,27)*.26),
      cos:Math.cos(angle),sin:Math.sin(angle),
      phase:hash(seed,gx,gz,28)*Math.PI*2,
      depth:4.5+hash(seed,gx,gz,29)*1.5,
      reach:LAKE_MAX_REACH,
    };
    // Lake surface follows the lowest enclosing rim, not the center height.
    let rim=Infinity;
    for(let i=0;i<40;i++){
      const [x,z]=lakePoint(lake,1.09,i*Math.PI/20);
      rim=Math.min(rim,baseTerrainHeight(seed,x,z));
    }
    lake.level=rim-.35;
  }
  if(cache.size>=512)cache.clear();
  cache.set(key,lake);
  return lake;
}
export function lakesNearTile(seed,x0,z0,size){
  const result=[];
  for(let gx=Math.floor((x0-LAKE_MAX_REACH)/LAKE_CELL);
      gx<=Math.floor((x0+size+LAKE_MAX_REACH)/LAKE_CELL);gx++){
    for(let gz=Math.floor((z0-LAKE_MAX_REACH)/LAKE_CELL);
        gz<=Math.floor((z0+size+LAKE_MAX_REACH)/LAKE_CELL);gz++){
      const lake=lakeAt(seed,gx,gz);
      if(!lake||lake.x+lake.reach<x0||lake.x-lake.reach>x0+size||
          lake.z+lake.reach<z0||lake.z-lake.reach>z0+size)continue;
      result.push(lake);
    }
  }
  return result;
}
// Conservative horizon distance for a lake viewed from (x,z).
// The ellipse axes are already available; irregular coastline can extend
// roughly 18% beyond them. The margin includes the outer forest belt.
export function lakeHorizonDistance(lake,x,z,margin=54){
  const centerDistance=Math.hypot(x-lake.x,z-lake.z);
  const farShore=Math.max(lake.rx,lake.rz)*1.18;
  return centerDistance+farShore+margin;
}

export function lakeNormalized(lake,x,z){
  const dx=x-lake.x,dz=z-lake.z;
  if(Math.abs(dx)>lake.reach||Math.abs(dz)>lake.reach)return null;
  const rx=(dx*lake.cos+dz*lake.sin)/lake.rx;
  const rz=(-dx*lake.sin+dz*lake.cos)/lake.rz;
  const d=Math.hypot(rx,rz);
  if(d>1.28)return null;
  const angle=Math.atan2(rz,rx);
  const boundary=1+.085*Math.sin(3*angle+lake.phase)
    +.06*Math.sin(7*angle-lake.phase*.65)
    +.035*Math.sin(11*angle+lake.phase*.4);
  return d/boundary;
}
export function lakeHeightAt(seed,x,z,base){
  let height=base;
  for(const lake of lakesNearTile(seed,x,z,0)){
    const u=lakeNormalized(lake,x,z);
    if(u===null||u>=.995)continue;
    const t=clamp((u-.30)/(.995-.30));
    const blend=1-smooth(t);
    const basin=lake.level-lake.depth*(1-.08*clamp(u/.38)**2);
    height=Math.min(height,base+(basin-base)*blend);
  }
  return height;
}
