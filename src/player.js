// Extracted from the original single-file game. Shared game state is passed explicitly.
import {shouldSprint} from './movement-preferences.js';
import {aimState,updateCrosshair} from './aim-state.js';
import {createFrameLimiter} from './frame-limiter.js';
import {createOrbitCamera} from './orbit-camera.js?v=20261030-camera-up-arc1';
export function createPlayer(ctx) {
const limiter=createFrameLimiter();
const orbitCamera=createOrbitCamera(ctx);
let lastWorldTick=-Infinity;
function toggleView(){ctx.thirdPerson=!ctx.thirdPerson;
 orbitCamera.reset();
 if(ctx.thirdPerson){const limit=ctx.settings.cameraPitchLimit*Math.PI/180;ctx.pitch=Math.max(-limit,Math.min(limit,ctx.pitch));}
 // Hide the local avatar from the main camera only; keep it visible to
 // the shadow camera even when playing in first person.
 if(ctx.thirdPerson)ctx.camera.layers.enable(3);else ctx.camera.layers.disable(3);
 ctx.axe.visible=!ctx.thirdPerson&&(ctx.inventory?.equipped??true);
 ctx.$('viewtoggle').textContent=ctx.thirdPerson?'👤 Камера: сзади':'👁 Камера: глаза'}
ctx.$('viewtoggle').onclick=toggleView;ctx.axe.visible=false;

function animate(now){
 requestAnimationFrame(animate);
 // Physics, Root Motion and animation mixers run on every display tick,
 // independently of the user-selected render FPS cap.
 if(!Number.isFinite(now))return;
 const dt=Math.max(0,Math.min(.05,(now-ctx.lastTime)/1000));
 ctx.lastTime=now;
 ctx.wind.tick(now);ctx.treeWindShader?.tick(now,ctx.px,ctx.pz,ctx.settings.windEnabled);ctx.landmarks.tick(now);ctx.dayCycle.tick(now);ctx.emotes.tick(now);
 let forward=(ctx.keys.KeyW||ctx.keys.ArrowUp?1:0)-(ctx.keys.KeyS||ctx.keys.ArrowDown?1:0)-ctx.joyY;
 let side=(ctx.keys.KeyD||ctx.keys.ArrowRight?1:0)-(ctx.keys.KeyA||ctx.keys.ArrowLeft?1:0)+ctx.joyX;
 const len=Math.max(1,Math.hypot(forward,side));forward/=len;side/=len;
 const moving=Math.hypot(forward,side)>.1;
 const sprint=shouldSprint(ctx.keys,ctx.settings.autoSprint,moving);
 const motion=!moving?'Idle':Math.abs(forward)>.1?(sprint?'Run':'Walk'):(side<0?'StrafeLeft':'StrafeRight');
 // Playback rate also scales Root Motion distance: faster feet = faster travel.
 const rate=motion==='Idle'?1:(motion==='StrafeLeft'||motion==='StrafeRight')?(sprint?5:4):(motion==='Run'?(forward<0?-2.35:2.35):(forward<0?-2.25:2.25));
 ctx.simulateVertical(dt);
 let dx=0,dz=0;
 if(ctx.ownAvatar){
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
 if(!ctx.onGround||!ctx.ownAvatar||noRoot){
  const speed=sprint?4.6:2.5;
  dx=(-Math.sin(ctx.yaw)*forward+Math.cos(ctx.yaw)*side)*speed*dt;
  dz=(-Math.cos(ctx.yaw)*forward-Math.sin(ctx.yaw)*side)*speed*dt;
 }
 ctx.moveHorizontal(dx,dz);
 ctx.microGrass?.tick();
 ctx.groundBoxes?.tick(now);
 ctx.plantInteraction?.tick(dt);
 if(ctx.ownAvatar)ctx.ownAvatar.group.position.set(ctx.px,ctx.feetY,ctx.pz);
 if(ctx.thirdPerson){const limit=ctx.settings.cameraPitchLimit*Math.PI/180;ctx.pitch=Math.max(-limit,Math.min(limit,ctx.pitch));}
 ctx.camera.position.set(ctx.px,ctx.feetY+1.8+Math.sin(now*.011)*Math.min(1,Math.hypot(forward,side))*.035,ctx.pz);ctx.camera.rotation.set(ctx.pitch,ctx.yaw,0);
 if(ctx.thirdPerson)orbitCamera.update(dt);
 // The real skinned meshes cast shadows on every rendered frame.
 // The shadow pass runs after both local and remote animation poses update.
 ctx.swing=Math.max(0,ctx.swing-dt*3.8);ctx.axe.rotation.z=-.25-ctx.swing*.9;ctx.axe.rotation.x=ctx.swing*.65;ctx.axe.position.y=-.7+ctx.swing*.15;
for(let i=ctx.falling.length-1;i>=0;i--){const f=ctx.falling[i];f.elapsed+=dt;const a=Math.min(1,f.elapsed/1.8);const angle=a*a*(Math.PI/2);f.tree.rotation.z=Math.sin(f.direction)*angle;f.tree.rotation.x=Math.cos(f.direction)*angle;if(f.elapsed>2.5){ctx.scene.remove(f.tree);ctx.falling.splice(i,1)}}
for(let i=ctx.particles.length-1;i>=0;i--){const p=ctx.particles[i];p.life-=dt;p.vy-=9.8*dt;p.mesh.position.x+=p.vx*dt;p.mesh.position.y+=p.vy*dt;p.mesh.position.z+=p.vz*dt;p.mesh.rotation.x+=dt*8;if(p.life<=0||p.mesh.position.y<0){ctx.scene.remove(p.mesh);ctx.particles.splice(i,1)}}
ctx.frame++;if(now-lastWorldTick>=120){lastWorldTick=now;ctx.updatePing(now);ctx.offlineSave.tick(now);ctx.progress.trackPosition(ctx.px,ctx.pz,ctx.seed);ctx.discoveries.check(now);ctx.updateChunks();ctx.forestResources?.tick(now);ctx.updatePreview();const t=ctx.buildMode?null:ctx.aimed();ctx.highlight.update(t);if(t)ctx.tutorial.complete('tree-aimed');updateCrosshair(ctx.$('crosshair'),aimState(ctx.buildMode,t,ctx.buildMode?(ctx.inventory?.selected==='bench'?ctx.crafting?.placeError?.(ctx.placement):ctx.placeError(ctx.placement)):''));ctx.$('damage').style.display=t?'block':'none';if(t){const u=t.userData;ctx.$('target').textContent=`${u.species==='birch'?'🌳 Берёза':'🌲 Дерево'} · ${u.hp}/${u.maxHp} ударов`;ctx.$('damagebar').style.width=(u.hp/u.maxHp*100)+'%'}else if(!ctx.$('target').textContent.includes('+5'))ctx.$('target').textContent=ctx.buildMode?'🪵 Прицел — место установки':''}if(ctx.isOnline()&&now-ctx.lastMoveSent>100){ctx.lastMoveSent=now;ctx.sendNet({type:'move',x:ctx.px,z:ctx.pz,y:ctx.feetY,yaw:ctx.yaw,jumping:!ctx.onGround})}for(const avatar of ctx.avatars.values()){
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
 // The diagnostics FPS counter measures actual rendered frames, not sim ticks.
 if(!limiter.allow(now,ctx.settings.maxFps))return;
 ctx.inventory?.renderDropHint?.();
 ctx.settings.tick(now,ctx);
 ctx.spruceDiagnostics?.tick();
 ctx.atmosphere?.tick(now,ctx.px,ctx.pz);
 ctx.renderer.render(ctx.scene,ctx.camera);
}

return {toggleView, animate};
}
