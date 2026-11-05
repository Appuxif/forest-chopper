import {chopContactReached} from './chop-timing.js';
import {TREE_LOG_COUNT} from './ground-boxes.js';
import {isStructureItem} from './structure-items.js';
import {isFood} from './vitals.js';
// Extracted from the original single-file game. Shared game state is passed explicitly.
export function createChopping(ctx) {
const ray=new ctx.THREE.Raycaster(),viewRay=new ctx.THREE.Raycaster();
const center=new ctx.THREE.Vector2(0,0),target=new ctx.THREE.Vector3(),origin=new ctx.THREE.Vector3();
ray.far=5.2;
let pendingSwing=null;
// Client-side chips at the contact frame; the server still owns actual HP.
const predictedChips=new Map();
function acknowledgeLocalChop(id,by){
 if(!Number.isInteger(by)||by!==ctx.myId)return false;
 const queue=predictedChips.get(id);
 if(!queue?.length)return false;
 const at=queue.shift();
 if(!queue.length)predictedChips.delete(id);
 return performance.now()-at<5000;
}
function resetChop(){pendingSwing=null;predictedChips.clear();}
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
function chop(){
 if((ctx.mobs??ctx.hens)?.panelAimed)return;
 // A mouse click may be needed to acquire pointer lock while lying down.
 // It must never launch Chop2 or interact with the world before getting up.
 if(ctx.deathSystem?.active || ctx.ragdoll?.active || ctx.ragdollControls?.busy ||
    (ctx.ragdollControls?.mode && ctx.ragdollControls.mode!=='none'))return;
 if(ctx.inventory){
   const selected=ctx.inventory.state.quickItem(ctx.inventory.state.selectedQuick)?.id;
   if(isFood(selected)){
     ctx.vitals?.consume(ctx.inventory.state.selectedSlot());return;
   }
 }
 if(ctx.inventory?.selected==='log'){ctx.placeLog();return;}
 if(ctx.inventory?.selected==='bench'){ctx.crafting?.placeItem();return;}
 if(isStructureItem(ctx.inventory?.selected)){
   const kind=ctx.inventory.selected;
   if(['chest','rack'].includes(kind))ctx.storages?.place(kind);
   else ctx.campStructures?.place(kind);
   return;
 }
 if(ctx.buildMode&&!ctx.inventory){ctx.placeLog();return;}
if(ctx.inventory&&!ctx.inventory.equipped){ctx.notify?.('Выбери топор в быстром слоте (1–4)','warning','no-axe');return;}
if(ctx.vitals&&!ctx.vitals.canChop&&aimed()){
 ctx.notify?.(ctx.vitals.chopWarning(),'warning','vitals-chop');return;
}
const now=performance.now();
const axeSpeed=Math.max(.1,ctx.inventory?.axe?.speed??1);
const playbackSpeed=(ctx.CHOP_SPEED??1.6)*axeSpeed;
const chopCooldown=(ctx.ownAvatar?.actions?.Chop2?.getClip().duration??1.7916667)/playbackSpeed*1000+35;
if(pendingSwing||now-ctx.lastHit<chopCooldown)return;
ctx.lastHit=now;
ctx.swing=1;
ctx.actorChop(ctx.ownAvatar,axeSpeed);
const t=aimed();
 if(!t && ctx.inventory?.equipped){
   const fx=-Math.sin(ctx.yaw),fz=-Math.cos(ctx.yaw);
   const hit=(x,z)=>{const dx=x-ctx.px,dz=z-ctx.pz,dist=dx*fx+dz*fz;
     return dist>0&&dist<5.5&&Math.abs(dx*fz-dz*fx)<1.25?dist:Infinity;};
   let best=null;
   for(const entry of ctx.crafting?.items?.values()??[]){
     const d=hit(entry.x,entry.z);if(d<(best?.d??Infinity))best={kind:'bench',id:entry.id,d};
   }
   for(const entry of ctx.campStructures?.items?.values()??[]){
     const d=hit(entry.x,entry.z);
     if(d<(best?.d??Infinity))best={kind:'camp',id:entry.id,d};
   }
   for(const entry of ctx.storages?.structures?.values()??[]){
     const d=hit(entry.x,entry.z);
     if(d<(best?.d??Infinity))best={kind:'storage',id:entry.id,d};
   }
   for(const entry of ctx.placed??[]){
     const d=hit(entry.x,entry.z);if(d<(best?.d??Infinity))best={kind:'log',id:entry.id,d,entry};
   }
   if(best){
     if(best.kind==='bench'){ctx.crafting?.dismantle(best.id);return;}
     if(best.kind==='camp'){ctx.campStructures?.dismantle(best.id);return;}
     if(best.kind==='storage'){ctx.storages?.dismantle(best.id);return;}
     if(ctx.inventory.state.freeLogs()<1){ctx.notify('Сумка заполнена или превышен лимит 100 кг','warning');return;}
     if(ctx.isOnline()){
       if(best.id!=null)ctx.sendNet({type:'hit_structure',kind:'log',id:best.id});
     }else{
       const index=ctx.placed.indexOf(best.entry);if(index>=0&&ctx.inventory.state.addLogs(1)===1){
         ctx.scene.remove(best.entry.mesh);ctx.placed.splice(index,1);ctx.collisionWorld?.invalidate?.();ctx.wood=ctx.inventory.state.wood();
         ctx.inventory.render();
         ctx.atmosphere?.invalidateStaticShadows?.();
         ctx.offlineSave.markDirty();ctx.notify('🪵 Бревно возвращено в сумку','success');
       }
     }
     return;
   }
 }
 // Aim is only evaluated at the actual frame-18 impact, not locked
 // when clicking. An empty-space swing can hit a tree acquired mid-swing,
 // or switch from tree A to B before the axe makes contact.
 pendingSwing={startedAt:now,playbackSpeed};
}
function tickImpact(now=performance.now(),currentMobTarget=undefined){
 if(!pendingSwing)return false;
 if((ctx.mobs??ctx.hens)?.panelAimed||ctx.deathSystem?.active||ctx.ragdoll?.active||ctx.ragdollControls?.busy||
    (ctx.ragdollControls?.mode&&ctx.ragdollControls.mode!=='none')){
   pendingSwing=null;return false;
 }
 const action=ctx.ownAvatar?.upper?.Chop2??ctx.ownAvatar?.actions?.Chop2;
 if(!chopContactReached(action,pendingSwing.startedAt,now,pendingSwing.playbackSpeed))return false;
 pendingSwing=null; // Exactly once, even if the animation remains on frame 18.
 // Whichever tree the crosshair points at now receives the hit.
 // No tree under the crosshair = a clean miss.
 // The player loop already resolved this frame's reticle before damage.
 // Standalone callers still resolve a fresh target at the contact frame.
 const mobs=ctx.mobs??ctx.hens,target=currentMobTarget===undefined?mobs?.aimed?.():currentMobTarget;
 if(target){return mobs.hit(target.record);}
 const t=aimed();
 if(!t)return false;
 if(ctx.vitals&&!ctx.vitals.canChop){
   ctx.notify?.(ctx.vitals.chopWarning(),'warning','vitals-chop');return false;
 }
 const u=t.userData;
 if(ctx.isOnline()){
   // Give the local player immediate chips + sound on frame 18 while the
   // authoritative tree HP is confirmed by the server a little later.
   ctx.audio?.effect('axe');spawnChips(t);
   const chipNow=performance.now();
   const queue=(predictedChips.get(u.id)??[]).filter(at=>chipNow-at<5000);
   queue.push(chipNow);predictedChips.set(u.id,queue);
   ctx.sendNet({type:'hit',tree:u.id});
   return true;
 }
 if(ctx.vitals&&!ctx.vitals.hit())return;
 ctx.audio?.effect('axe');
 u.hp-=(ctx.inventory?.axe?.damage??1)*(ctx.vitals?.damageMultiplier??1);ctx.treeDamage.set(u.id,u.hp);ctx.offlineSave.markDirty();spawnChips(t);
if(u.hp<=0){
  // Cutting never adds to the inventory. All three logs remain on the ground even
  // if the backpack has no room; each E/touch pickup is checked separately.
  const direction=Math.atan2(ctx.px-u.x,ctx.pz-u.z)+Math.PI;
  if(!ctx.groundBoxes?.spawnFallenLogs(u.x,u.z,TREE_LOG_COUNT,
    {direction,tree:u.id,pending:true})){
    u.hp=1;ctx.treeDamage.set(u.id,1);
    ctx.notify?.('Слишком много предметов на земле — подбери часть брёвен','warning','ground-full');
    return;
  }
  ctx.detachTreeForFall?.(t);ctx.trees.delete(u.id);ctx.collisionWorld?.invalidate?.();ctx.felled.add(u.id);ctx.treeDamage.delete(u.id);
  ctx.falling.push({tree:t,elapsed:0,direction,removed:false});
  ctx.audio?.effect('treeFall');
  ctx.cuts++;ctx.tutorial.complete('tree-fell');ctx.progress.record('tree-fell');
  ctx.$('cut').textContent=ctx.cuts;
  ctx.notify('🪵 '+TREE_LOG_COUNT+' бревна на земле — подбери их (E)','success','tree-reward');
  ctx.$('target').textContent='🪵 '+TREE_LOG_COUNT+' бревна на земле';
  setTimeout(()=>{if(ctx.$('target').textContent==='🪵 '+TREE_LOG_COUNT+' бревна на земле')ctx.$('target').textContent=''},1400);
}
 return true;
}

return {aimed, spawnChips, chop, tickImpact,acknowledgeLocalChop,resetChop};
}
