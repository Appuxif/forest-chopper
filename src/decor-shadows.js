// Small decorative objects share the *cached tree* shadow pass, never the
// per-frame skinned-character pass. A cap bounds the additional draw calls.
export const DECOR_SHADOW_LIMIT=200;
export const DECOR_SHADOW_RADIUS=55;

export function selectDecorShadowCasters(chunks,x,z,
  radius=DECOR_SHADOW_RADIUS,limit=DECOR_SHADOW_LIMIT,regions=null){
  const nearby=[],radiusSq=radius*radius;
  for(const chunk of chunks.values()){
    for(const object of chunk.userData?.shadowDecor??[]){
      const bounds=object.userData?.decorBatchBounds;
      const pos=bounds??object.position;
      const dx=pos.x-x,dz=pos.z-z;
      const distance=Math.max(0,Math.hypot(dx,dz)-(bounds?.radius??0));
      const distanceSq=distance*distance;
      if(distanceSq<=radiusSq && (object.count===undefined||object.count>0))
        nearby.push({object,distanceSq});
    }
  }
  for(const region of regions?.values?.()??[]){
    for(const object of region.batch?.meshes??[]){
      const bounds=object.userData?.decorBatchBounds;
      const pos=bounds??object.position;
      const distance=Math.max(0,Math.hypot(pos.x-x,pos.z-z)-(bounds?.radius??0));
      if(distance<=radius&&object.count>0)
        nearby.push({object,distanceSq:distance*distance});
    }
  }
  nearby.sort((a,b)=>a.distanceSq-b.distanceSq);
  return nearby.slice(0,limit).map(item=>item.object);
}
