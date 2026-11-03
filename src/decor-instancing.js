// Per-chunk GPU batching for collectible and reactive decorations.
// Original objects stay in the scene with their stable game IDs, positions,
// rotations, visibility and collision semantics. Only their source mesh draw
// layers are disabled; the shared InstancedMeshes do the actual rendering.
export const DECOR_SOURCE_LAYER=30; // Never enabled on game or shadow cameras.

export function createDecorBatch(THREE,chunk,objects) {
  if(!THREE?.InstancedMesh || !objects?.length)return null;
  const groups=new Map(),bySource=new Map(),meshes=[];
  const register=(source,part)=>{
    if(!part.isMesh||!part.geometry||!part.material||Array.isArray(part.material))
      return false;
    let byMaterial=groups.get(part.geometry);
    if(!byMaterial)groups.set(part.geometry,byMaterial=new Map());
    let group=byMaterial.get(part.material);
    if(!group){
      group={geometry:part.geometry,material:part.material,
        entries:[],active:[],mesh:null};
      byMaterial.set(part.material,group);
    }
    const entry={source,part,group,index:-1};
    group.entries.push(entry);
    if(!bySource.has(source))bySource.set(source,[]);
    bySource.get(source).push(entry);
    return true;
  };
  // Do not partially batch a model with unsupported parts.
  for(const source of objects){
    const parts=[];
    source.traverse?.(obj=>{if(obj.isMesh)parts.push(obj);});
    if(!parts.length||parts.some(part=>!part.geometry||!part.material||
        Array.isArray(part.material)))continue;
    for(const part of parts)register(source,part);
  }
  for(const byMaterial of groups.values())for(const group of byMaterial.values()){
    const mesh=new THREE.InstancedMesh(group.geometry,group.material,group.entries.length);
    mesh.name='Decor batch';
    mesh.count=0;
    mesh.castShadow=true;
    mesh.receiveShadow=group.entries.some(entry=>entry.part.receiveShadow);
    mesh.frustumCulled=true;
    mesh.userData.profileCategory='decor';
    const first=group.entries[0].source;
    // Bounds for selecting cached shadow casters (the whole 24m chunk).
    const key=chunk.userData?.decorChunk;
    mesh.userData.decorBatchBounds=key??{
      x:first.position.x,y:first.position.y,z:first.position.z,radius:18,
    };
    // Fixed conservative bounds: plant tilt never moves a source root.
    // Avoid O(instanceCount) bounding-sphere rebuilds on each animation tick.
    if(key&&THREE.Sphere&&THREE.Vector3){
      mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(key.x,key.y,key.z),key.radius);
      mesh.userData.decorBoundsFixed=true;
    }
    group.mesh=mesh;meshes.push(mesh);chunk.add(mesh);
  }
  const scratch=new THREE.Matrix4();
  function touch(group){
    group.mesh.instanceMatrix.needsUpdate=true;
    // InstancedMesh caches bounds until explicitly invalidated.
    if(!group.mesh.userData.decorBoundsFixed){
      group.mesh.boundingSphere=null;
      group.mesh.boundingBox=null;
    }
  }
  function add(entry){
    const group=entry.group;
    entry.index=group.active.length;
    group.active.push(entry);
    group.mesh.count=group.active.length;
    group.mesh.setMatrixAt(entry.index,entry.part.matrixWorld);
    touch(group);
  }
  function remove(entry){
    const group=entry.group,index=entry.index;
    if(index<0)return false;
    const lastIndex=group.active.length-1;
    if(index!==lastIndex){
      const moved=group.active[lastIndex];
      group.mesh.getMatrixAt(lastIndex,scratch);
      group.mesh.setMatrixAt(index,scratch);
      group.active[index]=moved;
      moved.index=index;
    }
    group.active.pop();entry.index=-1;
    group.mesh.count=group.active.length;
    touch(group);
    return true;
  }
  function sync(source,{transform=false}={}){
    const entries=bySource.get(source);
    if(!entries)return false;
    const desired=source.visible!==false&&!source.userData?.collectedResource;
    const active=entries[0].index>=0;
    if(active===desired&&!transform)return false;
    if(desired)source.updateMatrixWorld(true);
    for(const entry of entries){
      if(!desired)remove(entry);
      else if(entry.index<0)add(entry);
      else{
        entry.group.mesh.setMatrixAt(entry.index,entry.part.matrixWorld);
        touch(entry.group);
      }
    }
    return active!==desired;
  }
  // Switch source meshes to a private layer instead of mutating visible.
  // Existing resource queries and bending logic require source.visible=true.
  for(const [source,entries] of bySource){
    for(const {part} of entries){
      part.layers.set(DECOR_SOURCE_LAYER);
      part.userData.decorBatchSource=true;
    }
  }
  function dispose(){
    for(const [source,entries] of bySource){
      delete source.userData.decorBatch;
      for(const {part} of entries){
        part.layers.set(0);
        delete part.userData.decorBatchSource;
      }
    }
    for(const mesh of meshes){
      chunk.remove(mesh);
      mesh.dispose(); // Instance buffers only; original geometry/material shared.
    }
    bySource.clear();groups.clear();meshes.length=0;
  }
  function syncAll(){for(const source of bySource.keys())sync(source);}
  // Source transforms are already world-space; batched mesh stays at origin.
  // Multiple mushroom submeshes are kept in lockstep by source.
  const apiProxy={sync,dispose,syncAll,meshes};
  for(const source of bySource.keys())source.userData.decorBatch=apiProxy;
  syncAll();
  return apiProxy;
}
