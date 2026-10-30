// Cheap, root-anchored plant bending. Only decor in 3x3 nearby chunks is
// inspected; the active set holds a few stems until they spring upright.
export function createPlantInteraction(ctx) {
  const active=new Set();
  function tick(dt) {
    const alpha=1-Math.exp(-Math.max(0,Math.min(.05,dt))*9);
    if(!alpha)return;
    const players=[{x:ctx.px,z:ctx.pz}];
    for(const avatar of ctx.avatars?.values?.()??[]){
      const pos=avatar.group?.position;
      if(pos && Math.hypot(pos.x-ctx.px,pos.z-ctx.pz)<4 && players.length<7)
        players.push(pos);
    }
    const nearby=new Set();
    const cx=Math.floor(ctx.px/ctx.chunkSize),cz=Math.floor(ctx.pz/ctx.chunkSize);
    for(let ox=-1;ox<=1;ox++)for(let oz=-1;oz<=1;oz++){
      const group=ctx.chunks.get((cx+ox)+','+(cz+oz));
      for(const plant of group?.userData?.reactivePlants??[]){
        const excluded=(group.userData?.grassClearings??[]).some(area=>
          (plant.position.x-area.x)**2+(plant.position.z-area.z)**2<area.radius**2)
          || [...(ctx.crafting?.items?.values?.()??[])].some(bench=>
            (plant.position.x-bench.x)**2+(plant.position.z-bench.z)**2<1.55**2);
        plant.visible=!excluded;
        if(excluded){active.delete(plant);plant.rotation.x=plant.rotation.z=0;continue;}
        const radius=plant.userData.decorType==='flower'?1.15:1.5;
        let closest=radius*radius,px=0,pz=0;
        for(const player of players){
          const dx=plant.position.x-player.x,dz=plant.position.z-player.z;
          const distSq=dx*dx+dz*dz;
          if(distSq<closest){closest=distSq;px=dx;pz=dz;}
        }
        if(closest===radius*radius)continue;
        nearby.add(plant);
        active.add(plant);
        const distance=Math.sqrt(closest);
        const strength=(1-distance/radius)*(plant.userData.decorType==='flower'?.42:.24);
        // Keep roots fixed: local X tilt bends towards +/- Z, Z towards -/+ X.
        const angle=Math.atan2(pz,px)+plant.rotation.y;
        const xTilt=Math.sin(angle)*strength;
        const zTilt=-Math.cos(angle)*strength;
        plant.rotation.x+=(xTilt-plant.rotation.x)*alpha;
        plant.rotation.z+=(zTilt-plant.rotation.z)*alpha;
      }
    }
    for(const plant of active){
      if(nearby.has(plant))continue;
      plant.rotation.x*=1-alpha;
      plant.rotation.z*=1-alpha;
      if(Math.abs(plant.rotation.x)+Math.abs(plant.rotation.z)<.002){
        plant.rotation.x=0;plant.rotation.z=0;active.delete(plant);
      }
    }
  }
  function clear(){
    for(const plant of active){plant.rotation.x=0;plant.rotation.z=0;}
    active.clear();
  }
  return {tick,clear};
}
