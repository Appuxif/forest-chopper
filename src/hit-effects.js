// Compatibility shim for older cached chopping.js clients.
// The game no longer uses a transient material/scale flash on axe impacts:
// wood chips and the tree HP bar provide the visible feedback instead.
// Keep this export inert until old browser caches have expired.
export function createHitEffects() {
  return {
    pulse() {},
    tick() {},
    release() {},
    get activeCount() { return 0; },
  };
}
