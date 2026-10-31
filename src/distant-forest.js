// Procedurally generated low-detail forest beyond the interactive 24m tree chunks.
// Tree positions, species and water exclusions match createWorld exactly.
// Distant instances never enter ctx.trees, collision detection, or shadow passes.
import {treeCanSpawn,treeCandidate,TREES_PER_CHUNK} from './tree-spacing.js';
import {lakesNearTile,lakeHorizonDistance} from './lakes.js';
export const DISTANT_FOREST_BASE_METERS=165;
export const DISTANT_FOREST_LAKE_METERS=410; // Visibility cap, NOT a full forest disk.
export const DISTANT_FOREST_SHORE_WIDTH=54; // ~2 chunks of trees beyond lake shores.
export const DISTANT_FOREST_CHUNKS_PER_TICK=48;

export function distantForestRange(terrain,lakes=[],x=0,z=0,
  settings=null){
  // The forest beyond 165m exists only around a nearby lake, not throughout
  // the camera's field. Its actual extent depends on the lake's ellipse.
  const visibility=Math.max(terrain?.visibility??0,terrain?.visibilityTarget??0);
  const base=settings?.farForestDistance??DISTANT_FOREST_BASE_METERS;
  if(visibility<=.035||!lakes.length||settings?.lakeForestMode==='off')return base;
  if(settings?.lakeForestMode==='full')
    return Math.max(base,settings?.lakeViewDistance??DISTANT_FOREST_LAKE_METERS);
  return Math.min(settings?.lakeViewDistance??DISTANT_FOREST_LAKE_METERS,Math.max(base,
    ...lakes.map(lake=>lakeHorizonDistance(
      lake,x,z,DISTANT_FOREST_SHORE_WIDTH+12))));
}

// Signed, approximate distance in metres to the irregular shoreline.
// Negative = inside the lake, positive = inland. Uses lake rotation and the
// same perimeter harmonics as lakeNormalized/lakePoint.
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

