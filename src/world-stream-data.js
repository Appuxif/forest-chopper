// Deterministic, THREE-free data builders; safe to run in a module Worker.
import {treeCanSpawn,treeCandidate,TREES_PER_CHUNK} from './tree-spacing.js';
import {terrainHeight} from './terrain.js';
import {pondDepthAt} from './ponds.js';
import {generateGrassTile} from './micro-grass.js';
import {bakeGrassAO} from './grass-baked-ao.js?v=20261106-classic-grass-only1';
import {GRASS_CLUSTER_DEFAULTS} from './grass-clustering.js';

export function forestChunkData({seed,cx,cz,size=24,density=100}){
  const rand=(x,z,n=0)=>{const v=Math.sin(x*127.1+z*311.7+n*78.233+seed)*43758.5453;return v-Math.floor(v);};
  // Keep exact seeded coordinates; Float32 rounding desynchronizes tree IDs.
  const data=new Float64Array(TREES_PER_CHUNK*7);
  let count=0;
  for(let i=0;i<TREES_PER_CHUNK;i++){
    if(!treeCanSpawn(cx,cz,i,rand,size))continue;
    if(rand(cx,cz,8000+i)*100>=density)continue;
    const pos=treeCandidate(cx,cz,i,rand,size);
    if(!pos||pondDepthAt(seed,pos.x,pos.z)>.12)continue;
    const {x,z}=pos;
    const off=count*7;
    data[off]=x;data[off+1]=terrainHeight(seed,x,z);data[off+2]=z;
    data[off+3]=7.5+rand(x,z,4)*6.5;
    data[off+4]=.9+rand(x,z,5)*.65;
    data[off+5]=rand(x,z,703)<.2?1:0;
    data[off+6]=i;
    count++;
  }
  return data.slice(0,count*7);
}
export function terrainGridData({seed,cx,cz,size=96,segments=48}){
  const stride=segments+3;
  const heights=new Float64Array(stride*stride);
  const step=size/segments;
  for(let row=-1;row<=segments+1;row++)
    for(let col=-1;col<=segments+1;col++)
      heights[(row+1)*stride+col+1]=terrainHeight(seed,cx*size+col*step,
        cz*size+row*step);
  return heights;
}
export function grassTileData({seed,tx,tz,size,density,tier,clusterConfig=null,ao=null}){
  clusterConfig??=GRASS_CLUSTER_DEFAULTS;
  const records=generateGrassTile(seed,tx,tz,size,density,tier,clusterConfig);
  // x,y,z,angle,scale,tint,biome,patchKind,patchWeight
  const floats=new Float32Array(records.length*9);
  for(let i=0;i<records.length;i++){
    const o=records[i],j=i*9;
    floats[j]=o.x;floats[j+1]=terrainHeight(seed,o.x,o.z);
    floats[j+2]=o.z;floats[j+3]=o.yaw??o.angle;floats[j+4]=o.height??o.scale;
    floats[j+5]=o.tint;floats[j+6]=o.biome;
    floats[j+7]=o.patchKind;floats[j+8]=o.patchWeight;
  }
  if(ao?.enabled&&tier==='near'){
    return {samples:floats,ao:{
      ...bakeGrassAO({samples:floats,tx,tz,size,
        resolution:ao.resolution,clusterConfig,sampling:ao.sampling}),
      configKey:ao.configKey,
    }};
  }
  return floats;
}
export function grassAOData({samples,tx,tz,size,clusterConfig=null,ao={}}){
  return bakeGrassAO({samples,tx,tz,size,resolution:ao.resolution,
    clusterConfig:clusterConfig??GRASS_CLUSTER_DEFAULTS,sampling:ao.sampling});
}
