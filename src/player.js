import {debugFlightDelta} from './debug-flight-motion.js';
import {tickFallingTrees} from './falling-trees.js?v=20261102-treefall-sync13';
import {createPlayerMotionTracker} from './ragdoll-motion.js';
// Extracted from the original single-file game. Shared game state is passed explicitly.
import {shouldSprint} from './movement-preferences.js';
import {aimState,updateCrosshair} from './aim-state.js?v=20261105-empty-loot3';
import {createFrameLimiter} from './frame-limiter.js';
import {createGpuFrameTimer} from './gpu-frame-timer.js';
import {createOrbitCamera} from './orbit-camera.js?v=20261102-flight-distance1';
// Clipping is a rendering property, not a collision between the camera and
// the character. Keep the established camera orbit untouched; while ragdoll
// is active, reduce only the near clipping plane so nearby limbs aren't cut.
export function setRagdollCameraClipping(camera,active,normalNear){
 const desired=active?Math.min(normalNear,.01):normalNear;
 if(camera.near===desired)return false;
 camera.near=desired;
 camera.updateProjectionMatrix();
 return true;
}
// One lifecycle for every ragdoll exit (Space, bed wake-up, respawn, or
// interrupted death setup). Physics never needs to know how the orbit
// camera, view layers or near clipping plane are implemented.
export function createRagdollCameraLifecycle(ctx,{toggleView,resetOrbit}){
 const normalNear=ctx.camera.near;
 let priorThirdPerson=null;
 function enter(){
  if(priorThirdPerson!==null)return false;
  priorThirdPerson=ctx.thirdPerson;
  if(!ctx.thirdPerson)toggleView(); // Render the falling character.
  setRagdollCameraClipping(ctx.camera,true,normalNear);
  resetOrbit();
  return true;
 }
 function exit(){
  if(priorThirdPerson===null)return false;
  const restoreThirdPerson=priorThirdPerson;
  priorThirdPerson=null;
  setRagdollCameraClipping(ctx.camera,false,normalNear);
  if(ctx.thirdPerson!==restoreThirdPerson)toggleView();
  // Snap the spring-arm pivot to the next player position. Especially
  // important when respawn teleports from the corpse to the spawn/bed.
  resetOrbit();
  return true;
 }
 return {enter,exit,get active(){return priorThirdPerson!==null;}};
}

