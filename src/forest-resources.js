// Branches and stones: one-time, behind-camera generation per active 10m zone.
// The multiplayer server applies the same rules and owns pickup state.
import {createResourceZones,RESOURCE_RADIUS,RESOURCE_LIMIT,RESOURCE_UPDATE_MS} from './resource-zones.js';
export {RESOURCE_RADIUS,RESOURCE_LIMIT};
export function createForestResources(ctx){
 const {THREE,scene}=ctx;
 const models={
  branch:{geo:new THREE.CylinderGeometry(.022,.043,.67,5),
    mat:new THREE.MeshLambertMaterial({color:0x8b6844})},
  stone:{geo:new THREE.DodecahedronGeometry(.16,0),
    mat:new THREE.MeshLambertMaterial({color:0x919595})},
 };
 const dummy=new THREE.Object3D(),nodes=new Map(),meshes={};
 let lastTick=-Infinity;
 const spawner=createResourceZones();
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
  if(now-lastTick<RESOURCE_UPDATE_MS)return;
  lastTick=now;
  if(ctx.isOnline?.())return;
  if(spawner.update({x:ctx.px,z:ctx.pz,yaw:ctx.yaw})){
    nodes.clear();
    for(const item of spawner.nodes)nodes.set(item.id,item);
    refresh();
  }
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
  spawner.collect(near.id);nodes.delete(near.id);refresh();
  ctx.inventory.render();ctx.offlineSave?.markDirty?.();
  ctx.notify?.(near.kind==='branch'?'🌿 Ветка собрана':'🪨 Камень собран','success','resource-collected');
  return true;
 }
 function clear(){nodes.clear();spawner.clear();lastTick=-Infinity;refresh();}
 function dispose(){
  clear();
  for(const mesh of Object.values(meshes))scene.remove(mesh);
  for(const {geo,mat} of Object.values(models)){geo.dispose();mat.dispose();}
 }
 return {tick,set,collect,closest,clear,dispose,get count(){return nodes.size},get nodes(){return [...nodes.values()]}};
}
