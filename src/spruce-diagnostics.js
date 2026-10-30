// Live foliage visibility, shadow and density controls. Spruce card geometry
// is alpha-trimmed permanently at generation; no GLB/material overrides.
export function createSpruceDiagnostics(THREE,ctx){
  const foliage=ctx.spruceParts?.find(part=>!!part.material?.map);
  if(!foliage)return {tick(){},applyBatch(){},applyTree(){}};
  const originalGeometry=foliage.geometry;
  const sourceIndices=originalGeometry.index?.array;
  const vertexCount=originalGeometry.getAttribute?.('position')?.count;
  const groupSize=sourceIndices?.length%6===0
    && vertexCount===sourceIndices.length/6*4 ? 6 : 3;
  const indices=sourceIndices??Array.from({length:vertexCount??0},(_,i)=>i);
  const groups=Math.floor(indices.length/groupSize);
  const shuffled=Array.from({length:groups},(_,i)=>{
    let h=Math.imul(i+1,0x9e3779b1);
    h=Math.imul(h^(h>>>16),0x85ebca6b);
    h=Math.imul(h^(h>>>13),0xc2b2ae35);
    return {i,hash:(h^(h>>>16))>>>0};
  }).sort((a,b)=>a.hash-b.hash).map(x=>x.i);
  const geometries=new Map([[100,originalGeometry]]);
  const owned=new Set([originalGeometry]);
  const state=()=>({
    visible:ctx.settings?.spruceFoliageVisible!==false,
    shadows:ctx.settings?.spruceFoliageShadows!==false,
    density:Number.isInteger(ctx.settings?.spruceFoliageDensity)
      && ctx.settings.spruceFoliageDensity>=0
      && ctx.settings.spruceFoliageDensity<=100
      ? ctx.settings.spruceFoliageDensity:100,
  });
  let current=state();
  function geometryAt(density){
    if(density===0)return originalGeometry;
    if(geometries.has(density))return geometries.get(density);
    const count=Math.round(groups*density/100);
    const selected=new Uint8Array(groups);
    for(let i=0;i<count;i++)selected[shuffled[i]]=1;
    const array=vertexCount>65535
      ? new Uint32Array(count*groupSize):new Uint16Array(count*groupSize);
    let cursor=0;
    for(let i=0;i<groups;i++)if(selected[i])
      for(let j=0;j<groupSize;j++)array[cursor++]=indices[i*groupSize+j];
    const geometry=originalGeometry.clone();
    geometry.setIndex(new THREE.BufferAttribute(array,1));
    geometries.set(density,geometry);
    owned.add(geometry);
    return geometry;
  }
  function applyBatch(batch){
    if(!batch)return;
    const geometry=geometryAt(current.density);
    for(const mesh of batch.meshes??[]){
      if(!owned.has(mesh.geometry))continue;
      if(mesh.geometry!==geometry){
        mesh.geometry=geometry;
        mesh.boundingSphere=null;
        mesh.boundingBox=null;
        mesh.computeBoundingSphere?.();
      }
      mesh.visible=current.visible&&current.density>0;
      mesh.castShadow=mesh.visible&&current.shadows;
    }
  }
  function applyTree(tree){
    if(!tree?.userData?.spruceModel)return;
    for(const mesh of tree.children??[]){
      if(!mesh.userData?.spruceFoliage)continue;
      mesh.geometry=geometryAt(current.density);
      mesh.visible=!tree.userData.treeBatch&&current.visible&&current.density>0;
      mesh.castShadow=current.visible&&current.density>0&&current.shadows;
    }
  }
  function tick(){
    const next=state();
    if(next.visible===current.visible && next.shadows===current.shadows
      && next.density===current.density)return false;
    current=next;
    for(const chunk of ctx.chunks.values())applyBatch(chunk.userData?.treeBatch);
    for(const tree of ctx.trees.values())applyTree(tree);
    for(const falling of ctx.falling??[])applyTree(falling.tree);
    // Slider should not retain lots of GPU buffers.
    for(const [density,geometry] of geometries){
      if(density===100||density===current.density)continue;
      owned.delete(geometry);
      geometries.delete(density);
      geometry.dispose();
    }
    ctx.atmosphere?.invalidateStaticShadows?.();
    return true;
  }
  return {tick,applyBatch,applyTree};
}
