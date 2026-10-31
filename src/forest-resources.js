// Branches and stones are ephemeral, NOT seeded and NOT part of saved worlds.
// Offline: random spots are replenished near the player every ~3 seconds.
// Multiplayer: the server generates each player's own nearby spots and grants pickups.
export const RESOURCE_RADIUS=10;
export const RESOURCE_LIMIT=10;
export function createForestResources(ctx){
 const {THREE,scene}=ctx;
 const models={
  branch:{geo:new THREE.CylinderGeometry(.022,.043,.67,5),
    mat:new THREE.MeshLambertMaterial({color:0x8b6844})},
  stone:{geo:new THREE.DodecahedronGeometry(.16,0),
    mat:new THREE.MeshLambertMaterial({color:0x919595})},
 };
 const dummy=new THREE.Object3D(),nodes=new Map(),meshes={};
 let lastTick=-Infinity,sequence=0;
 for(const [kind,{geo,mat}] of Object.entries(models)){
  const mesh=new THREE.InstancedMesh(geo,mat,RESOURCE_LIMIT);
  mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=false;
  scene.add(mesh);meshes[kind]=mesh;
 }
 function refresh(){
  for(const kind of ['branch','stone']){
   const mesh=meshes[kind];let index=0;
   for(const node of nodes.values()){
    if(node.kind!==kind)continue;
    dummy.position.set(node.x,node.kind==='branch'?.10:.17,node.z);
    dummy.rotation.set(node.kind==='branch'?Math.PI/2:0,node.kind==='branch'?node.id*.79:0,node.kind==='stone'?node.id*.47:0);
    dummy.scale.setScalar(node.kind==='stone'?.7+(node.id%4)*.13:1);
    dummy.updateMatrix();
    mesh.setMatrixAt(index++,dummy.matrix);
   }
   mesh.count=index;mesh.instanceMatrix.needsUpdate=true;
  }
 }
 function set(resources){
  nodes.clear();
  for(const r of resources??[]){
   if(!Number.isInteger(r.id)||!['branch','stone'].includes(r.kind)
     ||!Number.isFinite(r.x)||!Number.isFinite(r.z)||nodes.size>=RESOURCE_LIMIT)continue;
   nodes.set(r.id,{id:r.id,kind:r.kind,x:r.x,z:r.z});
  }
  refresh();
 }
 function tick(now=performance.now()){
  if(now-lastTick<2900)return;
  lastTick=now;
  if(ctx.isOnline?.())return;
  for(const [id,r] of nodes)if(Math.hypot(r.x-ctx.px,r.z-ctx.pz)>RESOURCE_RADIUS)nodes.delete(id);
  while(nodes.size<RESOURCE_LIMIT){
   const angle=Math.random()*Math.PI*2,dist=2.5+Math.random()*5.8;
   const kind=Math.random()<.53?'branch':'stone';
   nodes.set(++sequence,{id:sequence,kind,x:ctx.px+Math.cos(angle)*dist,z:ctx.pz+Math.sin(angle)*dist});
  }
  refresh();
 }
 function closest(max=2.4){
  let best=null,dist=max;
  for(const n of nodes.values()){
   const d=Math.hypot(n.x-ctx.px,n.z-ctx.pz);
   if(d<dist){best=n;dist=d;}
  }
  return best?{...best,distance:dist}:null;
 }
 function collect(){
  const near=closest();if(!near)return false;
  if(ctx.isOnline?.()){ctx.sendNet?.({type:'collect_resource',id:near.id});return true;}
  if(!ctx.inventory?.state.addItem({id:near.kind,count:1})){
   ctx.notify?.('Сумка заполнена','warning','resource-full');return false;
  }
  nodes.delete(near.id);refresh();
  ctx.inventory.render();ctx.offlineSave?.markDirty?.();
  ctx.notify?.(near.kind==='branch'?'🌿 Ветка собрана':'🪨 Камень собран','success','resource-collected');
  return true;
 }
 function clear(){nodes.clear();lastTick=-Infinity;refresh();}
 function dispose(){
  clear();
  for(const mesh of Object.values(meshes))scene.remove(mesh);
  for(const {geo,mat} of Object.values(models)){geo.dispose();mat.dispose();}
 }
 return {tick,set,collect,closest,clear,dispose,get count(){return nodes.size},get nodes(){return [...nodes.values()]}};
}
