// Render the original five meshes per tree as per-chunk InstancedMeshes.
// Logical tree groups remain (hidden) for raycasts, wind and falling animations.
// Share geometry and material style; per-instance colors preserve original palettes.
export function createTreeBatch(THREE, parent, trees, sharedMaterials=new Map()) {
  // Minimal Three.js doubles in logic-only tests do not implement GPU rendering.
  if (!THREE.InstancedMesh || !trees.length) return null;
  const groups = new Map(), records = new Map(), meshes = [];
  const entriesFor = new Map();

  for (const tree of trees) {
    tree.updateMatrixWorld?.(true);
    const recordsForTree = [];
    for (const original of tree.children) {
      if (!original.isMesh && !original.geometry) continue;
      let materials = groups.get(original.geometry);
      if (!materials) groups.set(original.geometry, materials = new Map());
      const source=original.material;
      const colored=!!(source?.color?.isColor && source.clone);
      // Materials differ only in tree tint, so use per-instance colors while
      // retaining the exact original shader, map, side and transparency.
      // The birch's bark texture remains a separate material group.
      const style=colored?[
        source.type,source.map?.uuid??'',source.side,source.vertexColors,
        source.transparent,source.opacity,source.alphaTest,source.flatShading,
        source.depthWrite,source.wireframe,
      ].join('|'):source;
      let group=materials.get(style);
      if(!group){
        const cacheKey=colored?`${original.geometry.uuid}|${style}`:null;
        let material=cacheKey?sharedMaterials.get(cacheKey):null;
        if(!material){
          material=colored?source.clone():source;
          if(colored)material.color.set(0xffffff);
          if(cacheKey)sharedMaterials.set(cacheKey,material);
        }
        group={geometry:original.geometry,material,originals:[],colored};
        materials.set(style,group);
      }
      group.originals.push({tree, original});
      recordsForTree.push({original, group});
    }
    entriesFor.set(tree, recordsForTree);
  }

  for (const materials of groups.values()) for (const group of materials.values()) {
    const mesh = new THREE.InstancedMesh(group.geometry, group.material, group.originals.length);
    mesh.castShadow = true;
    mesh.instanceMatrix.setUsage?.(THREE.DynamicDrawUsage);
    mesh.count = group.originals.length;
    group.mesh = mesh;
    group.instances = group.originals;
    for (let i = 0; i < group.instances.length; i++) {
      const {original} = group.instances[i];
      original.updateMatrixWorld?.(true);
      mesh.setMatrixAt(i, original.matrixWorld);
      if(group.colored)mesh.setColorAt(i,original.material.color);
      original.visible = false;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    mesh.computeBoundingSphere?.();
    parent.add(mesh);
    meshes.push(mesh);
  }
  const api={meshes,records,updateTree,remove,dispose};
  for (const tree of trees) {
    const list=entriesFor.get(tree);
    records.set(tree,list.map(({original,group})=>({
      original,group,index:group.instances.findIndex(entry=>entry.original===original),
    })));
    tree.userData.treeBatch = api;
  }

  function updateTree(tree) {
    const list = records.get(tree);
    if (!list) return;
    tree.updateMatrixWorld?.(true);
    for (const {original,group,index} of list) {
      original.updateMatrixWorld?.(true);
      group.mesh.setMatrixAt(index,original.matrixWorld);
      group.mesh.instanceMatrix.needsUpdate=true;
    }
    // Animation is a tiny crown sway, but keep the bounds correct for culling.
    for (const group of new Set(list.map(record=>record.group))) {
      group.mesh.boundingSphere = null;
      group.mesh.computeBoundingSphere?.();
    }
  }

  function remove(tree, reveal=true) {
    const list=records.get(tree);
    if (!list)return;
    for (const {original,group,index} of list) {
      const instances=group.instances;
      const last=instances.length-1;
      if (index!==last) {
        const replacement=instances[last];
        instances[index]=replacement;
        const slots=records.get(replacement.tree);
        const slot=slots.find(record=>record.original===replacement.original);
        slot.index=index;
        replacement.original.updateMatrixWorld?.(true);
        group.mesh.setMatrixAt(index,replacement.original.matrixWorld);
        if(group.colored){
          group.mesh.setColorAt(index,replacement.original.material.color);
          group.mesh.instanceColor.needsUpdate=true;
        }
      }
      instances.pop();
      group.mesh.count=instances.length;
      group.mesh.instanceMatrix.needsUpdate=true;
      group.mesh.boundingSphere=null;
      if (instances.length)group.mesh.computeBoundingSphere?.();
      original.visible=reveal;
      if(reveal)original.castShadow=true;
    }
    records.delete(tree);
    tree.userData.treeBatch=null;
  }

  function dispose() {
    for (const tree of records.keys())tree.userData.treeBatch=null;
    records.clear();
    for (const mesh of meshes) {
      parent.remove(mesh);
      mesh.dispose(); // Geometry/material are shared and owned by the game.
    }
  }

  return api;
}

export function detachTreeForFall(ctx,tree) {
  const batch=tree?.userData?.treeBatch;
  if (!batch)return;
  batch.remove(tree);
  ctx.atmosphere?.invalidateStaticShadows?.();
}
