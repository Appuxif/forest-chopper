// Cosmetic hit response: one shared highlight material and a bounded set of active trees.
// Never changes tree HP, collisions, server messages, or any shared tree material.
export function createHitEffects(ctx) {
  const flash = new ctx.THREE.MeshLambertMaterial({color: 0xffd49a});
  const active = new Set();
  const duration = 0.15;

  function release(tree) {
    if (!tree) return;
    active.delete(tree);
    const effect = tree.userData?.hitEffect;
    if (!effect) return;
    const trunk = tree.children[0];
    if (trunk) {
      trunk.material = effect.original;
      trunk.scale.x = effect.x;
      trunk.scale.z = effect.z;
    }
    delete tree.userData.hitEffect;
  }

  function pulse(tree) {
    if (!tree?.children?.[0]) return;
    const trunk = tree.children[0];
    let effect = tree.userData.hitEffect;
    if (!effect) {
      effect = {original: trunk.material, x: trunk.scale.x, z: trunk.scale.z, remaining: duration};
      tree.userData.hitEffect = effect;
    }
    effect.remaining = duration;
    effect.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    trunk.material = flash;
    active.add(tree);
  }

  function tick(dt) {
    for (const tree of active) {
      const effect = tree.userData.hitEffect;
      if (!effect) {active.delete(tree); continue;}
      effect.remaining = Math.max(0, effect.remaining - dt);
      if (!effect.remaining) {release(tree); continue;}
      const trunk = tree.children[0];
      if (!effect.reduced && trunk) {
        const swell = 1 + 0.05 * Math.sin(Math.PI * effect.remaining / duration);
        trunk.scale.x = effect.x * swell;
        trunk.scale.z = effect.z * swell;
      }
    }
  }

  return {pulse, tick, release, get activeCount() {return active.size;}};
}
