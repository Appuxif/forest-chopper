// Deterministic forest glades, independent of camera/player movement.
// Four profiles: 1 bare, 2 tall dense (5-7x), 3 short dense (1-4x),
// 4 short sparse (1-4x). Type 0 means ordinary user-configured grass.
//
// One site per 42m world cell; sizes vary and boundaries are irregular.
// Each 2x2 group has all four types in a seed-dependent shuffled order.
export const GLADE_CELL = 42;
export const GLADE_MAX_REACH = 36; // allow enlarged glades and their soft margins

function hash(seed, x, z, channel) {
  let n = (seed | 0) ^ Math.imul(x, 0x1b873593) ^
    Math.imul(z, 0x85ebca6b) ^ Math.imul(channel + 1, 0xc2b2ae35);
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function gladeType(seed, gx, gz) {
  const mx = Math.floor(gx / 2), mz = Math.floor(gz / 2);
  const order = [1,2,3,4];
  for (let i=3; i>0; i--) {
    const j = Math.floor(hash(seed,mx,mz,60+i)*(i+1));
    [order[i],order[j]] = [order[j],order[i]];
  }
  return order[((gz & 1)*2)+(gx & 1)];
}

function gladeAt(seed, gx, gz) {
  const radius = 1.5 * (6.3 + 4.6 * hash(seed,gx,gz,7));
  const angle = hash(seed,gx,gz,8) * Math.PI * 2;
  return {
    kind: gladeType(seed,gx,gz),
    x:(gx+.5)*GLADE_CELL + (hash(seed,gx,gz,2)-.5)*15,
    z:(gz+.5)*GLADE_CELL + (hash(seed,gx,gz,3)-.5)*15,
    rx:radius*(.82 + hash(seed,gx,gz,9)*.36),
    rz:radius*(.82 + hash(seed,gx,gz,10)*.36),
    cos:Math.cos(angle), sin:Math.sin(angle),
    phase:hash(seed,gx,gz,11)*Math.PI*2,
    // Conservative bound, including the irregular edge and transition band.
    reach:radius*1.18*1.3,
  };
}

// Only look up glades overlapping a tile. No giant world-wide cache.
export function gladesForTile(seed, x0, z0, size) {
  const result = [];
  const lowX=Math.floor((x0-GLADE_MAX_REACH)/GLADE_CELL);
  const highX=Math.floor((x0+size+GLADE_MAX_REACH)/GLADE_CELL);
  const lowZ=Math.floor((z0-GLADE_MAX_REACH)/GLADE_CELL);
  const highZ=Math.floor((z0+size+GLADE_MAX_REACH)/GLADE_CELL);
  for(let gx=lowX; gx<=highX; gx++)for(let gz=lowZ;gz<=highZ;gz++){
    const patch=gladeAt(seed,gx,gz);
    const reach=patch.reach;
    if(patch.x+reach<x0 || patch.x-reach>x0+size ||
       patch.z+reach<z0 || patch.z-reach>z0+size) continue;
    result.push(patch);
  }
  return result;
}

const ease = t => t*t*(3-2*t);

// Mutates "out", to avoid allocating a new object for every candidate blade.
export function gladeAtPoint(x, z, patches, out) {
  out.kind=0;out.weight=0;
  for(const patch of patches){
    const dx=x-patch.x,dz=z-patch.z;
    // Avoid clipping enlarged glades on a hard axis-aligned square.
    if(Math.abs(dx)>patch.reach || Math.abs(dz)>patch.reach)continue;
    const rx=(dx*patch.cos + dz*patch.sin)/patch.rx;
    const rz=(-dx*patch.sin + dz*patch.cos)/patch.rz;
    const d=Math.hypot(rx,rz);
    if(d>1.3)continue;
    // Lumpy boundary, but never a tiled/square clearing.
    const theta=Math.atan2(rz,rx);
    const boundary=1 + .075*Math.sin(3*theta+patch.phase) +
      .055*Math.sin(5*theta-patch.phase*.7);
    const normalized=d/boundary;
    // Broad soft shoulder: density and per-blade height already blend using
    // this weight. Inner core stays the glade's own profile; outer rim fades
    // progressively into the player's normal grass settings.
    const weight=ease(Math.max(0,Math.min(1,(1.10-normalized)/.56)));
    if(weight>out.weight){
      out.kind=patch.kind;
      out.weight=weight;
    }
  }
  return out;
}

// Density is expressed in the existing user slider's "per 1.1m cell" units.
export function gladeDensity(kind) {
  switch(kind){
    case 1:return 0;  // completely bare
    case 2:return 46; // tall and very dense
    case 3:return 42; // short and very dense
    case 4:return 2;  // short and very sparse
    default:return null;
  }
}
