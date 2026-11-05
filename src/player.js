import {debugFlightDelta} from './debug-flight-motion.js';
import {tickFallingTrees} from './falling-trees.js?v=20261102-treefall-sync13';
import {createPlayerMotionTracker} from './ragdoll-motion.js';
import {rootMotionSpeed,playbackRateForSpeed,walkingMotion,runningMotion,humanoidTargetSpeed,playbackDirectionForMotion,BACKWARD_RUN_SPEED} from './root-motion-speed.js?v=20261104-ori03';
import {movementInput,locomotionMode,targetLegsYaw,worldMoveDirection,joystickSprintActive,createMovementSteering} from './locomotion-input.js?v=20261104-turn-inertia1';
// Extracted from the original single-file game. Shared game state is passed explicitly.
import {shouldSprint} from './movement-preferences.js';
import {aimState,updateCrosshair} from './aim-state.js?v=20261105-empty-loot3';
import {createFrameLimiter} from './frame-limiter.js';
import {activeWeaponAttack} from './weapon-profiles.js';
import {outgoingPose,blendRemotePose} from './network-pose.js';
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
let lastMoveMode='idle';
let joystickRunning=false;
const movementSteering=createMovementSteering();
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
 // ORI-02: one continuous movement vector for keyboard and touch joystick.
 // Relative direction and analog strength are independent of camera steering.
 const intent=movementInput({
  keys:ctx.keys,joyX:ctx.joyX,joyY:ctx.joyY,disabled:posing||dead,
 });
 const moving=intent.strength>0;
 // A deep mobile-stick push starts a run even without a Shift button;
 // a smaller release threshold prevents rapid run/strafe toggling.
 joystickRunning=joystickSprintActive(ctx.joyX,ctx.joyY,joystickRunning);
 const wantsSprint=shouldSprint(ctx.keys,ctx.settings.autoSprint,moving)||joystickRunning;
 const flying=ctx.debugCheats?.flying===true&&!ctx.isOnline?.();
 const sprint=!flying&&moving&&wantsSprint&&(!ctx.vitals||ctx.vitals.canSprint());
 // Ease only the direction of real travel, not the Root Motion step length.
 // Reset for zero input, ragdoll, death and debug flight. Keep the camera
 // Movement/turning rules now apply to every 53-bone model.
 const moveIntent=movementSteering.update(intent,ctx.cameraYaw,dt,{
  sprinting:sprint,
  disabled:posing||dead||flying,
 });
 const {forward,side,strength}=moveIntent;
 // All three humanoids run toward lateral input when sprinting.
 const lateralRun=sprint;
 const mode=locomotionMode(moveIntent,lastMoveMode,lateralRun);
 if(posing||dead)lastMoveMode='idle';
 else if(mode!=='idle')lastMoveMode=mode;
 const motion=mode==='idle'?'Idle':mode==='strafe'
  ?(side<0?'StrafeLeft':'StrafeRight')
  :(sprint?runningMotion(ctx.ownAvatar,mode==='backward')
    :walkingMotion(ctx.ownAvatar,mode==='backward'));
 ctx.characterOrientation.setMovementIntent(moveIntent,mode,
  targetLegsYaw(ctx.cameraYaw,moveIntent,{mode,sprinting:lateralRun}));
 // Leg/hip facing approaches the intended diagonal on the shortest arc.
 // Death and ragdoll still lock steering while their physics owns the pose.
 const swingAttack=activeWeaponAttack(ctx.ownAvatar,now);
 const runningMotionNow=motion==='Run'||motion==='RunBackward';
 ctx.characterOrientation.steerLegs(dt,{
  locked:posing||dead,
  settings:ctx.settings.lookSettings,
  running:runningMotionNow,
  attack:swingAttack,
 });
 ctx.characterOrientation.steerUpper(dt,{
  locked:posing||dead,
  settings:ctx.settings.lookSettings,
  running:runningMotionNow,
  attack:swingAttack,
 });
 if(posing||dead)ctx.ownAvatar?.proceduralLook?.discard();
 if(!dead)ctx.vitals?.tick(sprint);
 ctx.sprinting=sprint;
 // An analog input at 40% travel must drive both the motion speed and
 // its root displacement at 40%, not play a full-speed animation in place.
 // Existing forward Run stays 1.2x at full tilt; backward Run is 30% faster
 // than backward Walk (2.6 m/s vs 2.0 m/s).
 const targetSpeed=humanoidTargetSpeed(motion,sprint);
 const rate=(motion==='Idle'?1:motion==='Run'?1.2*strength:
   playbackRateForSpeed(ctx.rootMotion[motion],targetSpeed*strength))*
   playbackDirectionForMotion(motion,mode==='backward');
 const moveDirection=worldMoveDirection(ctx.cameraYaw,moveIntent);
 if(!posing&&!dead&&!flying)ctx.simulateVertical(dt);
 let dx=0,dz=0;
 if(ctx.ownAvatar&&!posing&&!dead){
  ctx.ownAvatar.group.rotation.y=ctx.legsYaw;
  const rootDelta=ctx.tickActor(ctx.ownAvatar,dt,motion,!ctx.onGround,rate);
  // Apply the same bounded look to Walk, Run, RunBackward and Chop2 AFTER
  // AnimationMixer.update(), without modifying authoring clips or Root Motion.
  ctx.ownAvatar.proceduralLook?.apply(ctx.characterOrientation);
  dx=rootDelta.x;dz=rootDelta.z;
  // Root Motion controls *distance* while the joystick controls direction.
  // During W<->S and walk<->strafe cross-fades, summing signed root
  // vectors can cancel their distance (briefly freezing the character).
  // tickActor tracks the weighted travel of each active clip separately.
  if(ctx.onGround&&moving){
   const distance=ctx.ownAvatar.rootTravelDistance??Math.hypot(dx,dz);
   dx=moveDirection.x*distance;
   dz=moveDirection.z*distance;
  }
 }
 // Jump movement remains physics/input-driven, not extracted from Root.
 // Also keep a fallback when testing against an old GLB without Root Motion.
 const noRoot=motion!=='Idle'&&rootMotionSpeed(ctx.rootMotion[motion])===0;
 if(!dead&&!posing&&!flying&&(!ctx.onGround||!ctx.ownAvatar||noRoot)){
  dx=moveDirection.x*targetSpeed*strength*dt;
  dz=moveDirection.z*targetSpeed*strength*dt;
 }
 if(!posing&&!dead){
  if(flying){
   const up=Number(!!(ctx.keys.Space||ctx.keys.ShiftLeft||ctx.keys.ShiftRight||ctx.debugCheats?.mobileUp));
   const down=Number(!!(ctx.keys.ControlLeft||ctx.keys.ControlRight||ctx.debugCheats?.mobileDown));
   const delta=debugFlightDelta({forward:intent.forward*intent.strength,side:intent.side*intent.strength,yaw:ctx.yaw,pitch:ctx.pitch,vertical:up-down,dt});
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
 // Collectible grass tufts share the GPU-blade palette and live percentage.
 ctx.grasses?.setPalette?.(ctx.settings?.grassRandomColors,
   ctx.settings?.grassYellowPercent??5);
 ctx.grasses?.setEffects?.(ctx.settings,ctx.sun);
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
   (follow?.feetY??ctx.feetY)+1.8+Math.sin(now*.011)*Math.min(1,strength)*.035,
   follow?.pz??ctx.pz);ctx.camera.rotation.set(ctx.cameraPitch,ctx.cameraYaw,0);
 if(ctx.thirdPerson)orbitCamera.update(dt,follow,(flying?2:0)+(mobileCamera?.matches?2.5:0));
 // Raycasters must see this frame's camera, including frames skipped by the
 // render limiter. Small moving mobs can cross the reticle between HUD ticks.
 ctx.camera.updateMatrixWorld(true);
 const lootOpen=(ctx.mobs??ctx.hens)?.opened!=null;
 const mobTarget=ctx.buildMode||lootOpen?null:(ctx.mobs??ctx.hens)?.aimed?.()??null;
 const mob=mobTarget?.record??null;
 const pursuing=!ctx.buildMode&&sprint&&forward>.1&&!!((ctx.mobs??ctx.hens)?.pursuitTarget?.());
 refreshCrosshair(mob,pursuing,lootOpen);
 // Animation mixer and camera have both updated: resolve contact-frame
 // impacts using the *current* crosshair, not the mouse-down position.
 ctx.tickChopImpact?.(now,mobTarget);
 // The real skinned meshes cast shadows on every rendered frame.
 // The shadow pass runs after both local and remote animation poses update.
 ctx.swing=Math.max(0,ctx.swing-dt*3.8);ctx.axe.rotation.z=-.25-ctx.swing*.9;ctx.axe.rotation.x=ctx.swing*.65;ctx.axe.position.y=-.7+ctx.swing*.15;
tickFallingTrees(ctx,dt);
for(let i=ctx.particles.length-1;i>=0;i--){const p=ctx.particles[i];p.life-=dt;p.vy-=9.8*dt;p.mesh.position.x+=p.vx*dt;p.mesh.position.y+=p.vy*dt;p.mesh.position.z+=p.vz*dt;p.mesh.rotation.x+=dt*8;if(p.life<=0||p.mesh.position.y<0){ctx.scene.remove(p.mesh);ctx.particles.splice(i,1)}}
ctx.frame++;if(now-lastWorldTick>=120){lastWorldTick=now;ctx.updatePing(now);ctx.offlineSave.tick(now);ctx.progress.trackPosition(ctx.px,ctx.pz,ctx.seed);ctx.discoveries.check(now);ctx.updateChunks();ctx.forestResources?.tick(now);ctx.inventory?.tickBook?.();ctx.updatePreview();ctx.pickupInteraction?.update?.();const interaction=ctx.pickupInteraction?.current;const t=ctx.buildMode||mob||pursuing||lootOpen||interaction?.empty?null:ctx.aimed();ctx.highlight.update(t);if(t)ctx.tutorial.complete('tree-aimed');reticleTree=t;reticleInteraction=interaction;reticleError=ctx.buildMode?(ctx.inventory?.selected==='bench'?ctx.crafting?.placeError?.(ctx.placement):(ctx.preview?.userData?.previewError??ctx.placeError(ctx.placement))):'';refreshCrosshair(mob,pursuing,lootOpen);ctx.$('damage').style.display=t?'block':'none';if(t){const u=t.userData;ctx.$('target').textContent=`${u.species==='birch'?'🌳 Берёза':'🌲 Дерево'} · ${u.hp}/${u.maxHp} ударов`;ctx.$('damagebar').style.width=(u.hp/u.maxHp*100)+'%'}else if(!ctx.$('target').textContent.includes('+5'))ctx.$('target').textContent=ctx.buildMode?'🪵 Прицел — место установки':
   lootOpen?'':mob?(mob.displayName??'Существо')+' · Атаковать':pursuing?'':interaction?interaction.label+' · '+(interaction.verb??(interaction.type==='box'||interaction.type==='resource'?'Подобрать':'Открыть')):''}if(ctx.isOnline()&&!dead&&now-ctx.lastMoveSent>100){ctx.lastMoveSent=now;ctx.sendNet({type:'move',x:ctx.px,z:ctx.pz,y:ctx.feetY,...outgoingPose(ctx.characterOrientation,motion),jumping:!ctx.onGround,sprinting:ctx.sprinting===true})}ctx.debugPlayers?.tick?.(now,dt);
for(const avatar of ctx.avatars.values()){
 if(avatar.debugDead)continue;
 const previousX=avatar.group.position.x,previousZ=avatar.group.position.z;
 avatar.group.position.lerp(avatar.goal,Math.min(1,dt*10));
 avatar.group.rotation.y+=Math.atan2(Math.sin(avatar.angle-avatar.group.rotation.y),Math.cos(avatar.angle-avatar.group.rotation.y))*Math.min(1,dt*8);
 if(avatar.actor){
   if(avatar.poseTarget){
    avatar.pose=blendRemotePose(avatar.pose??avatar.poseTarget,avatar.poseTarget,dt);
    // Group yaw already interpolates legs; use that same facing for the
    // additive chest/head controller so it never appears detached.
    avatar.pose.legsYaw=avatar.group.rotation.y;
   }
   // Infer the remote player's speed from actual replicated movement. Previously
   // every remote avatar played Walk, even when its local player was sprinting.
   const deltaX=avatar.group.position.x-previousX,deltaZ=avatar.group.position.z-previousZ;
   const speed=Math.hypot(deltaX,deltaZ)/Math.max(dt,1/120);
   avatar.moveSpeed=(avatar.moveSpeed??0)+(speed-(avatar.moveSpeed??0))*Math.min(1,dt*8);
   const vx=avatar.goal.x-avatar.group.position.x,vz=avatar.goal.z-avatar.group.position.z;
   const a=avatar.group.rotation.y,front=-Math.sin(a)*vx-Math.cos(a)*vz,right=Math.cos(a)*vx-Math.sin(a)*vz;
   const moving=avatar.moveSpeed>.55;
   const remoteMotion=!moving?'Idle':Math.abs(right)>Math.abs(front)*1.5
    ?(right>0?'StrafeRight':'StrafeLeft')
    :((avatar.sprinting||avatar.moveSpeed>3.3)
      ?runningMotion(avatar.actor,front<0):walkingMotion(avatar.actor,front<0));
   const playedMotion=avatar.motion&&avatar.actor.lower[avatar.motion]
     ?avatar.motion:remoteMotion;
   const rate=(playedMotion==='Idle'||playedMotion==='Jump'?1:playedMotion==='Run'?1.2:
     playedMotion==='RunBackward'
      ?playbackRateForSpeed(avatar.actor.rootMotion[playedMotion],
         Math.min(BACKWARD_RUN_SPEED,Math.max(.5,avatar.moveSpeed)))
      :playbackRateForSpeed(avatar.actor.rootMotion[playedMotion],
         Math.min(4.6,Math.max(.5,avatar.moveSpeed))))*
      playbackDirectionForMotion(playedMotion,front<0);
   ctx.tickActor(avatar.actor,dt,playedMotion,avatar.jumping,rate);
   if(avatar.poseTarget)avatar.actor.proceduralLook?.apply(avatar.pose);
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
