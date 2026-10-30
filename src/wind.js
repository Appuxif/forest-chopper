// Legacy low-poly crown sway only. Procedural trees bend together on the GPU.
// No new meshes/draw calls, throttled to nearby trees and reduced-motion aware.
export function createWind(ctx, {
  intervalMs = 150,
  radius = 24,
  maxTrees = 32,
  motionQuery = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)') : {matches:false},
} = {}) {
  const active = new Map();
  let lastTick = -Infinity;

  function restore(tree, bases) {
    if (bases.root) {
      tree.rotation.x = bases.root.x;
      tree.rotation.z = bases.root.z;
    }
    for (let i = 0; i < bases.length; i++) {
      const leaf = bases[i].leaf ?? tree.children[i + 1];
      if (!leaf) continue;
      leaf.rotation.x = bases[i].x;
      leaf.rotation.z = bases[i].z;
    }
    tree.userData?.treeBatch?.updateTree(tree);
  }

  function clear() {
    for (const [tree, bases] of active) restore(tree, bases);
    active.clear();
    lastTick = -Infinity;
  }

  // Falling trees animate their root rotation. Unregister the wind *before*
  // detaching them, so the next wind tick cannot snap their fall back upright.
  function forget(tree) {
    const bases=active.get(tree);
    if (!bases)return;
    active.delete(tree);
    restore(tree,bases);
  }

  function tick(now) {
    if (!ctx.settings?.windEnabled || motionQuery?.matches) {
      if (active.size) clear();
      return;
    }
    if (!Number.isFinite(now) || now - lastTick < intervalMs) return;
    lastTick = now;
    const radiusSquared = radius * radius;
    let count = 0;
    for (const tree of ctx.trees.values()) {
      if (count >= maxTrees) break;
      if(tree.userData?.spruceModel||tree.userData?.birchModel)continue;
      const dx = tree.position.x - ctx.px, dz = tree.position.z - ctx.pz;
      if (dx * dx + dz * dz > radiusSquared || (!tree.userData?.spruceModel && tree.children.length < 5)) continue;
      let bases = active.get(tree);
      if (!bases) {
        const foliage=tree.userData?.spruceModel
          ? tree.children.filter(part=>part.userData?.spruceFoliage)
          : tree.children.slice(1,5);
        bases = foliage.map(leaf=>({leaf,x:leaf.rotation.x,z:leaf.rotation.z}));
        if (tree.userData?.spruceModel) {
          bases.root={x:tree.rotation.x,z:tree.rotation.z};
        }
        active.set(tree, bases);
      }
      const phase = tree.position.x*.17 + tree.position.z*.11;
      const wave = Math.sin(now*.0007 + phase)*.014 + Math.sin(now*.0012 + phase*.6)*.004;
      if (bases.root) {
        // About 1/3 of the old crown tilt moves the entire tree from its
        // grounded pivot; remaining motion stays in the light foliage.
        tree.rotation.z=bases.root.z+wave*.35;
        tree.rotation.x=bases.root.x+wave*.35*.35;
      }
      for (let i = 0; i < bases.length; i++) {
        const strength = (1 - i*.14) * (bases.root ? .65 : 1);
        const foliage=bases[i].leaf??tree.children[i+1];
        foliage.rotation.z = bases[i].z + wave * strength;
        foliage.rotation.x = bases[i].x + wave * .35 * strength;
      }
      tree.userData?.treeBatch?.updateTree(tree);
      bases.lastSeen=now;
      count++;
    }
    // Dropped/felled/unloaded/far trees are restored and never retained.
    for (const [tree,bases] of active) {
      if (bases.lastSeen !== now) {
        restore(tree,bases);
        active.delete(tree);
      }
    }
  }

  return {tick,clear,forget,get activeCount(){return active.size;}};
}
