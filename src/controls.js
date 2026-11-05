import {createTouchJoystick} from './touch-input.js?v=20261104-mobile1';
// Fn+PgUp/PgDn on many laptops emits a different physical `code` from
// the logical `key`. Prefer the logical key, but keep physical fallback and
// +/- shortcuts for keyboards with no dedicated Page keys.
export function buildPlacementShortcut(event){
 const key=event.key,code=event.code;
 if(key==='PageUp'||code==='PageUp'||code==='Equal'||code==='NumpadAdd')return ['height',1];
 if(key==='PageDown'||code==='PageDown'||code==='Minus'||code==='NumpadSubtract')return ['height',-1];
 const arrow=key?.startsWith('Arrow')?key:code;
 if(event.altKey){
  if(arrow==='ArrowLeft')return ['x',-1];
  if(arrow==='ArrowRight')return ['x',1];
  if(arrow==='ArrowUp')return ['z',-1];
  if(arrow==='ArrowDown')return ['z',1];
 }
 return null;
}
// Extracted from the original single-file game. Shared game state is passed explicitly.
export function createControls(ctx) {
function look(dx,dy){const sensitivity=.003*ctx.settings.mouseSensitivity;ctx.yaw-=dx*sensitivity;const limit=ctx.thirdPerson?ctx.settings.cameraPitchLimit*Math.PI/180:1.43;ctx.pitch=Math.max(-limit,Math.min(limit,ctx.pitch-dy*sensitivity))}ctx.renderer.domElement.addEventListener('pointerdown',e=>{if(ctx.deathSystem?.active)return;if((ctx.mobs??ctx.hens)?.handlePointer?.(e))return;if(e.pointerType==='mouse'){if(document.pointerLockElement!==ctx.renderer.domElement)ctx.renderer.domElement.requestPointerLock?.();ctx.chop()}else{ctx.drag={id:e.pointerId,x:e.clientX,y:e.clientY};ctx.renderer.domElement.setPointerCapture(e.pointerId)}});ctx.renderer.domElement.addEventListener('pointermove',e=>{if(ctx.drag?.id===e.pointerId){look(e.clientX-ctx.drag.x,e.clientY-ctx.drag.y);ctx.drag.x=e.clientX;ctx.drag.y=e.clientY}});ctx.renderer.domElement.addEventListener('pointerup',e=>{if(ctx.drag?.id===e.pointerId)ctx.drag=null});ctx.renderer.domElement.addEventListener('pointercancel',e=>{if(ctx.drag?.id===e.pointerId)ctx.drag=null});ctx.renderer.domElement.addEventListener('lostpointercapture',e=>{if(ctx.drag?.id===e.pointerId)ctx.drag=null});document.addEventListener('mousemove',e=>{if(document.pointerLockElement===ctx.renderer.domElement)look(e.movementX,e.movementY)});
const isTypingTarget=el=>el instanceof Element&&!!el.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');document.addEventListener('focusin',e=>{if(isTypingTarget(e.target)){for(const code in ctx.keys)ctx.keys[code]=false}});document.addEventListener('keydown',e=>{
 if(ctx.deathSystem?.active){
   if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))
     e.preventDefault();
   return;
 }
 if(e.code==='Escape'&&ctx.storages?.opened!=null){ctx.storages.close();e.preventDefault();return}
 if(e.code==='Escape'&&ctx.inventory?.isBookOpen){ctx.inventory.closeBook();e.preventDefault();return}
 if(e.code==='Escape'&&ctx.inventory?.isOpen){ctx.inventory.close();e.preventDefault();return}
 if(isTypingTarget(e.target)||isTypingTarget(document.activeElement))return;
 if((ctx.mobs??ctx.hens)?.handleKey?.(e)){e.preventDefault();e.stopImmediatePropagation?.();return;}
 if(e.code==='KeyK'&&!e.repeat){ctx.inventory?.toggleBook?.();e.preventDefault();return}
 if(e.code==='KeyI'&&!e.repeat){ctx.inventory?.toggle?.();e.preventDefault();return}
 if(['Digit1','Digit2','Digit3','Digit4'].includes(e.code)&&!e.repeat){ctx.inventory?.select(Number(e.code.slice(-1))-1);return}
 if(e.code==='KeyE'&&!e.repeat){
   // Exactly one target is selected for both E and the crosshair hint.
   if(ctx.pickupInteraction?.interact?.()){e.preventDefault();return}
   if(ctx.inventory?.selected==='log'&&ctx.buildMode){ctx.placeLog();e.preventDefault();return}
   if(ctx.inventory?.selected==='bench'&&ctx.buildMode){ctx.crafting?.placeItem?.();e.preventDefault();return}
   if(ctx.campStructures?.place&&ctx.campStructures?.items&&
      ['campfire','torch','table','fence','workbench','alchemy_table','bed'].includes(ctx.inventory?.selected)){
     ctx.campStructures.place(ctx.inventory.selected);e.preventDefault();return;
   }
   if(['chest','rack'].includes(ctx.inventory?.selected)){
     ctx.storages?.place?.(ctx.inventory.selected);e.preventDefault();return;
   }
 }
