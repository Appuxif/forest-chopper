// Worker-fed distant forest. Each 96m sector owns instanced batches with
// independent frustum culling; camera turns never rewrite instance matrices.
import {lakesNearTile,lakeHorizonDistance} from './lakes.js';
import {forestChunkData} from './world-stream-data.js';
import {WorldLRU,WORLD_PRIORITY} from './world-task-scheduler.js';
export const DISTANT_FOREST_BASE_METERS=165;
export const DISTANT_FOREST_LAKE_METERS=410;
export const DISTANT_FOREST_SHORE_WIDTH=54;
export const DISTANT_FOREST_CHUNKS_PER_TICK=48;
export const DISTANT_SECTOR_CHUNKS=4;

export function distantForestRange(terrain,lakes=[],x=0,z=0,settings=null){
  const night=terrain?.nightBlend??0;
  const visibility=Math.max(terrain?.visibility??0,terrain?.visibilityTarget??0)*(1-night);
  const dayBase=settings?.farForestDistance??DISTANT_FOREST_BASE_METERS;
  const base=dayBase+(Math.min(dayBase,terrain?.nightViewDistance??30)-dayBase)*night;
  if(visibility<=.035||!lakes.length||settings?.lakeForestMode==='off')return base;
  if(settings?.lakeForestMode==='full')
    return Math.max(base,settings?.lakeViewDistance??DISTANT_FOREST_LAKE_METERS);
  return Math.min(settings?.lakeViewDistance??DISTANT_FOREST_LAKE_METERS,Math.max(base,
    ...lakes.map(lake=>lakeHorizonDistance(lake,x,z,DISTANT_FOREST_SHORE_WIDTH+12))));
}
export function distanceToLakeShore(lake,x,z){
  const dx=x-lake.x,dz=z-lake.z;
  const rx=(dx*lake.cos+dz*lake.sin)/lake.rx;
  const rz=(-dx*lake.sin+dz*lake.cos)/lake.rz;
  const angle=Math.atan2(rz,rx);
  const edge=1+.085*Math.sin(3*angle+lake.phase)
    +.06*Math.sin(7*angle-lake.phase*.65)
    +.035*Math.sin(11*angle+lake.phase*.4);
  return (Math.hypot(rx,rz)-edge)*Math.min(lake.rx,lake.rz);
}
export function createDistantForest(ctx){
  const THREE=ctx.THREE;
  if(!THREE.InstancedMesh||!THREE.Object3D)
    return {update(){},updateVisibility(){},invalidate(){},clear(){},
      dispose(){},get count(){return 0;}};
  const templates={
    conifer:ctx.distantTreeParts?.conifer??ctx.spruceParts??[],
    birch:ctx.distantTreeParts?.birch??ctx.birchParts??[],
  };
  const cache=new Map(); // active chunk -> packed Float64Array, stride 7
  const lru=new WorldLRU(24*1024*1024);
  const sectors=new Map(); // 4x4 tree chunks / 96m tile
  const dirtySectors=new Set();
  const requested=new Set();
  const dummy=new THREE.Object3D();
  const chunkKey=(cx,cz)=>cx+','+cz;
  const sectorKey=(cx,cz)=>Math.floor(cx/DISTANT_SECTOR_CHUNKS)+','+
    Math.floor(cz/DISTANT_SECTOR_CHUNKS);
  let desired=new Set(),queue=[],signature='',generation=0,lastSeed=null,previousX=null,previousZ=null;
  let count=0;

  function evictSector(key){
    const sector=sectors.get(key);
    if(!sector)return;
    for(const mesh of sector.meshes){
      ctx.scene.remove(mesh);
      mesh.dispose();
    }
    sectors.delete(key);
  }
  function rebuildSector(key){
    const [sx,sz]=key.split(',').map(Number);
    const trees={conifer:[],birch:[]};
    for(let cx=sx*DISTANT_SECTOR_CHUNKS;cx<(sx+1)*DISTANT_SECTOR_CHUNKS;cx++)
      for(let cz=sz*DISTANT_SECTOR_CHUNKS;cz<(sz+1)*DISTANT_SECTOR_CHUNKS;cz++){
        const records=cache.get(chunkKey(cx,cz));
        if(!records)continue;
        for(let i=0;i<records.length;i+=7){
          if(ctx.felled.has(chunkKey(cx,cz)+':'+records[i+6]))continue;
          const kind=records[i+5]===1?'birch':'conifer';
          trees[kind].push([records[i],records[i+1],records[i+2],
            records[i+3],records[i+4]]);
        }
      }
    const total=trees.conifer.length+trees.birch.length;
    if(!total){
      evictSector(key);
      count=0;
      for(const entry of sectors.values())count+=entry.total;
      return;
    }
    let sector=sectors.get(key);
    if(!sector){
      sector={meshes:[],byKind:{conifer:[],birch:[]},total:0};
      sectors.set(key,sector);
    }
    // Stable instance-buffer capacities: one sector has at most 16*8=128
    // candidates. Reuse GPU buffers when additional worker chunks arrive.
    for(const kind of ['conifer','birch']){
      const instances=trees[kind];
      if(instances.length&&!sector.byKind[kind].length)
        for(const part of templates[kind]){
          if(!part.geometry||!part.material)continue;
          const mesh=new THREE.InstancedMesh(part.geometry,part.material,
            DISTANT_SECTOR_CHUNKS*DISTANT_SECTOR_CHUNKS*8);
          mesh.name='Distant '+kind+' '+(part.foliage?'foliage':'wood')+' '+key;
          mesh.castShadow=false;mesh.receiveShadow=false;
          mesh.frustumCulled=true;
          ctx.scene.add(mesh);
          sector.meshes.push(mesh);
          sector.byKind[kind].push(mesh);
        }
      for(let i=0;i<instances.length;i++){
        const [x,y,z,height,scale]=instances[i];
        dummy.position.set(x,y,z);
        dummy.rotation.set(0,0,0);
        dummy.scale.set(scale,height/(kind==='conifer'?6:8),scale);
        dummy.updateMatrix();
        for(const mesh of sector.byKind[kind])mesh.setMatrixAt(i,dummy.matrix);
      }
      for(const mesh of sector.byKind[kind]){
        mesh.count=instances.length;
        mesh.instanceMatrix.needsUpdate=true;
        mesh.computeBoundingSphere?.();
      }
    }
    sector.total=total;
    count=0;for(const entry of sectors.values())count+=entry.total;
  }
  function flush(limit=2){
    for(const key of dirtySectors){
      dirtySectors.delete(key);
      rebuildSector(key);
      if(--limit<=0)break;
    }
  }
  function scheduleChunk(cx,cz,priority){
    const key=chunkKey(cx,cz);
    const dataKey=ctx.seed+'/'+(ctx.settings?.farTreeDensity??100)+'/'+ctx.chunkSize+'/'+key;
    const hit=lru.get(dataKey);
    if(hit){cache.set(key,hit);dirtySectors.add(sectorKey(cx,cz));return;}
    if(requested.has(key))return;
    requested.add(key);
    const epoch=generation,seed=ctx.seed;
    const payload={seed,cx,cz,size:ctx.chunkSize,
      density:ctx.settings?.farTreeDensity??100};
    const apply=records=>{
      requested.delete(key);
      if(epoch!==generation||seed!==ctx.seed||!desired.has(key))return;
      cache.set(key,records);
      lru.put(dataKey,records,records.byteLength);
      dirtySectors.add(sectorKey(cx,cz));
    };
    if(ctx.worldStreamer)
      ctx.worldStreamer.schedule({
        key:'forest:'+key,kind:'forest',payload,priority,apply,
        fallback:()=>forestChunkData(payload),
      });
    else apply(forestChunkData(payload));
  }
  function update(){
    const size=ctx.chunkSize,cx=Math.floor(ctx.px/size),
      cz=Math.floor(ctx.pz/size),near=ctx.radius??3;
    const visibility=Math.max(ctx.terrain?.visibility??0,ctx.terrain?.visibilityTarget??0)*(1-(ctx.terrain?.nightBlend??0));
    const lakeMode=visibility>.035&&ctx.settings?.lakeForestMode!=='off';
    const nearbyLakes=lakeMode
      ?lakesNearTile(ctx.seed,ctx.px-500,ctx.pz-500,1000)
        .filter(lake=>distanceToLakeShore(lake,ctx.px,ctx.pz)<145):[];
    const outerRadius=distantForestRange(ctx.terrain,nearbyLakes,ctx.px,ctx.pz,ctx.settings);
    const range=Math.ceil(outerRadius/size);
    const density=ctx.settings?.farTreeDensity??100;
    const sign=[ctx.seed,cx,cz,near,range,density,
      ctx.settings?.lakeForestMode,nearbyLakes.map(l=>l.id).join('|')].join('/');
    if(sign===signature){
      // Keep feeding work on every world tick; the queue contains all desired
      // chunks and must not be considered permanently finished after 48.
      enqueueMissing(12);
      flush();
      return;
    }
    const reset=ctx.seed!==lastSeed||signature.split('/')[5]!==String(density);
    if(reset){
      lru.clear();cache.clear();generation++;dirtySectors.clear();
      for(const key of requested)ctx.worldStreamer?.cancel('forest:'+key);
      requested.clear();
      for(const key of [...sectors.keys()])evictSector(key);
      count=0;
    }
    signature=sign;lastSeed=ctx.seed;
    const activeBase=distantForestRange(ctx.terrain,[],ctx.px,ctx.pz,ctx.settings);
    const next=new Set(),baseSq=(activeBase+size*.72)**2;
    const outerSq=(outerRadius+size*.72)**2;
    const chunkMargin=size*Math.SQRT2*.5;
    const vx=previousX===null?0:ctx.px-previousX;
    const vz=previousZ===null?0:ctx.pz-previousZ;
    previousX=ctx.px;previousZ=ctx.pz;
    const norm=Math.hypot(vx,vz)||1;
    for(let x=cx-range;x<=cx+range;x++)
      for(let z=cz-range;z<=cz+range;z++){
        if(Math.abs(x-cx)<=near&&Math.abs(z-cz)<=near)continue;
        if(ctx.chunks?.has(chunkKey(x,z)))continue;
        const wx=(x+.5)*size,wz=(z+.5)*size,
          dx=wx-ctx.px,dz=wz-ctx.pz,d2=dx*dx+dz*dz;
        const onLake=lakeMode&&nearbyLakes.length>0&&d2<=outerSq&&
          (ctx.settings?.lakeForestMode==='full'||nearbyLakes.some(lake=>{
            const distance=distanceToLakeShore(lake,wx,wz);
            return distance>=-chunkMargin&&
              distance<=DISTANT_FOREST_SHORE_WIDTH+chunkMargin;
          }));
        if(d2>baseSq&&!onLake)continue;
        next.add(chunkKey(x,z));
      }
    for(const [key,records] of cache){
      if(next.has(key))continue;
      const [x,z]=key.split(',').map(Number);
      cache.delete(key);dirtySectors.add(sectorKey(x,z));
    }
    for(const key of requested)
      if(!next.has(key)){ctx.worldStreamer?.cancel('forest:'+key);requested.delete(key);}
    desired=next;
    queue=[...next].filter(key=>!cache.has(key)&&!requested.has(key)).map(key=>{
      const [x,z]=key.split(',').map(Number);
      const dx=(x+.5-cx),dz=(z+.5-cz);
      const forward=(dx*vx+dz*vz)/norm;
      return {x,z,d:dx*dx+dz*dz-4*Math.max(0,forward)};
    }).sort((a,b)=>a.d-b.d);
    enqueueMissing(24);
    flush();
  }
  function enqueueMissing(budget){
    if(!queue.length)return;
    let started=0;
    for(const job of queue){
      const key=chunkKey(job.x,job.z);
      if(cache.has(key)||requested.has(key))continue;
      if(requested.size>=60)break;
      scheduleChunk(job.x,job.z,
        job.d<100?WORLD_PRIORITY.visible:WORLD_PRIORITY.prefetch);
      if(++started>=budget)break;
    }
  }
  // Shadow-only selection of the lower-detail instanced forest. Keep this
  // bounded by sectors, not by individual trees; the ordinary view still
  // uses the existing instancing and frustum culling.
  function getShadowCasters(x,z,minRadius,maxRadius,maxSectors=18){
    const size=ctx.chunkSize*DISTANT_SECTOR_CHUNKS;
    const margin=size*.75;
    const bins=Array.from({length:4},()=>[]);
    const span=Math.max(1,maxRadius-minRadius);
    for(const [key,sector] of sectors){
      const [sx,sz]=key.split(',').map(Number);
      const dx=(sx+.5)*size-x,dz=(sz+.5)*size-z;
      const distance=Math.hypot(dx,dz);
      if(distance>maxRadius+margin || distance+margin<minRadius)continue;
      const band=Math.min(3,Math.max(0,Math.floor(
        (distance-minRadius)/span*4)));
      bins[band].push({distance,angle:Math.atan2(dz,dx),sector});
    }
    // Reserve slots across the whole radius rather than taking only the
    // nearest sectors. Otherwise 350m shadows could stop around 100m.
    const chosen=new Set();
    const quota=Math.floor(maxSectors/4),rem=maxSectors%4;
    for(let band=3;band>=0;band--){
      const group=bins[band].sort((a,b)=>a.angle-b.angle);
      const count=Math.min(group.length,quota+(band>=4-rem?1:0));
      for(let i=0;i<count;i++)
        chosen.add(group[Math.floor((i+.5)*group.length/count)]);
    }
    // Redistribute unused slots if a distance band is empty.
    const all=bins.flat().sort((a,b)=>b.distance-a.distance);
    for(const entry of all){
      if(chosen.size>=maxSectors)break;
      chosen.add(entry);
    }
    const selected=[];
    for(const {sector} of chosen)
      for(const mesh of sector.meshes){
        if(mesh.count<=0)continue;
        mesh.castShadow=true;
        selected.push(mesh);
      }
    return selected;
  }
  function updateVisibility(){
    // Sector frustum culling is handled by THREE without rewriting matrices.
    // Never enqueue missing chunks here: camera rotation should be GPU-only.
    flush(2);
  }
  function invalidate(){
    generation++;signature='';queue=[];
    for(const key of requested)ctx.worldStreamer?.cancel('forest:'+key);
    requested.clear();cache.clear();desired.clear();dirtySectors.clear();
    for(const key of [...sectors.keys()])evictSector(key);
    count=0;
  }
  function invalidateTree(id){
    const [key]=String(id).split(':');
    if(!cache.has(key))return;
    const [cx,cz]=key.split(',').map(Number);
    dirtySectors.add(sectorKey(cx,cz));
  }
  function clear(){invalidate();lru.clear();lastSeed=null;previousX=previousZ=null;}
  function dispose(){clear();}
  return {update,updateVisibility,invalidate,invalidateTree,getShadowCasters,clear,dispose,
    meshes:sectors,
    get count(){return count;},get pending(){return [...desired].filter(k=>!cache.has(k)).length+dirtySectors.size;},
    get chunkCount(){return cache.size;},
    get desiredChunkCount(){return desired.size;},
    get sectorCount(){return sectors.size;},
  };
}