export function createPlayer(ctx) {
 const mobileCamera=globalThis.matchMedia?.('(max-width:650px), (pointer:coarse)');
const limiter=createFrameLimiter();
const gpuTimer=createGpuFrameTimer(ctx.renderer);
const orbitCamera=createOrbitCamera(ctx);
const motionTracker=createPlayerMotionTracker();
ctx.motionVelocity=motionTracker.reset(ctx.px,ctx.pz,ctx.yaw);
let wasPosing=false;
let lastWorldTick=-Infinity;
let reticleTree=null,reticleInteraction=null,reticleError='';
function refreshCrosshair(mob,pursuing,lootOpen){
 updateCrosshair(ctx.$('crosshair'),lootOpen?{kind:'idle',text:'',label:'Окно добычи'}:aimState(ctx.buildMode,reticleTree,reticleError,reticleInteraction,mob,{pursuing}));
}
function toggleView(){ctx.thirdPerson=!ctx.thirdPerson;
 orbitCamera.reset();
 if(ctx.thirdPerson){const limit=ctx.settings.cameraPitchLimit*Math.PI/180;ctx.pitch=Math.max(-limit,Math.min(limit,ctx.pitch));}
 // Hide the local avatar from the main camera only; keep it visible to
 // the shadow camera even when playing in first person.
 if(ctx.thirdPerson)ctx.camera.layers.enable(3);else ctx.camera.layers.disable(3);
 ctx.axe.visible=!ctx.thirdPerson&&(ctx.inventory?.equipped??true);
 ctx.$('viewtoggle').textContent=ctx.thirdPerson?'👤 Камера: сзади':'👁 Камера: глаза'}
ctx.$('viewtoggle').onclick=toggleView;ctx.axe.visible=false;
const ragdollCamera=createRagdollCameraLifecycle(ctx,{
 toggleView,resetOrbit:()=>orbitCamera.reset(),
});

function animate(now){
 requestAnimationFrame(animate);
 // Physics, Root Motion and animation mixers run on every display tick,
 // independently of the user-selected render FPS cap.
 if(!Number.isFinite(now))return;
 const profiling=ctx.settings.showFps||ctx.settings.profilerSampling;
 const cpuStart=profiling?performance.now():0;
 if(profiling){
   const sample=gpuTimer.poll(now);
   if(sample?.status==='ready')ctx.settings.setGpuFrameTime(sample.ms,true);
   else if(sample?.status==='invalid')ctx.settings.setGpuFrameTime(null,true);
   else if(sample?.status==='unsupported')ctx.settings.setGpuFrameTime(null,false);
 }else gpuTimer.reset();
 // Count the uncapped requestAnimationFrame/simulation ticks separately
 // from rendered frames (which can be limited to 30/60 FPS).
 ctx.settings.tickPhysics(now);
 const elapsed=Math.max(0,(now-ctx.lastTime)/1000);
 const dt=Math.min(.05,elapsed);
 ctx.lastTime=now;
 ctx.debugCheatsController?.tick?.();
 ctx.deathSystem?.tick(now);
 ctx.ragdollControls?.tick();
 const dead=ctx.deathSystem?.active===true;
 const ragdoll=ctx.ragdoll?.active===true;
 const posing=ragdoll||ctx.ragdollControls?.busy===true;
 if(posing||dead)ctx.jumpRequested=false; // no movement while dead
 (ctx.mobs??ctx.hens)?.tick(dt,elapsed);
 ctx.wind.tick(now);ctx.treeWindShader?.tick(now,ctx.px,ctx.pz,ctx.settings.windEnabled);ctx.landmarks.tick(now);ctx.dayCycle.tick(now);ctx.emotes.tick(now);
 let forward=(posing||dead)?0:(ctx.keys.KeyW||ctx.keys.ArrowUp?1:0)-(ctx.keys.KeyS||ctx.keys.ArrowDown?1:0)-ctx.joyY;
 let side=(posing||dead)?0:(ctx.keys.KeyD||ctx.keys.ArrowRight?1:0)-(ctx.keys.KeyA||ctx.keys.ArrowLeft?1:0)+ctx.joyX;
 const len=Math.max(1,Math.hypot(forward,side));forward/=len;side/=len;
 const moving=Math.hypot(forward,side)>.1;
 const wantsSprint=shouldSprint(ctx.keys,ctx.settings.autoSprint,moving);
 const flying=ctx.debugCheats?.flying===true&&!ctx.isOnline?.();
 const sprint=!flying&&moving&&wantsSprint&&(!ctx.vitals||ctx.vitals.canSprint());
 if(!dead)ctx.vitals?.tick(sprint);
 ctx.sprinting=sprint;
 const motion=!moving?'Idle':Math.abs(forward)>.1?(sprint?'Run':'Walk'):(side<0?'StrafeLeft':'StrafeRight');
 // Playback rate also scales Root Motion distance: faster feet = faster travel.
 const rate=motion==='Idle'?1:(motion==='StrafeLeft'||motion==='StrafeRight')?(sprint?5:4):(motion==='Run'?(forward<0?-2.35:2.35):(forward<0?-2.25:2.25));
 if(!posing&&!dead&&!flying)ctx.simulateVertical(dt);
 let dx=0,dz=0;
 if(ctx.ownAvatar&&!posing&&!dead){
  ctx.ownAvatar.group.rotation.y=ctx.yaw;
  const rootDelta=ctx.tickActor(ctx.ownAvatar,dt,motion,!ctx.onGround,rate);
  dx=rootDelta.x;dz=rootDelta.z;
  // Diagonal input keeps its intended direction; step distance still comes
  // from the animation, rather than an independent hard-coded speed.
  if(ctx.onGround&&Math.abs(forward)>.1&&Math.abs(side)>.1){
   const distance=Math.hypot(dx,dz);
   dx=(-Math.sin(ctx.yaw)*forward+Math.cos(ctx.yaw)*side)*distance;
   dz=(-Math.cos(ctx.yaw)*forward-Math.sin(ctx.yaw)*side)*distance;
  }
 }
 // Jump movement remains physics/input-driven, not extracted from Root.
 // Also keep a fallback when testing against an old GLB without Root Motion.
 const noRoot=motion!=='Idle'&&(!ctx.rootMotion[motion]||ctx.rootMotion[motion].travel.lengthSq()<1e-5);
 if(!dead&&!posing&&!flying&&(!ctx.onGround||!ctx.ownAvatar||noRoot)){
  const speed=sprint?4.6:2.5;
  dx=(-Math.sin(ctx.yaw)*forward+Math.cos(ctx.yaw)*side)*speed*dt;
  dz=(-Math.cos(ctx.yaw)*forward-Math.sin(ctx.yaw)*side)*speed*dt;
 }
 if(!posing&&!dead){
  if(flying){
   const up=Number(!!(ctx.keys.Space||ctx.keys.ShiftLeft||ctx.keys.ShiftRight||ctx.debugCheats?.mobileUp));
   const down=Number(!!(ctx.keys.ControlLeft||ctx.keys.ControlRight||ctx.debugCheats?.mobileDown));
   const delta=debugFlightDelta({forward,side,yaw:ctx.yaw,pitch:ctx.pitch,vertical:up-down,dt});
   ctx.px+=delta.x;ctx.pz+=delta.z;
   ctx.feetY=Math.max(ctx.terrain.heightAt(ctx.px,ctx.pz)+.2,ctx.feetY+delta.y);
   ctx.onGround=false;ctx.verticalSpeed=0;ctx.jumpRequested=false;
  }else ctx.moveHorizontal(dx,dz);
  // Always derive velocity from actual collision-resolved displacement,
  // including walking, running, strafing and airborne input.
  ctx.motionVelocity=wasPosing?motionTracker.reset(ctx.px,ctx.pz,ctx.yaw)
    :motionTracker.sample(ctx.px,ctx.pz,ctx.yaw,dt);
  wasPosing=false;
 }else{
  wasPosing=true; // Don't treat teleport/stand-up as walking velocity.
  if(ragdoll){
   ctx.ragdoll.tick(dt);ctx.ragdollControls?.syncPose?.();
   if(ctx.ragdollControls?.mode==='manual'&&!ctx.deathSystem?.active){
    const pose=ctx.ragdoll.pose?.();
    if(pose){
     const support=ctx.ragdollStandingSupport?.(pose.x,pose.z,pose.hipsY)
       ??ctx.terrain.heightAt(pose.x,pose.z);
     ctx.fallTracker?.observeRagdoll(pose.feetY,support,pose.vy);
    }
   }
  }
 }
 ctx.waterSplashes?.tick(dt);
 ctx.audio?.tick(now);
 ctx.microGrass?.tick();
 ctx.worldStreamer?.tick();
 ctx.groundBoxes?.tick(now);ctx.storages?.tick();ctx.campStructures?.tick(now);
 ctx.plantInteraction?.tick(dt);
 if(ctx.ownAvatar&&!posing&&!dead)ctx.ownAvatar.group.position.set(ctx.px,ctx.feetY,ctx.pz);
 const fallImpact=ctx.fallTracker?.take?.();
 if(fallImpact)ctx.applyFallImpact?.(fallImpact,{alreadyRagdoll:ragdoll});
 if(ctx.thirdPerson){const limit=ctx.settings.cameraPitchLimit*Math.PI/180;ctx.pitch=Math.max(-limit,Math.min(limit,ctx.pitch));}
 const fallPose=ragdoll?ctx.ragdoll.pose?.():null;
 const follow=fallPose?{
   px:fallPose.x,pz:fallPose.z,hipsY:fallPose.hipsY,
   feetY:Math.max(ctx.terrain.heightAt(fallPose.x,fallPose.z),fallPose.feetY),
 }:null;
 ctx.camera.position.set(follow?.px??ctx.px,
   (follow?.feetY??ctx.feetY)+1.8+Math.sin(now*.011)*Math.min(1,Math.hypot(forward,side))*.035,
   follow?.pz??ctx.pz);ctx.camera.rotation.set(ctx.pitch,ctx.yaw,0);
 if(ctx.thirdPerson)orbitCamera.update(dt,follow,(flying?2:0)+(mobileCamera?.matches?2.5:0));
 // Raycasters must see this frame's camera, including frames skipped by the
 // render limiter. Small moving mobs can cross the reticle between HUD ticks.
 ctx.camera.updateMatrixWorld(true);
 const lootOpen=(ctx.mobs??ctx.hens)?.opened!=null;
 const mobTarget=ctx.buildMode||lootOpen?null:(ctx.mobs??ctx.hens)?.aimed?.()??null;
 const mob=mobTarget?.record??null;
 const pursuing=!ctx.buildMode&&sprint&&forward>.1&&!!((ctx.mobs??ctx.hens)?.pursuitTarget?.());
 refreshCrosshair(mob,pursuing,lootOpen);
 // Animation mixer and camera have both updated: resolve any frame-18 tree
 // contact using the *current* crosshair, not the mouse-down position.
 ctx.tickChopImpact?.(now,mobTarget);
 // The real skinned meshes cast shadows on every rendered frame.
 // The shadow pass runs after both local and remote animation poses update.
 ctx.swing=Math.max(0,ctx.swing-dt*3.8);ctx.axe.rotation.z=-.25-ctx.swing*.9;ctx.axe.rotation.x=ctx.swing*.65;ctx.axe.position.y=-.7+ctx.swing*.15;
tickFallingTrees(ctx,dt);
for(let i=ctx.particles.length-1;i>=0;i--){const p=ctx.particles[i];p.life-=dt;p.vy-=9.8*dt;p.mesh.position.x+=p.vx*dt;p.mesh.position.y+=p.vy*dt;p.mesh.position.z+=p.vz*dt;p.mesh.rotation.x+=dt*8;if(p.life<=0||p.mesh.position.y<0){ctx.scene.remove(p.mesh);ctx.particles.splice(i,1)}}
ctx.frame++;if(now-lastWorldTick>=120){lastWorldTick=now;ctx.updatePing(now);ctx.offlineSave.tick(now);ctx.progress.trackPosition(ctx.px,ctx.pz,ctx.seed);ctx.discoveries.check(now);ctx.updateChunks();ctx.forestResources?.tick(now);ctx.inventory?.tickBook?.();ctx.updatePreview();ctx.pickupInteraction?.update?.();const interaction=ctx.pickupInteraction?.current;const t=ctx.buildMode||mob||pursuing||lootOpen||interaction?.empty?null:ctx.aimed();ctx.highlight.update(t);if(t)ctx.tutorial.complete('tree-aimed');reticleTree=t;reticleInteraction=interaction;reticleError=ctx.buildMode?(ctx.inventory?.selected==='bench'?ctx.crafting?.placeError?.(ctx.placement):(ctx.preview?.userData?.previewError??ctx.placeError(ctx.placement))):'';refreshCrosshair(mob,pursuing,lootOpen);ctx.$('damage').style.display=t?'block':'none';if(t){const u=t.userData;ctx.$('target').textContent=`${u.species==='birch'?'🌳 Берёза':'🌲 Дерево'} · ${u.hp}/${u.maxHp} ударов`;ctx.$('damagebar').style.width=(u.hp/u.maxHp*100)+'%'}else if(!ctx.$('target').textContent.includes('+5'))ctx.$('target').textContent=ctx.buildMode?'🪵 Прицел — место установки':
   lootOpen?'':mob?(mob.displayName??'Существо')+' · Атаковать':pursuing?'':interaction?interaction.label+' · '+(interaction.verb??(interaction.type==='box'||interaction.type==='resource'?'Подобрать':'Открыть')):''}if(ctx.isOnline()&&!dead&&now-ctx.lastMoveSent>100){ctx.lastMoveSent=now;ctx.sendNet({type:'move',x:ctx.px,z:ctx.pz,y:ctx.feetY,yaw:ctx.yaw,jumping:!ctx.onGround,sprinting:ctx.sprinting===true})}ctx.debugPlayers?.tick?.(now,dt);
for(const avatar of ctx.avatars.values()){
 if(avatar.debugDead)continue;
 const previousX=avatar.group.position.x,previousZ=avatar.group.position.z;
 avatar.group.position.lerp(avatar.goal,Math.min(1,dt*10));
 avatar.group.rotation.y+=Math.atan2(Math.sin(avatar.angle-avatar.group.rotation.y),Math.cos(avatar.angle-avatar.group.rotation.y))*Math.min(1,dt*8);
 if(avatar.actor){
   // Infer the remote player's speed from actual replicated movement. Previously
   // every remote avatar played Walk, even when its local player was sprinting.
   const deltaX=avatar.group.position.x-previousX,deltaZ=avatar.group.position.z-previousZ;
   const speed=Math.hypot(deltaX,deltaZ)/Math.max(dt,1/120);
   avatar.moveSpeed=(avatar.moveSpeed??0)+(speed-(avatar.moveSpeed??0))*Math.min(1,dt*8);
   const vx=avatar.goal.x-avatar.group.position.x,vz=avatar.goal.z-avatar.group.position.z;
   const a=avatar.group.rotation.y,front=-Math.sin(a)*vx-Math.cos(a)*vz,right=Math.cos(a)*vx-Math.sin(a)*vz;
   const moving=avatar.moveSpeed>.55;
   const remoteMotion=!moving?'Idle':Math.abs(right)>Math.abs(front)*1.5?(right>0?'StrafeRight':'StrafeLeft'):(avatar.moveSpeed>3.3?'Run':'Walk');
   const rate=remoteMotion==='Run'?2.35:remoteMotion==='Walk'?2.25:remoteMotion.startsWith('Strafe')?4:1;
   ctx.tickActor(avatar.actor,dt,remoteMotion,avatar.jumping,rate);
  }
 }
 // Only GPU rendering and its shadow-map refresh are FPS-limited.
 // Rendering FPS is sampled here; physics FPS is sampled above the limiter.
 if(!limiter.allow(now,ctx.settings.maxFps)){
   if(profiling)ctx.settings.recordCpuFrame(performance.now()-cpuStart,now);
   return;
 }
 ctx.settings.tick(now,ctx);
 const gpuStarted=profiling&&gpuTimer.begin(now);
 if(profiling&&gpuTimer.supported===false)ctx.settings.setGpuFrameTime(null,false);
 try{
   ctx.spruceDiagnostics?.tick();
   ctx.terrain?.tick(now);
   ctx.atmosphere?.tick(now,ctx.px,ctx.pz);
   ctx.distantForest?.updateVisibility?.(ctx.yaw);
   ctx.microGrass?.updateVisibility?.();
   ctx.renderProfiler?.beginFrame();
   try{ctx.renderer.render(ctx.scene,ctx.camera);}
   finally{ctx.renderProfiler?.endFrame();}
   ctx.debugFpsCollector?.frame(now,{
     drawCalls:ctx.renderer.info.render.calls,
     triangles:ctx.renderer.info.render.triangles,
     heapBytes:performance.memory?.usedJSHeapSize,
   });
 }finally{
   if(gpuStarted)gpuTimer.end();
 }
 ctx.worldStartupGate?.tick(now,ctx);
 if(profiling)ctx.settings.recordCpuFrame(performance.now()-cpuStart,now);
}

return {toggleView,ragdollCamera,animate};
}