if(e.code==='Space'&&ctx.debugCheats?.flying&&!ctx.isOnline?.()){ctx.keys.Space=true;e.preventDefault();return}
if(e.code==='Space'){e.preventDefault();if(!e.repeat&&!ctx.ragdollControls?.getUp?.())ctx.requestJump();return}
 if(e.code==='KeyV'){if(!e.repeat)ctx.toggleView();return}
 if(e.code==='KeyB'&&!ctx.inventory){if(!e.repeat)ctx.setMode(!ctx.buildMode);return}
 const buildShortcut=ctx.buildMode&&ctx.inventory?.selected==='log'
   ?buildPlacementShortcut(e):null;
 if(buildShortcut){
   e.preventDefault();
   ctx.nudgeLog?.(...buildShortcut);
   return;
 }
 if(e.code==='KeyR'&&ctx.buildMode){e.preventDefault();if(!e.repeat)ctx.rotateLog?.();return}if(e.code==='KeyQ'&&ctx.buildMode&&!ctx.inventory){ctx.removeLog();return}if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','ControlLeft','ControlRight'].includes(e.code)){ctx.keys[e.code]=true;e.preventDefault()}});document.addEventListener('keyup',e=>{ctx.keys[e.code]=false});window.addEventListener('blur',()=>{for(const code in ctx.keys)ctx.keys[code]=false});const jumpButton=ctx.$('jump'),flightUpPointers=new Set();
jumpButton.addEventListener('pointerdown',e=>{
 e.preventDefault();
 if(ctx.debugCheats?.flying&&!ctx.isOnline?.()){
  flightUpPointers.add(e.pointerId);ctx.debugCheats.mobileUp=true;
  jumpButton.setPointerCapture?.(e.pointerId);
  return;
 }
 if(!ctx.ragdollControls?.getUp?.())ctx.requestJump();
});
for(const type of ['pointerup','pointercancel','lostpointercapture']){
 jumpButton.addEventListener(type,e=>{
  flightUpPointers.delete(e.pointerId);
  if(ctx.debugCheats)ctx.debugCheats.mobileUp=flightUpPointers.size>0&&ctx.debugCheats.flying;
 });
}
window.addEventListener('blur',()=>{flightUpPointers.clear();if(ctx.debugCheats)ctx.debugCheats.mobileUp=false;});ctx.$('hit').addEventListener('pointerdown',e=>{e.preventDefault();ctx.chop()});const joystick=createTouchJoystick(ctx,ctx.$('stick'),ctx.$('knob'));
document.addEventListener('forest-touch-controls',e=>{if(!e.detail.visible){joystick.reset();flightUpPointers.clear();if(ctx.debugCheats)ctx.debugCheats.mobileUp=false;}});
window.addEventListener('blur',()=>{joystick.reset();ctx.drag=null});
ctx.$('reset').onclick=()=>{if(ctx.isOnline()){alert('В сетевой игре мир общий и сохраняется на сервере.');return;}(ctx.mobs??ctx.hens)?.clear?.();ctx.highlight?.clear();ctx.wind?.clear();ctx.distantForest?.clear?.();ctx.offlineSave.reset();ctx.logsCollected=0;ctx.dayCycle?.resetOffline?.();ctx.groundBoxes?.clear?.();ctx.forestResources?.clear?.();ctx.clearDecorBatches?.();ctx.inventory?.restore(null,0);ctx.vitals?.restore(null);for(const t of ctx.trees.values())ctx.scene.remove(t);for(const g of ctx.chunks.values()){g.userData.treeBatch?.dispose();for(const geo of g.userData.terrainGeometries??[])geo.dispose();ctx.scene.remove(g);}for(const f of ctx.falling)ctx.scene.remove(f.tree);for(const p of ctx.particles)ctx.scene.remove(p.mesh);for(const p of ctx.placed)ctx.scene.remove(p.mesh);ctx.placed.length=0;ctx.collisionWorld?.invalidate?.();ctx.crafting?.clear();ctx.storages?.clear();ctx.campStructures?.clear();ctx.disposePreview();ctx.trees.clear();ctx.chunks.clear();ctx.falling.length=0;ctx.particles.length=0;ctx.felled.clear();ctx.treeDamage.clear();ctx.seed=(Math.random()*999999)|0;ctx.px=ctx.pz=ctx.yaw=ctx.pitch=ctx.wood=ctx.cuts=0;ctx.feetY=ctx.verticalSpeed=0;ctx.onGround=true;ctx.$('wood').textContent='0';ctx.$('cut').textContent='0';ctx.progress.resetPosition(0,0);ctx.updateChunks();ctx.offlineSave.markDirty()};addEventListener('resize',()=>{ctx.camera.aspect=innerWidth/innerHeight;ctx.camera.updateProjectionMatrix();ctx.renderer.setSize(innerWidth,innerHeight)});ctx.updateChunks();

return {look};
}
