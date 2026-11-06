// One LOD equation for the game and HTML grass editor.
// f(t)=t³/[t³+(c+k)(a-t)²], with t measured from full-density
// distance to (radius-2m), matching the original dev implementation.
const clamp01 = n => Math.max(0, Math.min(1, n));

export function grassDistanceFalloff(distance, radius, {
  nearEnd = 26, sharpness = .005, coefficient = .25, offset = 1,
} = {}) {
  if (radius <= nearEnd || distance <= nearEnd) return 0;
  const end = Math.max(nearEnd + 1, radius - 2);
  const t = clamp01((distance - nearEnd) / (end - nearEnd));
  const near = t * t * t;
  const far = (offset - t) * (offset - t);
  const denominator = near + (coefficient + sharpness) * far;
  return denominator > 0 ? clamp01(near / denominator) : 0;
}

export function grassDistanceDensity(distance, radius, {
  nearEnd = 26, minDensity = .38, sharpness = .005,
  coefficient = .25, offset = 1,
} = {}) {
  const falloff = grassDistanceFalloff(distance, radius, {
    nearEnd, sharpness, coefficient, offset,
  });
  return 1 - (1 - minDensity) * falloff;
}

// Transition ONLY between geometry resolutions, not another density curve.
// At every distance nearWeight + farWeight === 1.
export function grassGeometryTierWeight(distance, tier, transitionStart = 19, transitionEnd = 26) {
  const t = clamp01((distance - transitionStart) /
    Math.max(.001, transitionEnd - transitionStart));
  const farWeight = t * t * (3 - 2 * t);
  return tier === 'near' ? 1 - farWeight : farWeight;
}
