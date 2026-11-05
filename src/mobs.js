import {validMobPoses,captureMobPose,applyMobPose} from './mob-pose.js';
import {createMobWorld} from './mob-world.js';
import {createMobTypeRegistry} from './mob-types.js';
import {createMobBehaviorRegistry} from './mob-ai.js';
import {createMobRagdoll} from './mob-ragdoll.js';
import {createMobRagdollProfiles} from './mob-ragdoll-profiles.js';
import {loadMobAssets} from './mob-assets.js';
import {createCorpseLootActions,hasCorpseLoot} from './corpse-loot-actions.js?v=20261105-empty-loot3';
import {createCorpseLootPanel} from './corpse-loot-ui.js?v=20261105-corpse-pointer1';
import {createCorpseLootPointer} from './corpse-loot-pointer.js?v=20261105-corpse-pointer1';
import {ITEM_STACK} from './inventory.js';
import {itemDisplayName,itemDisplayIcon} from './item-display.js';
import {shapeFootprint,shapeHeight} from './collision-world.js';
import {MOB_AXE_REACH,CORPSE_LOOT_REACH,mobInteractionPosition,prepareMobRaycast} from './mob-targeting.js';

// Animals own their skeleton/mixer, but share the loaded GPU assets.
export async function createMobs(ctx,{registry=createMobTypeRegistry(),behaviors=createMobBehaviorRegistry(),profiles=createMobRagdollProfiles(),loadAssets=loadMobAssets}={}){
 for(const type of registry.list())if(!profiles.get(type.model.ragdoll))throw new Error('Missing mob ragdoll profile: '+type.model.ragdoll);
 const {THREE}=ctx,assets=await loadAssets(THREE,registry);
 const savedPoses=new Map();
 const actors=new Map();let runningRagdolls=0;let model=null,records=[],online=false,opened=null,serverTime=0,receivedAt=0,genericNetwork=false;
 const ray=new THREE.Raycaster(),center=new THREE.Vector2(),point=new THREE.Vector3();
 const positionOf=r=>mobInteractionPosition(r,actors.get(r.id));
 const lootActions=createCorpseLootActions(ctx,{getRecord:id=>{const r=records.find(r=>r.id===id);return r?{...r,...positionOf(r)}:null;},world:ensure,validItem:item=>Object.hasOwn(ITEM_STACK,item),transport:{takePacket:(id,item)=>({type:'mob_take',id,item}),receiptField:'corpse_loot'},
  refresh(){records=ensure().tick(0,[{x:ctx.px,z:ctx.pz}],{clockRunning:false});renderPanel();}});
 const lootUI=createCorpseLootPanel({doc:document,onTake:take,onClose:close,itemLabel:id=>itemDisplayIcon(id)+' '+itemDisplayName(id)}),panel=lootUI.panel;
 const lootPointer=createCorpseLootPointer(ctx,lootUI,{positionPanel});
 const style=document.createElement('style');style.textContent=`.corpse-loot{position:fixed;z-index:1002;background:#13271ff5;color:#fff;border:1px solid #a4c19c;border-radius:12px;padding:12px;width:230px;box-sizing:border-box;max-width:calc(100vw - 16px);box-shadow:0 6px 22px #0008}.corpse-loot[hidden]{display:none!important}.corpse-loot button{min-height:38px;background:#345640;color:#fff;border:1px solid #91ac8a;border-radius:6px;margin:4px;padding:6px}.corpse-loot .corpse-loot-row{display:block;width:100%;margin:5px 0;text-align:left;background:#203e30}.corpse-loot .corpse-loot-row.selected{background:#45654b;border-color:#c4d6b0}.corpse-loot button.crosshair-hover{outline:2px solid #e3f4c4;background:#45654b}.corpse-loot h3{margin:0 0 6px}.corpse-loot p{margin:4px}`;
 document.head.append(style);
 // Keep the panel and crosshair in the same stacking context (#game).
 // A child crosshair cannot rise above a body-level fixed overlay by z-index.
 (ctx.renderer?.domElement?.parentElement??document.body).append(panel);
 for(const name of ['pointerdown','click','wheel'])panel.addEventListener(name,e=>e.stopPropagation());
 const heightAt=(x,z)=>ctx.terrain.heightAt(x,z);
 function canStand(x,z,definition){
  const body=definition.physics??{radius:.16,height:.65,maxWaterDepth:.15,stepHeight:.08};
  const y=heightAt(x,z);if((ctx.terrain.waterDepthAt?.(x,z)??0)>body.maxWaterDepth)return false;
  let blocked=false;
  ctx.collisionWorld?.forEachNear(x,z,2,s=>{
   const {top,bottom}=shapeHeight(s);
   if(shapeFootprint(s,x,z,body.radius)&&top>y+body.stepHeight&&bottom<y+body.height)blocked=true;
  },{includeTrees:true});
  return !blocked;
 }
 function ensure(){
  if(!model){model=createMobWorld({seed:ctx.seed,registry,behaviors,heightAt,canStand});
   for(const [type,asset] of assets)model.setClipDurations(type,Object.fromEntries([...asset.clips].map(([n,c])=>[n,c.duration])));
  }
  return model;
 }
 function disposeActor(id){const a=actors.get(id);if(!a)return;if(a.dead&&!a.transient){savedPoses.set(id,captureMobPose(id,a.visual));while(savedPoses.size>32)savedPoses.delete(savedPoses.keys().next().value);}a.disposed=true;if(a.physicsSlot){runningRagdolls--;a.physicsSlot=false;}a.rag?.dispose();a.mixer.stopAllAction();a.mixer.uncacheRoot(a.visual);ctx.scene.remove(a.group);actors.delete(id);}
 function clear(){for(const id of [...actors.keys()])disposeActor(id);model=null;records=[];genericNetwork=false;savedPoses.clear();lootActions.clear();close();}
 function close(){opened=null;panel.hidden=true;lootPointer.clear();}
 function setNetwork(data){
  if(data.hens&&genericNetwork)return;
  const rows=data.mobs??data.hens;if(!Array.isArray(rows))return;
  if(!online){clear();online=true;}
  if(data.mobs)genericNetwork=true;
  serverTime=data.server_time??Date.now()/1000;receivedAt=performance.now()/1000;
  records=rows.filter(r=>registry.get(r.type??'chicken')).map(h=>{const type=registry.get(h.type??'chicken');return {...h,type:type.id,displayName:type.name,category:h.category??type.category,stateStart:h.state_start??h.stateStart,deathAt:h.dead_at??h.deathAt,velocityX:h.vx??0,velocityZ:h.vz??0,hp:h.state==='dead'?0:(h.hp??h.health??type.stats.maxHealth)};});
  if(opened)renderPanel();
 }
 function targeted(deadOnly=false){
  ray.setFromCamera(center,ctx.camera);ray.far=deadOnly?10:8;
  let best=null;
  for(const r of records){
   const position=positionOf(r);
   if((r.hp<=0)!==deadOnly||Math.hypot(position.x-ctx.px,position.z-ctx.pz)>(deadOnly?CORPSE_LOOT_REACH:MOB_AXE_REACH))continue;
   const a=actors.get(r.id);if(!a)continue;
   prepareMobRaycast(a);
   const hits=ray.intersectObject(a.group,true);if(!hits.length)continue;
   const hit=hits[0];
   // Trees and placed world geometry must occlude an animal.
   const props=[...(ctx.campStructures?.items?.values?.()??[]),...(ctx.storages?.structures?.values?.()??[])];
   const blockers=[...props.map(p=>p.group).filter(Boolean),...ctx.trees.values(),...ctx.placed.map(p=>p.mesh),...[...(ctx.crafting?.items?.values?.()??[])].map(p=>p.group).filter(Boolean)];
   const obstruction=ray.intersectObjects(blockers,true)[0];
   if(obstruction&&obstruction.distance<hit.distance-.02)continue;
   if(!best||hit.distance<best.distance)best={record:r,distance:hit.distance,point:hit.point};
  }
  return best;
 }
 function hit(r){
  if(r.hp<=0||Math.hypot(r.x-ctx.px,r.z-ctx.pz)>MOB_AXE_REACH)return false;
  if(ctx.isOnline()){ctx.sendNet({type:'mob_hit',id:r.id});return true;}
  if(!ctx.vitals?.canChop||!ctx.vitals.hit())return false;
  if(!ensure().damage(r.id,(ctx.inventory?.axe?.damage??1)*(ctx.vitals?.damageMultiplier??1),{id:'local-player',kind:'player',faction:'players',x:ctx.px,z:ctx.pz,yaw:ctx.yaw}))return false;
  ctx.offlineSave?.markDirty();return true;
 }
 // A wider visual context for pursuit, never an attack target: it can only
 // suppress ground-item coloring while sprinting, without extending axe reach.
 function pursuitTarget(){
  let best=null,distance=10;
  for(const r of records){
   if(r.hp<=0)continue;
   const d=Math.hypot(r.x-ctx.px,r.z-ctx.pz);if(d>distance)continue;
   const height=registry.get(r.type)?.physics?.height??.8;
   point.set(r.x,r.y+height*.5,r.z).project(ctx.camera);
   if(point.z<=-1||point.z>=1||Math.hypot(point.x,point.y)>.4)continue;
   best=r;distance=d;
  }
  return best;
 }
 function take(id,item){return lootActions.take(id,item);}
 function acceptLoot(data){lootActions.accept(data);}
 function renderPanel(){const r=records.find(r=>r.id===opened);if(!r||!hasCorpseLoot(r)){close();return;}lootUI.render({...r,displayName:registry.get(r.type)?.name??r.displayName});}
 function open(id){
  const r=records.find(r=>r.id===id);if(!r||r.hp>0||!hasCorpseLoot(r))return false;
  opened=id;renderPanel();panel.hidden=false;return true;
 }
 function handleKey(event){
  if(!opened||panel.hidden||ctx.inventory?.isOpen||ctx.inventory?.isBookOpen||ctx.storages?.opened!=null||!['KeyE','KeyR'].includes(event.code))return false;
  if(!event.repeat){if(event.code==='KeyE')ctx.pickupInteraction.interact();else lootUI.takeAll();}
  return true;
 }
 document.addEventListener('wheel',event=>{
  if(!opened||panel.hidden)return;
  event.preventDefault();event.stopImmediatePropagation();lootUI.cycle(event.deltaY);
 },{capture:true,passive:false});
 function candidate(){
  const aimed=targeted(true);
  const r=aimed?.record??(matchMedia('(pointer:coarse)').matches?records.find(r=>{const p=positionOf(r);return r.hp<=0&&Math.hypot(p.x-ctx.px,p.z-ctx.pz)<=CORPSE_LOOT_REACH;}):null);
  if(!r)return null;
  const body=positionOf(r),p=aimed?.point??body;
  const empty=!hasCorpseLoot(r);
  return {type:'corpse',id:r.id,x:p.x,y:p.y,z:p.z,distance:Math.hypot(body.x-ctx.px,body.z-ctx.pz),maxDistance:CORPSE_LOOT_REACH,label:registry.get(r.type)?.name??'Существо',empty,verb:empty?'Пусто':'Открыть'};
 }
 function tick(dt,elapsed=dt){
  lootActions.prune();
  if(online&&!ctx.isOnline()){clear();online=false;}
  if(!online&&!ctx.isOnline())records=ensure().tick(elapsed,[{x:ctx.px,z:ctx.pz}],{clockRunning:ctx.settings.dayCycleEnabled&&!ctx.dayCycle?.frozen});
  const ids=new Set(records.map(r=>r.id));for(const id of actors.keys())if(!ids.has(id))disposeActor(id);
  for(const r of records){
   const asset=assets.get(r.type);if(!asset)continue;
   const definition=asset.definition,clips=asset.clips,speeds=asset.speeds;
   let a=actors.get(r.id);
   if(!a){const {group,visual}=asset.create(r,ctx.seed);ctx.scene.add(group);
    visual.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;n.frustumCulled=false;}});
    const mixer=new THREE.AnimationMixer(visual);a={group,visual,mixer,actions:new Map([...clips].map(([n,c])=>[n,mixer.clipAction(c)])),last:null,dead:false,rag:null,age:0,disposed:false,boundsDirty:true,transient:r.transient===true};actors.set(r.id,a);
    const profile=profiles.get(definition.model.ragdoll);
    a.bodyBone=visual.getObjectByName(profile.root??profile.segments[0].name);
    group.position.set(r.x,r.y,r.z);group.rotation.y=r.yaw??0;
    if(r.hp<=0&&savedPoses.has(r.id)){applyMobPose(visual,savedPoses.get(r.id));a.finished=true;}
   }
   if(r.hp<=0){
    if(!a.dead){a.dead=true;for(const action of a.actions.values())action.paused=true;}
    if(!a.rag&&!a.physicsSlot&&!a.finished&&runningRagdolls<8){
     a.physicsSlot=true;runningRagdolls++;const deadActor=a;
     createMobRagdoll(ctx,a.visual,{profile:profiles.get(definition.model.ragdoll),velocityX:r.velocityX,velocityZ:r.velocityZ}).then(rag=>{
      if(deadActor.disposed)rag.dispose();else deadActor.rag=rag;
     }).catch(e=>{if(deadActor.physicsSlot){runningRagdolls--;deadActor.physicsSlot=false;}deadActor.finished=true;console.error('Mob ragdoll',e);});
    }
    if(a.rag){a.age+=elapsed;if(a.age<=10){a.rag.tick(elapsed);a.bodyPosition=a.rag.position();a.boundsDirty=true;}else if(!a.finished){a.rag.dispose();a.finished=true;if(a.physicsSlot){runningRagdolls--;a.physicsSlot=false;}}}
    if(!a.bodyPosition&&a.bodyBone)a.bodyPosition=a.bodyBone.getWorldPosition(new THREE.Vector3());
    continue;
   }
   a.group.position.lerp(point.set(r.x,r.y,r.z),online?Math.min(1,dt*14):1);const delta=(r.yaw??0)-a.group.rotation.y;
   a.group.rotation.y+=Math.atan2(Math.sin(delta),Math.cos(delta))*Math.min(1,dt*14);
   const action=a.actions.get(r.state)??a.actions.get(definition.animations.idle);
   if(a.last!==action){a.last?.fadeOut(.15);action?.reset().fadeIn(.15).play();a.last=action;}
   if(action){const speed=Math.hypot(r.velocityX??0,r.velocityZ??0),base=speeds.get(r.state);
    action.setEffectiveTimeScale(base>0?speed/base:1);
    if(online&&a.lastStart!==r.stateStart){action.time=Math.max(0,serverTime+(performance.now()/1000-receivedAt)-r.stateStart)%action.getClip().duration;a.lastStart=r.stateStart;}
   }
   a.mixer.update(Math.min(.25,elapsed));
   a.boundsDirty=true;
  }
  if(opened){const r=records.find(r=>r.id===opened),body=r&&positionOf(r);if(!r||!hasCorpseLoot(r)||Math.hypot(body.x-ctx.px,body.z-ctx.pz)>3||ctx.deathSystem?.active||ctx.inventory?.isOpen||ctx.inventory?.isBookOpen){close();return;}
   if(online)renderPanel();
  }
 }

 function positionPanel(){
  const r=records.find(r=>r.id===opened);if(!r)return;
  const body=positionOf(r);point.set(body.x,body.y,body.z).project(ctx.camera);
  const locked=!!ctx.renderer?.domElement&&document.pointerLockElement===ctx.renderer.domElement;
  // With a locked cursor every row must be able to cross screen centre,
  // including on short displays; with a real cursor keep the whole card in view.
  const minX=locked?24-(panel.offsetWidth||230):8,maxX=locked?innerWidth-24:innerWidth-238;
  const minY=locked?24-panel.offsetHeight:8,maxY=locked?innerHeight-24:innerHeight-panel.offsetHeight-(matchMedia('(pointer:coarse)').matches||innerWidth<650?180:100);
  panel.style.left=`${Math.max(minX,Math.min(maxX,(point.x*.5+.5)*innerWidth+24))}px`;
  // Anchor the bottom above the corpse so the last row stays reachable near
  // the camera pitch limit and does not move down as earlier rows disappear.
  panel.style.top=`${Math.max(minY,Math.min(maxY,(-point.y*.5+.5)*innerHeight-panel.offsetHeight-48))}px`;
 }

 function spawnDebug(type,x,z,options={}){
  if(!ctx.debugCheatsController||ctx.isOnline())throw new Error('Спавн доступен только в offline debug-режиме');
  const record=ensure().spawnTransient(type,x,z,options);
  if(record)records=ensure().tick(0,[{x:ctx.px,z:ctx.pz}],{clockRunning:false});
  return record;
 }
 function clearDebug(){
  if(!ctx.debugCheatsController||ctx.isOnline())throw new Error('Спавн доступен только в offline debug-режиме');
  const ids=ensure().clearTransient();for(const id of ids){disposeActor(id);savedPoses.delete(id);if(opened===id)close();}
  records=records.filter(r=>!ids.includes(r.id));return ids.length;
 }
 return {registry,tick,clear,spawnDebug,clearDebug,setNetwork,acceptLoot,handleKey,handlePointer:lootPointer.handlePointer,updatePanelAim:lootPointer.update,get panelAimed(){return lootPointer.aimed;},takeSelected:()=>lootUI.takeSelected(),candidate,open,aimed:()=>targeted(false),pursuitTarget,hit,snapshot(){for(const [id,a] of actors)if(a.dead&&!a.transient)savedPoses.set(id,captureMobPose(id,a.visual));return {...ensure().snapshot(),poses:[...savedPoses.values()].slice(-32)};},restore(value){clear();if(value?.poses!==undefined){if(!validMobPoses(value.poses))return false;for(const p of value.poses)savedPoses.set(p.id,p);}return value?ensure().restore(value):true;},get shadowActors(){return [...actors.values()].map(a=>({group:a.group,shadowMeshes:(()=>{const meshes=[];a.visual.traverse(n=>{if(n.isMesh)meshes.push(n);});return meshes;})()}));},get records(){return records;},get opened(){return opened;}};
}
