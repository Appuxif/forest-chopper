// Single persistent guide ring. Never modifies tree/bench materials or mesh scales.
export function createInteractionHighlight(ctx) {
  const THREE=ctx.THREE;
  const geometry=new THREE.RingGeometry(.7,.83,32);
  const material=new THREE.MeshBasicMaterial({
    color:0xa9f2b8,side:THREE.DoubleSide,
    transparent:true,opacity:.55,depthWrite:false,
  });
  const mesh=new THREE.Mesh(geometry,material);
  mesh.rotation.x=-Math.PI/2;
  mesh.visible=false;
  mesh.position.y=.065;
  mesh.renderOrder=2;
  ctx.scene.add(mesh);
  let previous='';
  function update(tree=null){
    let target=null,kind='';
    if(ctx.buildMode){
      const p=ctx.candidate();
      const bench=[...(ctx.crafting?.items?.values()??[])]
        .filter(b=>Math.hypot(b.x-p.x,b.z-p.z)<2.4)
        .sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
      if(bench){target={x:bench.x,z:bench.z};kind='bench';}
    } else if(tree?.userData?.hp>0){
      target=tree.position;kind='tree';
    }
    if(!target){
      mesh.visible=false;previous='';return false;
    }
    mesh.position.set(target.x,.065,target.z);
    mesh.scale.setScalar(kind==='bench'?1.45:1);
    if(previous!==kind){
      material.color.setHex(kind==='bench'?0xf7d58f:0xa9f2b8);
      previous=kind;
    }
    mesh.visible=true;
    return true;
  }
  function clear(){mesh.visible=false;previous='';}
  return {update,clear,mesh};
}
