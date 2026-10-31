// Deterministic heightfield shared with terrain_height.py on the server.
// Integer lattice hashing ensures the same terrain for every client and bot.
const TAU_32=4294967295;

function lattice(ix,iz,seed,channel){
  let h=(Math.imul(ix,374761393)+Math.imul(iz,668265263)
    +Math.imul(seed|0,1442695041)+Math.imul(channel,1013904223))|0;
  h=Math.imul(h^(h>>>13),1274126177);
  return ((h^(h>>>16))>>>0)/TAU_32;
}
function noise(x,z,seed,channel){
  const ix=Math.floor(x),iz=Math.floor(z);
  let tx=x-ix,tz=z-iz;
  tx=tx*tx*(3-2*tx);tz=tz*tz*(3-2*tz);
  const a=lattice(ix,iz,seed,channel);
  const b=lattice(ix+1,iz,seed,channel);
  const c=lattice(ix,iz+1,seed,channel);
  const d=lattice(ix+1,iz+1,seed,channel);
  return (a+(b-a)*tx)*(1-tz)+(c+(d-c)*tx)*tz;
}
export function baseTerrainHeight(seed,x,z){
  // Broad hills, rolling ground and very mild detail; no cave/voxel geometry.
  const hills=(2*noise(x/155,z/155,seed,11)-1)*5.0;
  const rolls=(2*noise(x/66,z/66,seed,23)-1)*2.5;
  const detail=(2*noise(x/30,z/30,seed,37)-1)*.45;
  const basin=Math.max(0,noise(x/118,z/118,seed,47)-.46)*6;
  // The trailhead/initial spawn is flat; smoothly introduce relief outside it.
  const distance=Math.hypot(x,z);
  let fade=Math.max(0,Math.min(1,(distance-18)/70));
  fade=fade*fade*(3-2*fade);
  return fade*(hills+rolls+detail-basin);
}
