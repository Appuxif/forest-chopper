// Cosmetic hit response focused on the axe scar, not the entire tree trunk.
// Scar materials are owned by individual trees; shared trunk materials remain untouched.
export function createHitEffects(ctx) {
  const active = new Set();
  const duration = 0.15;
  const flashColor = 0xffd49a;

  function release(tree) {
    if (!tree) return;
    active.delete(tree);
    const effect = tree.userData?.hitEffect;
    if (!effect) return;
    effect.scar.material.color.setHex(effect.originalColor);
    effect.scar.scale.x = effect.x;
    delete tree.userData.hitEffect;
  }

  function pulse(tree) {
    const scar = tree?.userData?.scar;
    if (!scar?.material?.color) return;
    let effect = tree.userData.hitEffect;
    if (!effect) {
      effect = {
        scar,
        originalColor: scar.material.color.getHex(),
        x: scar.scale.x,
        remaining: duration,
      };
      tree.userData.hitEffect = effect;
    }
    effect.remaining = duration;
    effect.reduced = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    scar.visible = true;
    scar.material.color.setHex(flashColor);
    active.add(tree);
  }

  function tick(dt) {
    for (const tree of active) {
      const effect = tree.userData.hitEffect;
      if (!effect) {active.delete(tree); continue;}
      effect.remaining = Math.max(0, effect.remaining - dt);
      if (!effect.remaining) {release(tree); continue;}
      if (!effect.reduced) {
        const swell = 1 + 0.12 * Math.sin(Math.PI * effect.remaining / duration);
        effect.scar.scale.x = effect.x * swell;
      }
    }
  }

  return {pulse, tick, release, get activeCount() {return active.size;}};
}
