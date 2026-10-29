// Extracted from the original single-file game. Shared game state is passed explicitly.
export function createPlayer(ctx) {
function toggleView(){ctx.thirdPerson=!ctx.thirdPerson;if(ctx.ownAvatar)ctx.ownAvatar.group.visible=ctx.thirdPerson;ctx.axe.visible=!ctx.thirdPerson;ctx.$('viewtoggle').textContent=ctx.thirdPerson?'👤 Камера: сзади':'👁 Камера: глаза'}
ctx.$('viewtoggle').onclick=toggleView;ctx.axe.visible=false;

function animate(now){
 requestAnimationFrame(animate);
 const dt=Math.min(.05,(now-ctx.lastTime)/1000);ctx.lastTime=now;
 let forward=(ctx.keys.KeyW||ctx.keys.ArrowUp?1:0)-(ctx.keys.KeyS||ctx.keys.ArrowDown?1:0)-ctx.joyY;
 let side=(ctx.keys.KeyD||ctx.keys.ArrowRight?1:0)-(ctx.keys.KeyA||ctx.keys.ArrowLeft?1:0)+ctx.joyX;
 const len=Math.max(1,Math.hypot(forward,side));forward/=len;side/=len;
 const sprint=!!(ctx.keys.ShiftLeft||ctx.keys.ShiftRight);
 const moving=Math.hypot(forward,side)>.1;
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
 if(ctx.ownAvatar)ctx.ownAvatar.group.position.set(ctx.px,ctx.feetY,ctx.pz);
 ctx.camera.position.set(ctx.px,ctx.feetY+1.8+Math.sin(now*.011)*Math.min(1,Math.hypot(forward,side))*.035,ctx.pz);ctx.camera.rotation.set(ctx.pitch,ctx.yaw,0);
 if(ctx.thirdPerson){const back=4.2,raise=2.2;
  ctx.camera.position.set(ctx.px+Math.sin(ctx.yaw)*back,ctx.feetY+1.8+raise+Math.max(0,-Math.sin(ctx.pitch))*1.5,ctx.pz+Math.cos(ctx.yaw)*back);
  ctx.camera.lookAt(ctx.px,ctx.feetY+1.65+Math.tan(ctx.pitch)*3,ctx.pz);
 }
 // Local mixer and position were updated above, before camera rendering.
 ctx.swing=Math.max(0,ctx.swing-dt*3.8);ctx.axe.rotation.z=-.25-ctx.swing*.9;ctx.axe.rotation.x=ctx.swing*.65;ctx.axe.position.y=-.7+ctx.swing*.15;
for(let i=ctx.falling.length-1;i>=0;i--){const f=ctx.falling[i];f.elapsed+=dt;const a=Math.min(1,f.elapsed/1.8);const angle=a*a*(Math.PI/2);f.tree.rotation.z=Math.sin(f.direction)*angle;f.tree.rotation.x=Math.cos(f.direction)*angle;if(f.elapsed>2.5){ctx.scene.remove(f.tree);ctx.falling.splice(i,1)}}
for(let i=ctx.particles.length-1;i>=0;i--){const p=ctx.particles[i];p.life-=dt;p.vy-=9.8*dt;p.mesh.position.x+=p.vx*dt;p.mesh.position.y+=p.vy*dt;p.mesh.position.z+=p.vz*dt;p.mesh.rotation.x+=dt*8;if(p.life<=0||p.mesh.position.y<0){ctx.scene.remove(p.mesh);ctx.particles.splice(i,1)}}
if(ctx.frame++%12===0){ctx.updateChunks();ctx.updatePreview();const t=ctx.buildMode?null:ctx.aimed();ctx.$('damage').style.display=t?'block':'none';if(t){const u=t.userData;ctx.$('target').textContent=`🌲 Дерево · ${u.hp}/${u.maxHp} ударов`;ctx.$('damagebar').style.width=(u.hp/u.maxHp*100)+'%'}else if(!ctx.$('target').textContent.includes('+5'))ctx.$('target').textContent=ctx.buildMode?'🪵 Прицел — место установки':''}if(ctx.isOnline()&&now-ctx.lastMoveSent>100){ctx.lastMoveSent=now;ctx.sendNet({type:'move',x:ctx.px,z:ctx.pz,y:ctx.feetY,yaw:ctx.yaw,jumping:!ctx.onGround})}for(const avatar of ctx.avatars.values()){avatar.group.position.lerp(avatar.goal,Math.min(1,dt*10));avatar.group.rotation.y+=Math.atan2(Math.sin(avatar.angle-avatar.group.rotation.y),Math.cos(avatar.angle-avatar.group.rotation.y))*Math.min(1,dt*8);
 if(avatar.actor){
   const vx=avatar.goal.x-avatar.group.position.x,vz=avatar.goal.z-avatar.group.position.z;
   const a=avatar.group.rotation.y,front=-Math.sin(a)*vx-Math.cos(a)*vz,right=Math.cos(a)*vx-Math.sin(a)*vz;
   const remoteMotion=Math.hypot(vx,vz)<.025?'Idle':Math.abs(right)>Math.abs(front)*1.5?(right>0?'StrafeRight':'StrafeLeft'):'Walk';
   ctx.tickActor(avatar.actor,dt,remoteMotion,avatar.jumping);
  }
 }ctx.renderer.render(ctx.scene,ctx.camera)}requestAnimationFrame(animate);

return {toggleView, animate};
}