// Use real Foliage Cards trees generated from the same editor presets as
// the near forest. Each part keeps its own bark/leaf atlas and alphaTest.
export function createDistantForest(ctx){
  const THREE=ctx.THREE;
  if(!THREE.InstancedMesh||!THREE.Object3D)
    return {update(){},invalidate(){},clear(){},dispose(){},get count(){return 0;}};
  const CAPACITY=18000;
  const templates={
    conifer:ctx.distantTreeParts?.conifer??ctx.spruceParts??[],
    birch:ctx.distantTreeParts?.birch??ctx.birchParts??[],
  };
  const meshes={conifer:[],birch:[]};
  for(const kind of ['conifer','birch']){
    for(const part of templates[kind]){
      if(!part.geometry||!part.material)continue;
      const mesh=new THREE.InstancedMesh(part.geometry,part.material,CAPACITY);
      mesh.name='Distant '+kind+' '+((part.foliage??part.material.alphaTest>0)?'foliage':'wood');
      mesh.count=0;
      mesh.frustumCulled=false;
      mesh.castShadow=false;
      mesh.receiveShadow=false;
      ctx.scene.add(mesh);
      meshes[kind].push(mesh);
    }
  }
  const dummy=new THREE.Object3D();
  const cache=new Map(); // keyed 24m chunk; bounded to current visibility
  let queue=[],lastCx=null,lastCz=null,lastRange=null,lastSeed=null,lastNear=null,lastLakeMode=null,lastDensity=null;
  let dirty=true,viewDirty=true,lastViewYaw=null,lastViewX=null,lastViewZ=null;
  const rand=(x,z,n=0)=>{
    const value=Math.sin(x*127.1+z*311.7+n*78.233+ctx.seed)*43758.5453;
    return value-Math.floor(value);
  };
  const key=(cx,cz)=>cx+','+cz;

  function makeChunk(cx,cz){
    const trees=[];
    for(let i=0;i<TREES_PER_CHUNK;i++){
      if(!treeCanSpawn(cx,cz,i,rand,ctx.chunkSize))continue;
      // Stable per-tree thinning: never changes candidate IDs or placement.
      if(rand(cx,cz,8000+i)*100>=(ctx.settings?.farTreeDensity??100))continue;
      const point=treeCandidate(cx,cz,i,rand,ctx.chunkSize);
      if(!point||ctx.felled.has(key(cx,cz)+':'+i))continue;
      if(ctx.terrain.waterDepthAt(point.x,point.z)>.12)continue;
      const {x,z}=point;
      trees.push({
        id:key(cx,cz)+':'+i,
        kind:rand(x,z,703)<.2?'birch':'conifer',x,z,
        y:ctx.terrain.heightAt(x,z),
        height:7.5+rand(x,z,4)*6.5,
        scale:.9+rand(x,z,5)*.65,
      });
    }
    return trees;
  }

  function rebuild(){
    const counts={conifer:0,birch:0};
    for(const trees of cache.values())for(const tree of trees){
      const i=counts[tree.kind]++;
      if(i>=CAPACITY){counts[tree.kind]=CAPACITY;continue;}
      dummy.position.set(tree.x,tree.y,tree.z);
      dummy.rotation.set(0,0,0);
      // Identical transform to the detailed procedural models in world.js.
      dummy.scale.set(tree.scale,tree.height/(tree.kind==='conifer'?6:8),tree.scale);
      dummy.updateMatrix();
      for(const mesh of meshes[tree.kind])mesh.setMatrixAt(i,dummy.matrix);
    }
    for(const kind of ['conifer','birch']){
      for(const mesh of meshes[kind]){
        mesh.count=counts[kind];
        mesh.instanceMatrix.needsUpdate=true;
      }
    }
    dirty=false;viewDirty=true;
  }

  function update(){
    const size=ctx.chunkSize;
    const cx=Math.floor(ctx.px/size),cz=Math.floor(ctx.pz/size);
    const near=ctx.radius??3; // detailed forest; retained chunks are excluded below
    // The ordinary 165m forest stays. A lake panorama adds ONLY a narrow
    // shoreline belt, not a 410m disk filled with millions of triangles.
    const visibility=Math.max(ctx.terrain?.visibility??0,
      ctx.terrain?.visibilityTarget??0);
    const lakeMode=visibility>.035&&ctx.settings?.lakeForestMode!=='off';
    const nearbyLakes=lakeMode
      ? lakesNearTile(ctx.seed,ctx.px-500,
          ctx.pz-500,1000)
        .filter(lake=>distanceToLakeShore(lake,ctx.px,ctx.pz)<145)
      :[];
    const outerRadius=distantForestRange(
      ctx.terrain,nearbyLakes,ctx.px,ctx.pz,ctx.settings);
    const range=Math.ceil(outerRadius/size);
    const lakeIds=nearbyLakes.map(lake=>lake.id).sort().join('|');
    const density=ctx.settings?.farTreeDensity??100;
    if(cx!==lastCx||cz!==lastCz||near!==lastNear||
        range!==lastRange||ctx.seed!==lastSeed||lakeIds!==lastLakeMode||
        density!==lastDensity){
      if(ctx.seed!==lastSeed||density!==lastDensity)cache.clear();
      lastDensity=density;
      lastCx=cx;lastCz=cz;lastRange=range;lastNear=near;
      lastSeed=ctx.seed;lastLakeMode=lakeIds;
      const desired=new Set();
      const baseSq=((ctx.settings?.farForestDistance??DISTANT_FOREST_BASE_METERS)+size*.72)**2;
      const outerSq=(outerRadius+size*.72)**2;
      const chunkMargin=size*Math.SQRT2*.5;
      for(let ix=cx-range;ix<=cx+range;ix++)for(let iz=cz-range;iz<=cz+range;iz++){
        if(Math.abs(ix-cx)<=near&&Math.abs(iz-cz)<=near)continue;
        if(ctx.chunks?.has(key(ix,iz)))continue;
        const x=(ix+.5)*size,z=(iz+.5)*size;
        const dx=x-ctx.px,dz=z-ctx.pz;
        const d2=dx*dx+dz*dz;
        // Trees outside the standard area only belong to the immediate
        // lakeshore, including the far bank. No forest behind that strip.
        const aroundLake=lakeMode&&nearbyLakes.length>0&&d2<=outerSq&&(
          ctx.settings?.lakeForestMode==='full'||nearbyLakes.some(lake=>{
          const shore=distanceToLakeShore(lake,x,z);
          return shore>=-chunkMargin &&
            shore<=DISTANT_FOREST_SHORE_WIDTH+chunkMargin;
        }));
        if(d2>baseSq&&!aroundLake)continue;
        desired.add(key(ix,iz));
      }
      for(const k of cache.keys())if(!desired.has(k)){cache.delete(k);dirty=true;}
      // Nearest missing chunks first. Work is divided over world ticks to avoid
      // generating thousands of tree candidates in a single frame.
      queue=[...desired].filter(k=>!cache.has(k)).map(k=>{
        const [x,z]=k.split(',').map(Number);
        return {k,x,z,d:(x+.5-cx)**2+(z+.5-cz)**2};
      }).sort((a,b)=>a.d-b.d);
    }
    for(let i=0;i<DISTANT_FOREST_CHUNKS_PER_TICK&&queue.length;i++){
      const next=queue.shift();
      cache.set(next.k,makeChunk(next.x,next.z));
      dirty=true;
    }
    if(dirty)rebuild();
  }
  // Cull instances behind the player; camera turns only upload matrices when
  // the direction changes appreciably (~6 degrees), not on every frame.
  function updateVisibility(yaw=0){
    const moved=lastViewX===null ||
      Math.hypot(ctx.px-lastViewX,ctx.pz-lastViewZ)>5;
    if(!viewDirty&&!moved&&lastViewYaw!==null&&
       Math.abs(Math.atan2(Math.sin(yaw-lastViewYaw),
         Math.cos(yaw-lastViewYaw)))<.105)return;
    viewDirty=false;lastViewYaw=yaw;lastViewX=ctx.px;lastViewZ=ctx.pz;
    const counts={conifer:0,birch:0};
    const fx=-Math.sin(yaw),fz=-Math.cos(yaw);
    const vertical=(ctx.camera?.fov??75)*Math.PI/180;
    const horizontal=2*Math.atan(Math.tan(vertical/2)*(ctx.camera?.aspect??1.78));
    const threshold=Math.cos(Math.min(Math.PI,horizontal/2+.24));
    for(const trees of cache.values())for(const tree of trees){
      const dx=tree.x-ctx.px,dz=tree.z-ctx.pz;
      const distance=Math.hypot(dx,dz);
      if(distance>20&&(dx*fx+dz*fz)/distance<threshold)continue;
      const i=counts[tree.kind]++;
      if(i>=CAPACITY){counts[tree.kind]=CAPACITY;continue;}
      dummy.position.set(tree.x,tree.y,tree.z);
      dummy.rotation.set(0,0,0);
      dummy.scale.set(tree.scale,tree.height/(tree.kind==='conifer'?6:8),tree.scale);
      dummy.updateMatrix();
      for(const mesh of meshes[tree.kind])mesh.setMatrixAt(i,dummy.matrix);
    }
    for(const kind of ['conifer','birch'])
      for(const mesh of meshes[kind]){
        mesh.count=counts[kind];
        mesh.instanceMatrix.needsUpdate=true;
      }
  }
  function invalidate(){
    // E.g. a remote player fells a distant tree or the world is restored.
    cache.clear();queue=[];lastCx=null;lastCz=null;dirty=true;
    rebuild();
  }
  function invalidateTree(id){
    const chunkKey=String(id).split(':')[0];
    const trees=cache.get(chunkKey);
    if(!trees)return;
    const kept=trees.filter(tree=>tree.id!==id);
    if(kept.length===trees.length)return;
    cache.set(chunkKey,kept);
    dirty=true;
    rebuild();
  }
  function clear(){
    invalidate();
    lastSeed=null;
  }
  function dispose(){
    // Only instance buffers belong here; generated geometry/atlases are
    // shared by all distant batches and owned by the startup model templates.
    for(const parts of Object.values(meshes))for(const mesh of parts){
      ctx.scene.remove(mesh);
      mesh.dispose();
    }
    cache.clear();queue=[];
  }
  return {update,invalidate,invalidateTree,clear,dispose,meshes,
    get count(){return (meshes.conifer[0]?.count??0)+(meshes.birch[0]?.count??0);},
    get pending(){return queue.length;},
    get chunkCount(){return cache.size;},updateVisibility,
  };
}
