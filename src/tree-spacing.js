// Stateless deterministic thinning: the same seed yields the same forest
// regardless of chunk streaming order or whether neighboring trees were felled.
export const TREE_MIN_DISTANCE = 4;
export const TREES_PER_CHUNK = 8;

export function treeCandidate(cx,cz,i,rand,size=24) {
  const x=cx*size+rand(cx,cz,i*3)*size;
  const z=cz*size+rand(cx,cz,i*3+1)*size;
  return Math.hypot(x,z)<8?null:{x,z};
}

export function treeCanSpawn(cx,cz,i,rand,size=24,distance=TREE_MIN_DISTANCE) {
  const point=treeCandidate(cx,cz,i,rand,size);
  if(!point)return false;
  const priority=rand(cx,cz,2000+i),minimum=distance*distance;
  // Only 3x3 chunks can have overlapping candidates. Stable priorities
  // resolve collisions without depending on which chunk loads first.
  for(let nx=cx-1;nx<=cx+1;nx++){
    for(let nz=cz-1;nz<=cz+1;nz++){
      for(let j=0;j<TREES_PER_CHUNK;j++){
        if(nx===cx&&nz===cz&&j===i)continue;
        const other=treeCandidate(nx,nz,j,rand,size);
        if(!other)continue;
        const dx=other.x-point.x,dz=other.z-point.z;
        if(dx*dx+dz*dz>=minimum)continue;
        const theirs=rand(nx,nz,2000+j);
        if(theirs<priority ||
          (theirs===priority &&
            (nx<cx || (nx===cx&&(nz<cz || (nz===cz&&j<i))))))
          return false;
      }
    }
  }
  return true;
}
