// Lightweight, reusable shadow-caster selection for players and future NPCs.
// Shadow proxies live on render-invisible layer 4, but share the actor's transform.
export const CHARACTER_SHADOW_NEAR = 30;
export const CHARACTER_SHADOW_PROXY_EXTRA = 16;
export const CHARACTER_SHADOW_FAR = CHARACTER_SHADOW_NEAR + CHARACTER_SHADOW_PROXY_EXTRA;
export const CHARACTER_SHADOW_MAX_DETAILED = 16;
export const CHARACTER_SHADOW_MAX_TOTAL = 16;

// Caller supplies any iterable of {group,actor?,shadowMeshes?,shadowProxy?}.
// The local player always keeps the full animated SkinnedMesh silhouette.
export function selectCharacterShadowCasters(ownActor, actors, x, z, {
  near = CHARACTER_SHADOW_NEAR,
  far = near + CHARACTER_SHADOW_PROXY_EXTRA,
  maxDetailed = CHARACTER_SHADOW_MAX_DETAILED,
  maxTotal = CHARACTER_SHADOW_MAX_TOTAL,
} = {}) {
  const casters = [...(ownActor?.shadowMeshes ?? [])];
  const candidates = [];
  for (const actor of actors) {
    const position = actor.group?.position;
    if (!position) continue;
    const distance = Math.hypot(position.x - x, position.z - z);
    const previous = actor.shadowLod;
    // Hysteresis avoids toggling between meshes and proxy at the boundary.
    if (distance > far + (previous && previous !== 'off' ? 2 : 0)) {
      actor.shadowLod = 'off';
      continue;
    }
    candidates.push({actor, distance});
  }
  candidates.sort((a, b) => a.distance - b.distance);
  let detailed = 0, total = 0;
  for (const {actor, distance} of candidates) {
    if (total >= maxTotal) {
      actor.shadowLod = 'off';
      continue;
    }
    const fullMeshes = actor.actor?.shadowMeshes ?? actor.shadowMeshes ?? [];
    const canUseDetailed = fullMeshes.length > 0 &&
      distance <= near + (actor.shadowLod === 'detailed' ? 2 : 0) &&
      detailed < maxDetailed;
    if (canUseDetailed) {
      casters.push(...fullMeshes);
      actor.shadowLod = 'detailed';
      detailed++;
    } else if (actor.shadowProxy) {
      casters.push(actor.shadowProxy);
      actor.shadowLod = 'proxy';
    } else {
      actor.shadowLod = 'off';
      continue;
    }
    total++;
  }
  return casters;
}

// Stable directional-light projection: align the ortho camera centre to its
// shadow-map texel grid. Shift both light AND target, never their direction.
// Supports changing sun/moon direction and arbitrary world-space player x/z.
export function snapCharacterShadowCenter(x, z, direction, span, resolution) {
  const planar = Math.hypot(direction.x, direction.z);
  const texel = span / Math.max(1, resolution);
  if (planar < 1e-6 || !Number.isFinite(texel) || texel <= 0)
    return {x, y: 0, z};
  const rx = direction.z / planar, rz = -direction.x / planar;
  const ux = -direction.y * direction.x / planar;
  const uy = planar, uz = -direction.y * direction.z / planar;
  const horizontal = x * rx + z * rz;
  const vertical = x * ux + z * uz;
  const dx = Math.round(horizontal / texel) * texel - horizontal;
  const dy = Math.round(vertical / texel) * texel - vertical;
  return {x: x + rx * dx + ux * dy, y: uy * dy,
    z: z + rz * dx + uz * dy};
}
