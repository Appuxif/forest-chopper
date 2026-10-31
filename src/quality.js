// Rendering resolution only, no world/physics/chunk generation changes.
export const QUALITY_PIXEL_RATIO = Object.freeze({low:.8, balanced:1.25, high:1.6});
export function pixelRatioForQuality(quality, deviceRatio=1){
  const ceiling=QUALITY_PIXEL_RATIO[quality] ?? QUALITY_PIXEL_RATIO.balanced;
  return Math.min(Math.max(.5,Number.isFinite(deviceRatio)?deviceRatio:1),ceiling);
}
export function applyQuality(renderer, quality, deviceRatio, width, height, renderScale=null){
  const ratio=renderScale===null
    ?pixelRatioForQuality(quality,deviceRatio)
    :Math.min(2.5,Math.max(.5,deviceRatio*(renderScale/100)));
  renderer.setPixelRatio(ratio);
  renderer.setSize(width,height);
  return ratio;
}
