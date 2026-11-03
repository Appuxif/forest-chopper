import {createDecorBatch} from './decor-instancing.js?v=20261103-decor-region1';

// Adjustable GPU batch sectors (in chunks). Logical decor/IDs remain owned
// by the original world chunks, so switching size never resets collectibles.
export const DECOR_REGION_CHUNKS=3;
export const DECOR_REGION_SIZES=Object.freeze([1,2,3,5]);
export function decorRegionKey(cx,cz,size=DECOR_REGION_CHUNKS){
  const half=Math.floor(size/2);
  return Math.floor((cx+half)/size)+','+Math.floor((cz+half)/size);
}

export function createDecorRegionManager(THREE,scene,{onChange=()=>{}}={}){
  const regions=new Map();
  const keyOf=new Map();
  const coordinates=new Map();
  let regionSize=DECOR_REGION_CHUNKS;
  function update(region){
    region.batch?.dispose();
    region.batch=null;
    if(!region.chunks.size){
      scene.remove(region.root);
      regions.delete(region.key);
      onChange();
      return;
    }
    const sources=[];
    for(const chunk of region.chunks){
      for(const obj of chunk.children){
        if(obj.userData?.decorType)sources.push(obj);
      }
    }
    // Bounding sphere for shadow selection encompasses all source roots.
    const minX=Math.min(...sources.map(s=>s.position.x));
    const maxX=Math.max(...sources.map(s=>s.position.x));
    const minZ=Math.min(...sources.map(s=>s.position.z));
    const maxZ=Math.max(...sources.map(s=>s.position.z));
    const ys=sources.map(source=>source.position.y);
    const minY=Math.min(...ys),maxY=Math.max(...ys);
    const x=(minX+maxX)/2,y=(minY+maxY)/2,z=(minZ+maxZ)/2;
    region.root.userData.decorChunk={
      x:Number.isFinite(x)?x:0,y:Number.isFinite(y)?y:0,
      z:Number.isFinite(z)?z:0,
      // Includes full 3D terrain-height variation plus model/bend margin.
      radius:Number.isFinite(x)
        ?Math.hypot(maxX-minX,maxY-minY,maxZ-minZ)/2+3:0,
    };
    region.batch=createDecorBatch(THREE,region.root,sources);
    for(const chunk of region.chunks){
      chunk.userData.shadowDecor=region.batch
        ?chunk.userData.baseShadowDecor.filter(obj=>!obj.userData?.decorType)
        :chunk.userData.baseShadowDecor;
    }
    onChange();
  }
  function attach(cx,cz,chunk){
    const key=decorRegionKey(cx,cz,regionSize);
    let region=regions.get(key);
    if(!region){
      const root=new THREE.Group();
      root.name='Decor region '+key;
      region={key,root,chunks:new Set(),batch:null};
      regions.set(key,region);
      scene.add(root);
    }
    if(region.chunks.has(chunk))return null;
    // Capture original casters only on first arrival. Their source objects
    // are never discarded when a GPU batch is rebuilt.
    if(!coordinates.has(chunk)){
      chunk.userData.baseShadowDecor=chunk.userData.shadowDecor;
      coordinates.set(chunk,{cx,cz});
    }
    region.chunks.add(chunk);
    keyOf.set(chunk,region);
    return region;
  }
  function add(cx,cz,chunk){
    const region=attach(cx,cz,chunk);
    if(region)update(region);
  }
  function remove(chunk){
    const region=keyOf.get(chunk);
    if(!region)return;
    coordinates.delete(chunk);
    keyOf.delete(chunk);
    region.chunks.delete(chunk);
    chunk.userData.shadowDecor=chunk.userData.baseShadowDecor;
    update(region);
  }
  function releaseRegions(){
    for(const region of regions.values()){
      region.batch?.dispose();
      for(const chunk of region.chunks)
        chunk.userData.shadowDecor=chunk.userData.baseShadowDecor;
      scene.remove(region.root);
    }
    regions.clear();keyOf.clear();
  }
  function setSize(size){
    if(!DECOR_REGION_SIZES.includes(size))
      throw new RangeError('Unsupported decor region size: '+size);
    if(size===regionSize)return false;
    // Reuse world-owned source objects and preserve all collected/visibility
    // flags. Each resulting region is rebuilt only once, not once per chunk.
    releaseRegions();
    regionSize=size;
    for(const [chunk,{cx,cz}] of coordinates)attach(cx,cz,chunk);
    for(const region of regions.values())update(region);
    onChange();
    return true;
  }
  function clear(){
    releaseRegions();
    coordinates.clear();
    onChange();
  }
  return {add,remove,clear,setSize,regions,get size(){return regionSize;}};

}
