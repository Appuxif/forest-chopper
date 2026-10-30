// Gentle purely visual leaf sway. Keeps the trunk fixed and reuses all existing meshes.
// Work is throttled, limited to nearby trees, and disabled for reduced-motion users.
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
    for (let i = 0; i < bases.length; i++) {
      const leaf = tree.children[i + 1];
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
      const dx = tree.position.x - ctx.px, dz = tree.position.z - ctx.pz;
      if (dx * dx + dz * dz > radiusSquared || tree.children.length < 5) continue;
      let bases = active.get(tree);
      if (!bases) {
        bases = tree.children.slice(1,5).map(leaf=>({x:leaf.rotation.x,z:leaf.rotation.z}));
        active.set(tree, bases);
      }
      const phase = tree.position.x*.17 + tree.position.z*.11;
      const wave = Math.sin(now*.0007 + phase)*.014 + Math.sin(now*.0012 + phase*.6)*.004;
      for (let i = 0; i < bases.length; i++) {
        const strength = 1 - i*.14;
        tree.children[i+1].rotation.z = bases[i].z + wave * strength;
        tree.children[i+1].rotation.x = bases[i].x + wave * .35 * strength;
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

  return {tick,clear,get activeCount(){return active.size;}};
}
