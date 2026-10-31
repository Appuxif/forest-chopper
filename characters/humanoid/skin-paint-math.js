/** Geometry-independent UV stroke interpolation for the mask painter. */
export const PAINT_RESOLUTION=1024;
export function uvToCanvas(uv,resolution=PAINT_RESOLUTION){
  return {x:uv.x*resolution,y:uv.y*resolution};
}
export function interpolateScreenPoints(from,to,step=5){
  const distance=Math.hypot(to.x-from.x,to.y-from.y);
  const n=Math.max(1,Math.ceil(distance/step));
  return Array.from({length:n},(_,i)=>({
    x:from.x+(to.x-from.x)*(i+1)/n,
    y:from.y+(to.y-from.y)*(i+1)/n
  }));
}
