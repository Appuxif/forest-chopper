// Small decorative objects share the *cached tree* shadow pass, never the
// per-frame skinned-character pass. A cap bounds the additional draw calls.
export const DECOR_SHADOW_LIMIT=200;
export const DECOR_SHADOW_RADIUS=55;

export function selectDecorShadowCasters(chunks,x,z,
  radius=DECOR_SHADOW_RADIUS,limit=DECOR_SHADOW_LIMIT){
  const nearby=[],radiusSq=radius*radius;
  for(const chunk of chunks.values()){
    for(const object of chunk.userData?.shadowDecor??[]){
      const dx=object.position.x-x,dz=object.position.z-z;
      const distanceSq=dx*dx+dz*dz;
      if(distanceSq<=radiusSq)nearby.push({object,distanceSq});
    }
  }
  nearby.sort((a,b)=>a.distanceSq-b.distanceSq);
  return nearby.slice(0,limit).map(item=>item.object);
}
