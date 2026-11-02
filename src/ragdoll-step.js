// Keep fixed-step simulation separate so a WASM failure can be handled by
// the owner without leaving the requestAnimationFrame loop crashing forever.
export const RAGDOLL_FIXED_STEP=1/60;
export function stepRagdollPhysics(instance,dt){
  instance.accumulator=Math.min(.15,instance.accumulator+Math.max(0,dt));
  let steps=0;
  while(instance.accumulator>=RAGDOLL_FIXED_STEP&&steps<7){
    instance.world.step();
    steps++;
    instance.accumulator-=RAGDOLL_FIXED_STEP;
    instance.elapsed+=RAGDOLL_FIXED_STEP;
  }
  if(steps)instance.settling?.tick(steps*RAGDOLL_FIXED_STEP);
  return steps;
}
