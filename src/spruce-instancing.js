// Spruce batches: two draw calls per occupied forest chunk instead of two per tree.
// The shared GLB is converted once into normalized, world-ready geometry.
export function prepareSpruceParts(THREE, template) {
  if (!template) return [];
  template.updateMatrixWorld(true);
  const parts = [];
  template.traverse(node => {
    if (!node.isMesh) return;
    // Bake GLB node transforms and the existing height normalization exactly once.
    parts.push({
      geometry: node.geometry.clone().applyMatrix4(node.matrixWorld),
      material: node.material,
    });
  });
  return parts;
}

export function createSpruceBatch(THREE, parts, parent, capacity = 8) {
  if (!parts.length) return null;
  const dummy = new THREE.Object3D();
  const entries = [];
  const meshes = parts.map(({geometry, material}) => {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parent.add(mesh);
    return mesh;
  });

  function flush() {
    for (let i = 0; i < entries.length; i++) {
      const tree = entries[i];
      const {h, scale} = tree.userData;
      dummy.position.copy(tree.position);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(h * scale);
      dummy.updateMatrix();
      for (const mesh of meshes) mesh.setMatrixAt(i, dummy.matrix);
    }
    for (const mesh of meshes) {
      mesh.count = entries.length;
      mesh.instanceMatrix.needsUpdate = true;
      // The set of trees changes as chunks stream or trees fall.
      mesh.boundingSphere = null;
      mesh.boundingBox = null;
      if (mesh.count) mesh.computeBoundingSphere();
    }
  }

  function add(tree) {
    if (entries.length >= capacity) throw new Error('Spruce chunk capacity exceeded');
    entries.push(tree);
    tree.userData.spruceBatch = api;
    flush();
  }
  function remove(tree) {
    const index = entries.indexOf(tree);
    if (index < 0) return;
    entries.splice(index, 1);
    tree.userData.spruceBatch = null;
    flush();
  }
  function dispose() {
    for (const tree of entries) tree.userData.spruceBatch = null;
    entries.length = 0;
    for (const mesh of meshes) {
      parent.remove(mesh);
      mesh.dispose(); // Release per-instance GPU data, not shared geometry/material.
    }
  }
  const api = {meshes, entries, add, remove, dispose};
  return api;
}

export function detachSpruceForFall(ctx, tree) {
  const batch = tree?.userData?.spruceBatch;
  if (!batch) return;
  batch.remove(tree);
  const visual = ctx.spruceTemplate.clone(true);
  visual.scale.multiplyScalar(tree.userData.h * tree.userData.scale);
  tree.add(visual);
  ctx.atmosphere?.invalidateStaticShadows?.();
}
