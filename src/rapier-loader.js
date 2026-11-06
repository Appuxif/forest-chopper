// Shared by every ragdoll. Start during world loading, never in the main menu.
const RAPIER_URL='https://esm.sh/@dimforge/rapier3d-compat@0.21.0?bundle';
export function createPhysicsLoader(importPhysics){
 let pending=null;
 return ()=>{
  if(pending)return pending;
  const promise=Promise.resolve().then(importPhysics).then(async module=>{
   const physics=module.default??module;
   if(typeof physics.init==='function')await physics.init();
   return physics;
  });
  pending=promise;
  promise.catch(()=>{if(pending===promise)pending=null;});
  return promise;
 };
}
export const loadRagdollPhysics=createPhysicsLoader(()=>import(RAPIER_URL));
