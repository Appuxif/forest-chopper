// Normal-game interaction: voluntary ragdoll, getting up with Jump and sleeping.
// No death or item logic lives here.
export function bedRestPose(bed,groundY){
 const yaw=(bed.orientation??0)*Math.PI/2;
 const rotation=yaw+Math.PI;
 // The head points towards the pillow at local z=-.62 and the feet to +z.
 const offset=.60;
 return {x:bed.x+Math.sin(yaw)*offset,y:groundY+.72,
   z:bed.z+Math.cos(yaw)*offset,rotation,
   wakeX:bed.x+Math.sin(yaw)*1.48,
   wakeZ:bed.z+Math.cos(yaw)*1.48};
}

export function createRagdollControls(ctx,doc=document){
 let mode='none',busy=false,bed=null;
 const css=doc.createElement('style');
 css.textContent=`
 #fc-ragdoll-btn{position:fixed;z-index:13;right:24px;bottom:246px;
 padding:9px 13px;border:1px solid #aac0a0a8;border-radius:11px;
 color:#eef8ea;background:#213d30e8;font:600 13px system-ui;
 cursor:pointer;touch-action:manipulation;box-shadow:0 3px 10px #0006}
 #fc-ragdoll-btn:disabled{opacity:.55;cursor:default}
 @media(max-width:650px){#fc-ragdoll-btn{right:16px;bottom:225px;font-size:12px;padding:9px}}
 `;
 doc.head.append(css);
 const button=doc.createElement('button');
 button.id='fc-ragdoll-btn';button.type='button';button.textContent='🦴 Ragdoll';
 button.title='Упасть на землю. Встать — Space или кнопка прыжка';
 doc.body.append(button);
 function refresh(){
  button.disabled=busy||ctx.deathSystem?.active===true||mode!=='none';
  button.textContent=busy?'🦴 …':'🦴 Ragdoll';
  button.hidden=mode!=='none'||ctx.deathSystem?.active===true;
 }
 async function ragdoll({impactSpeed=0}={}){
  if(busy||mode!=='none'||ctx.deathSystem?.active||ctx.ragdoll?.active)return false;
  busy=true;refresh();
  try{
   await ctx.ragdoll.trigger({allowOnline:true,impactSpeed});
   mode='manual';return true;
  }catch(error){console.warn('Manual ragdoll failed:',error);ctx.notify?.('Не удалось включить Ragdoll','warning');return false;}
  finally{busy=false;refresh();}
 }
 async function sleepInBed(item){
  if(busy||mode!=='none'||ctx.deathSystem?.active||ctx.ragdoll?.active||item?.kind!=='bed')return false;
  if(Math.hypot(ctx.px-item.x,ctx.pz-item.z)>3.2)return false;
  busy=true;refresh();
  const original={x:ctx.px,z:ctx.pz,y:ctx.feetY,yaw:ctx.yaw,
    rotation:ctx.ownAvatar?.group?.quaternion?.clone?.(),
    position:ctx.ownAvatar?.group?.position?.clone?.()};
  try{
   const pose=bedRestPose(item,ctx.terrain.heightAt(item.x,item.z));
   await ctx.ragdoll.trigger({allowOnline:true,bed:item,restPose:pose});
   if(ctx.deathSystem?.active){
     ctx.ragdoll.reset();
     return false;
   }
   bed={item,pose};
   mode='sleep';
   ctx.fallTracker?.reset?.();
   // Bed spawn is selected only once lying on the bed actually succeeded.
   ctx.deathSystem?.setBed?.(item.id);
   if(!ctx.isOnline?.()){
     // Offline camera/save follow the bed. In multiplayer, the server owns
     // movement: keep logical position unchanged until pose replication exists.
     ctx.px=pose.x;ctx.pz=pose.z;
     ctx.feetY=ctx.terrain.heightAt(pose.x,pose.z);
     ctx.verticalSpeed=0;ctx.onGround=true;
   }
   ctx.notify?.('💤 Вы легли спать. Встать — прыжок','info','sleep-bed');
   return true;
  }catch(error){
   ctx.ragdoll?.reset?.();
   if(original.position&&ctx.ownAvatar)ctx.ownAvatar.group.position.copy(original.position);
   if(original.rotation&&ctx.ownAvatar)ctx.ownAvatar.group.quaternion.copy(original.rotation);
   ctx.px=original.x;ctx.pz=original.z;ctx.feetY=original.y;ctx.yaw=original.yaw;
   console.warn('Bed ragdoll failed:',error);
   ctx.notify?.('Не удалось лечь на кровать','warning');
   return false;
  }finally{busy=false;refresh();}
 }
 function syncPose(){
  // Only offline manual falls move the logical player. In multiplayer the
  // server owns coordinates; bed poses and death have their own controllers.
  if(mode!=='manual'||ctx.isOnline?.())return false;
  const pose=ctx.ragdoll?.pose?.();
  if(!pose)return false;
  ctx.px=pose.x;ctx.pz=pose.z;
  ctx.feetY=Math.max(ctx.terrain.heightAt(pose.x,pose.z),pose.feetY);
  ctx.verticalSpeed=Math.min(0,pose.vy);
  ctx.onGround=false;
  return true;
 }
 function getUp(){
  if(ctx.deathSystem?.active)return false;
  if(busy)return true; // suppress actual jump while physical bodies are initializing
  if(mode==='none'&&!ctx.ragdoll?.active)return false;
  // Capture the *current* physical position before reset restores the old
  // animation root. Otherwise jumping from a ramp repeats the same fall.
  const landing=mode==='manual'&&!ctx.isOnline?.()?ctx.ragdoll?.pose?.():null;
  ctx.ragdoll?.reset?.();
  if(landing){
   ctx.px=landing.x;ctx.pz=landing.z;
   const support=ctx.ragdollStandingSupport?.(landing.x,landing.z,landing.hipsY)
     ??ctx.terrain.heightAt(landing.x,landing.z);
   ctx.onGround=landing.hipsY<=support+landing.standingHipOffset+.15;
   ctx.feetY=ctx.onGround?support:Math.max(support,landing.feetY);
   // If released midair, keep falling with the body's actual velocity.
   ctx.verticalSpeed=ctx.onGround?0:Math.min(0,landing.vy);
  }
  if(mode==='sleep'&&bed){
   ctx.fallTracker?.reset?.();
   const {pose}=bed;
   if(!ctx.isOnline?.()){
     ctx.px=pose.wakeX;ctx.pz=pose.wakeZ;
     ctx.feetY=ctx.terrain.heightAt(ctx.px,ctx.pz);
     ctx.verticalSpeed=0;ctx.onGround=true;
     ctx.yaw=pose.rotation-Math.PI;
   }
  }
  // Ragdoll restores the actor's *old* facing quaternion. Looking around
  // while lying down updates ctx.yaw, so always align the animated root with
  // the live camera yaw on wake, including manual falls (not just beds).
  ctx.jumpRequested=false;
  if(ctx.ownAvatar){
   ctx.ownAvatar.group.position.set(ctx.px,ctx.feetY,ctx.pz);
   ctx.ownAvatar.group.rotation.set(0,ctx.yaw,0);
   ctx.ownAvatar.group.updateMatrixWorld?.(true);
  }
  // Preserve the peak if Space was pressed in midair, so the remaining
  // descent still receives fall damage. An already-resolved bounce remains
  // locked until it returns to ground; a grounded get-up permits new falls.
  if(mode==='manual'&&ctx.onGround)ctx.fallTracker?.reset?.();
  mode='none';bed=null;refresh();
  return true;
 }
 function clearForDeath(){mode='none';bed=null;refresh();}
 function abort(){
  // Restore normal input when a Rapier WASM simulation fails. Do not mark
  // a death as respawned; the death screen owns that state separately.
  mode='none';bed=null;busy=false;refresh();
 }
 function tick(){if(button.hidden!==!!(mode!=='none'||ctx.deathSystem?.active))refresh();}
 button.addEventListener('click',()=>{void ragdoll();});
 return {ragdoll,sleepInBed,getUp,syncPose,tick,clearForDeath,abort,
  get mode(){return mode},get busy(){return busy},refresh};
}
