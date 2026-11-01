// Geometry-driven collision for player-built structures.
// Each model can register local AABB primitives on group.userData.collisionBoxes.
// They are independent from Three.js rendering, reusable for future buildings,
// and rotated by the structure's quarter-turn orientation.
export function forEachStructureBox(structures,terrain,x,z,visit){
  if(!structures)return;
  for(const structure of structures){
    const shapes=structure.group?.userData?.collisionBoxes;
    if(!shapes?.length)continue;
    const radius=structure.group.userData.collisionRadius??3;
    if(Math.abs(x-structure.x)>radius||Math.abs(z-structure.z)>radius)continue;
    const angle=(structure.orientation??0)&3;
    const dx=x-structure.x,dz=z-structure.z;
    // Inverse quarter-turn world -> local, matching THREE.Group.rotation.y.
    const lx=angle===0?dx:angle===1?-dz:angle===2?-dx:dz;
    const lz=angle===0?dz:angle===1?dx:angle===2?-dz:-dx;
    const ground=structure.group.position.y;
    for(const box of shapes)visit(box,lx,lz,ground);
  }
}

function overlaps(box,x,z,radius){
  const dx=Math.max(Math.abs(x-box.x)-box.w/2,0);
  const dz=Math.max(Math.abs(z-box.z)-box.d/2,0);
  return dx*dx+dz*dz<radius*radius;
}

export function structureBlocksPlayer(structures,terrain,x,z,feet,radius,height){
  let blocked=false;
  forEachStructureBox(structures,terrain,x,z,(b,lx,lz,base)=>{
    if(blocked||!overlaps(b,lx,lz,radius))return;
    const bottom=base+b.y-b.h/2,top=base+b.y+b.h/2;
    if(feet<top-.045&&feet+height>bottom+.045)blocked=true;
  });
  return blocked;
}

export function highestStructureSupport(structures,terrain,x,z,previous,next,radius,baseline=-Infinity){
  let support=baseline;
  forEachStructureBox(structures,terrain,x,z,(b,lx,lz,base)=>{
    if(!overlaps(b,lx,lz,radius*.25))return;
    const top=base+b.y+b.h/2;
    if(previous>=top-.09&&next<=top+.02&&top>support)support=top;
  });
  return support;
}

export function standingOnStructure(structures,terrain,x,z,feet,radius){
  let standing=false;
  forEachStructureBox(structures,terrain,x,z,(b,lx,lz,base)=>{
    if(!standing&&overlaps(b,lx,lz,radius*.25)&&
      Math.abs(base+b.y+b.h/2-feet)<.08)standing=true;
  });
  return standing;
}

export function structureCeiling(structures,terrain,x,z,previous,next,radius,height){
  let ceiling=Infinity;
  forEachStructureBox(structures,terrain,x,z,(b,lx,lz,base)=>{
    if(!overlaps(b,lx,lz,radius*.85))return;
    const bottom=base+b.y-b.h/2;
    if(previous+height<=bottom+.01&&next+height>bottom)
      ceiling=Math.min(ceiling,bottom-height-.012);
  });
  return ceiling;
}
