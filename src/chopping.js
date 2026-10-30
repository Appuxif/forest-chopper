// Extracted from the original single-file game. Shared game state is passed explicitly.
export function createChopping(ctx) {
const ray=new ctx.THREE.Raycaster(),viewRay=new ctx.THREE.Raycaster();
const center=new ctx.THREE.Vector2(0,0),target=new ctx.THREE.Vector3(),origin=new ctx.THREE.Vector3();
ray.far=5.2;
function aimed(){
 if(ctx.thirdPerson){
  // Trace from the character toward the camera crosshair, so the right-shoulder
  // camera does not let the player chop a tree behind their back.
  viewRay.setFromCamera(center,ctx.camera);
  origin.set(ctx.px,ctx.feetY+1.5,ctx.pz);
  target.copy(viewRay.ray.direction).multiplyScalar(8).add(viewRay.ray.origin);
  ray.set(origin,target.sub(origin).normalize());
 }else ray.setFromCamera(center,ctx.camera);
 let best=null,dist=5.2;for(const t of ctx.trees.values()){if(Math.hypot(t.position.x-ctx.px,t.position.z-ctx.pz)>6)continue;const hits=ray.intersectObjects(t.userData.hitMeshes??t.children,false);if(hits.length&&hits[0].distance<dist){best=t;dist=hits[0].distance}}return best}
const chipGeo=new ctx.THREE.BoxGeometry(.1,.1,.1),chipMat=new ctx.THREE.MeshLambertMaterial({color:0xc59560});function spawnChips(t){for(let i=0;i<Math.min(7,Math.max(0,96-ctx.particles.length));i++){const mesh=new ctx.THREE.Mesh(chipGeo,chipMat);mesh.position.set(t.position.x+(Math.random()-.5)*.7,1.15+Math.random()*.5,t.position.z+(Math.random()-.5)*.7);ctx.scene.add(mesh);ctx.particles.push({mesh,vx:(Math.random()-.5)*3,vy:1+Math.random()*3,vz:(Math.random()-.5)*3,life:.7})}}
function chop(){if(ctx.buildMode){ctx.placeLog();return}const now=performance.now();const chopCooldown=(ctx.ownAvatar?.actions?.Chop2?.getClip().duration??(1.4166666666666667))/ctx.CHOP_SPEED*1000+35;if(now-ctx.lastHit<chopCooldown)return;ctx.lastHit=now;ctx.swing=1;ctx.actorChop(ctx.ownAvatar);const t=aimed();if(!t)return;const u=t.userData;if(ctx.isOnline()){ctx.sendNet({type:"hit",tree:u.id});return;}u.hp--;ctx.treeDamage.set(u.id,u.hp);ctx.offlineSave.markDirty();spawnChips(t);
if(u.hp<=0){ctx.detachTreeForFall?.(t);ctx.trees.delete(u.id);ctx.felled.add(u.id);ctx.treeDamage.delete(u.id);ctx.falling.push({tree:t,elapsed:0,direction:Math.atan2(ctx.px-u.x,ctx.pz-u.z)+Math.PI,removed:false});ctx.wood+=5;ctx.cuts++;ctx.tutorial.complete('tree-fell');ctx.progress.record('tree-fell');ctx.$('wood').textContent=ctx.wood;ctx.$('cut').textContent=ctx.cuts;ctx.notify('+5 🪵 Древесина', 'success', 'tree-reward');ctx.$('target').textContent='+5 🪵 Древесина';setTimeout(()=>{if(ctx.$('target').textContent.includes('+5'))ctx.$('target').textContent=''},900)}}

return {aimed, spawnChips, chop};
}
