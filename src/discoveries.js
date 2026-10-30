// Local cosmetic encounters with the existing rare frosty tree variant.
// Never changes wood/HP/seed or sends network messages.
export function createDiscoveries(ctx,{range=2.8}={}) {
  let lastCheck=-Infinity;
  function check(now){
    if(!Number.isFinite(now)||now-lastCheck<500)return;
    lastCheck=now;
    for(const tree of ctx.trees.values()){
      if(!tree.userData?.rare || tree.userData.hp<=0)continue;
      const dx=ctx.px-tree.position.x,dz=ctx.pz-tree.position.z;
      if(dx*dx+dz*dz>range*range)continue;
      const id=tree.userData.id;
      if(ctx.progress.recordDiscovery(ctx.seed,id)){
        ctx.notify(`✨ Найдено серебристое ${tree.userData.species==='birch'?'дерево (берёза)':'дерево'}!`,
          'success','rare-discovery-'+id);
      }
    }
  }
  return {check};
}
