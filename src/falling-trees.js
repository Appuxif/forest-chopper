import {FALL_DURATION} from './fallen-log-layout.js';

// The standing tree remains visible through the entire fall. Only after the
// original mesh is removed can the fixed three-segment trunk become pickupable.
export function tickFallingTrees(ctx,dt){
  for(let i=ctx.falling.length-1;i>=0;i--){
    const f=ctx.falling[i];
    f.elapsed+=dt;
    const a=Math.min(1,f.elapsed/1.8);
    const angle=a*a*(Math.PI/2);
    // One tilt axis keeps the trunk aligned with its future log segments,
    // including diagonal directions (two Euler tilts would bend the heading).
    if(ctx.THREE?.Vector3&&f.tree.quaternion?.setFromAxisAngle){
      f.axis??=new ctx.THREE.Vector3(Math.cos(f.direction),0,Math.sin(f.direction));
      f.tree.quaternion.setFromAxisAngle(f.axis,angle);
    }else{
      f.tree.rotation.z=Math.sin(f.direction)*angle;
      f.tree.rotation.x=Math.cos(f.direction)*angle;
    }
    if(f.elapsed>FALL_DURATION){
      ctx.scene.remove(f.tree);
      ctx.falling.splice(i,1);
      ctx.groundBoxes?.revealTree(f.tree.userData?.id);
    }
  }
}
