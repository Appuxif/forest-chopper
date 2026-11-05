export const MOB_AXE_REACH=2.6;
export const CORPSE_LOOT_REACH=2.8;

// Ragdoll moves bones, not the actor group or the simulation's death record.
export function mobInteractionPosition(record,actor){
 return record.hp<=0&&actor?.bodyPosition?actor.bodyPosition:record;
}

// Three caches SkinnedMesh bounds. Invalidate them with the pose, without
// changing shared geometry or doing a vertex scan for every distant animal.
export function prepareMobRaycast(actor){
 actor.group.updateMatrixWorld(true);
 if(!actor.boundsDirty)return;
 actor.visual.traverse(mesh=>{
  if(!mesh.isSkinnedMesh)return;
  mesh.computeBoundingSphere();
  if(mesh.boundingBox!==null)mesh.computeBoundingBox();
 });
 actor.boundsDirty=false;
}
