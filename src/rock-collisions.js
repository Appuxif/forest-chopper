// Local-only collisions for deterministic decorative rocks. The renderer owns
// meshes; physics keeps tiny shapes indexed by their generating world chunk.
export function rockFootprint(rock, x, z, margin=0) {
  const radius=Math.max(0,rock.radius+margin);
  const dx=x-rock.x,dz=z-rock.z;
  return dx*dx+dz*dz<radius*radius;
}

export function nearbyRocks(chunks, chunkSize, x, z, visit) {
  if(!chunks || !Number.isFinite(chunkSize) || chunkSize<=0)return;
  const cx=Math.floor(x/chunkSize),cz=Math.floor(z/chunkSize);
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
    const rocks=chunks.get((cx+dx)+','+(cz+dz));
    if(!rocks)continue;
    for(const rock of rocks)visit(rock);
  }
}

export function rockBlocksPlayer(rocks, chunkSize, x, z, feet, playerRadius, playerHeight) {
  let blocked=false;
  nearbyRocks(rocks,chunkSize,x,z,rock=>{
    if(rockFootprint(rock,x,z,playerRadius) &&
      feet<rock.top-.045 && feet+playerHeight>rock.bottom+.045)blocked=true;
  });
  return blocked;
}

// A conservative horizontal platform on the faceted boulder's upper surface.
// Works with both jumping and simply walking off a rock.
export function highestRockSupport(rocks,chunkSize,x,z,previous,next,playerRadius) {
  let highest=0;
  nearbyRocks(rocks,chunkSize,x,z,rock=>{
    if(!rockFootprint(rock,x,z,playerRadius*.25))return;
    const top=rock.top;
    if(previous>=top-.09 && next<=top+.02 && top>highest)highest=top;
  });
  return highest;
}

export function standingOnRock(rocks,chunkSize,x,z,feet,playerRadius) {
  let supported=false;
  nearbyRocks(rocks,chunkSize,x,z,rock=>{
    if(rockFootprint(rock,x,z,playerRadius*.25) &&
      Math.abs(rock.top-feet)<.08)supported=true;
  });
  return supported;
}
