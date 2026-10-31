// Lightweight footsteps in shallow ponds/lakes. Instanced droplets + expanding
// surface rings: no particle objects, no raycasts and no fluid simulation.
export function createWaterSplashes(ctx){
  const THREE=ctx.THREE;
  const DROP_LIMIT=88, RIPPLE_LIMIT=20;
  const dropGeo=new THREE.IcosahedronGeometry(.055,0);
  const rippleGeo=new THREE.RingGeometry(.88,1,28);
  rippleGeo.rotateX(-Math.PI/2);
  const dropMat=new THREE.MeshBasicMaterial({
    color:0xc4f8fa,transparent:true,opacity:.84,depthWrite:false,
  });
  const rippleMat=new THREE.MeshBasicMaterial({
    color:0xd7ffff,transparent:true,opacity:.58,depthWrite:false,
    side:THREE.DoubleSide,
  });
  const dropsMesh=new THREE.InstancedMesh(dropGeo,dropMat,DROP_LIMIT);
  const ripplesMesh=new THREE.InstancedMesh(rippleGeo,rippleMat,RIPPLE_LIMIT);
  dropsMesh.name='Water footstep droplets';
  ripplesMesh.name='Water footstep ripples';
  dropsMesh.frustumCulled=false;
  ripplesMesh.frustumCulled=false;
  dropsMesh.renderOrder=3;
  ripplesMesh.renderOrder=2;
  dropsMesh.castShadow=false;
  ripplesMesh.castShadow=false;
  ctx.scene.add(dropsMesh,ripplesMesh);

  const dummy=new THREE.Object3D();
  const drops=Array.from({length:DROP_LIMIT},()=>({life:0}));
  const rings=Array.from({length:RIPPLE_LIMIT},()=>({life:0}));
  let dropCursor=0,ringCursor=0;
  let lastX=ctx.px,lastZ=ctx.pz;
  let walked=0,step=0;

  // Fixed, invisible transforms for unused instances (zero draw overhead).
  function hide(mesh,index){
    dummy.position.set(0,0,0);
    dummy.rotation.set(0,0,0);
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    mesh.setMatrixAt(index,dummy.matrix);
  }
  function hideAll(){
    for(let i=0;i<DROP_LIMIT;i++)hide(dropsMesh,i);
    for(let i=0;i<RIPPLE_LIMIT;i++)hide(ripplesMesh,i);
    dropsMesh.instanceMatrix.needsUpdate=true;
    ripplesMesh.instanceMatrix.needsUpdate=true;
  }
  hideAll();

  function ripple(x,y,z,run){
    const index=ringCursor++%RIPPLE_LIMIT;
    rings[index]={x,y,z,age:0,life:run?.62:.76,run};
  }

  function splash(x,z,speed,dirX,dirZ,run,large=false){
    const terrain=ctx.terrain;
    const depth=terrain.waterDepthAt(x,z);
    if(depth<.065||depth>.85)return;
    const y=terrain.heightAt(x,z)+depth+.065;
    ripple(x,y-.018,z,run);
    const amount=large?11:run?8:5;
    for(let i=0;i<amount;i++){
      const angle=Math.random()*Math.PI*2;
      const spread=Math.random()*.72+.28;
      const index=dropCursor++%DROP_LIMIT;
      // A little momentum in the walking direction, spray otherwise radial.
      drops[index]={
        x:x+Math.cos(angle)*.07, y:y+.025*Math.random(),
        z:z+Math.sin(angle)*.07,
        vx:Math.cos(angle)*spread+(dirX||0)*speed*.18,
        vz:Math.sin(angle)*spread+(dirZ||0)*speed*.18,
        vy:(large?1.6:run?1.35:.9)+Math.random()*.8,
        waterY:y-.025,age:0,
        life:.37+Math.random()*.22,
        size:.62+Math.random()*.68,
      };
    }
  }

  function updateEffects(dt){
    let dirtyDrops=false,dirtyRings=false;
    for(let i=0;i<DROP_LIMIT;i++){
      const p=drops[i];
      if(!p.life)continue;
      p.age+=dt;
      p.vy-=9.4*dt;
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;
      if(p.age>=p.life||p.y<=p.waterY){
        p.life=0;hide(dropsMesh,i);dirtyDrops=true;continue;
      }
      const fade=Math.min(1,(p.life-p.age)/.17);
      dummy.position.set(p.x,p.y,p.z);
      dummy.rotation.set(0,0,0);
      dummy.scale.setScalar(p.size*fade);
      dummy.updateMatrix();
      dropsMesh.setMatrixAt(i,dummy.matrix);
      dirtyDrops=true;
    }
    for(let i=0;i<RIPPLE_LIMIT;i++){
      const r=rings[i];
      if(!r.life)continue;
      r.age+=dt;
      if(r.age>=r.life){
        r.life=0;hide(ripplesMesh,i);dirtyRings=true;continue;
      }
      const t=r.age/r.life;
      const radius=.12+(r.run?.73:.53)*t;
      const widthFade=Math.min(1,(1-t)*3);
      dummy.position.set(r.x,r.y,r.z);
      dummy.rotation.set(0,0,0);
      // Shrink the ring near its end rather than leaving a hard pop.
      dummy.scale.set(radius*widthFade,1,radius*widthFade);
      dummy.updateMatrix();
      ripplesMesh.setMatrixAt(i,dummy.matrix);
      dirtyRings=true;
    }
    if(dirtyDrops)dropsMesh.instanceMatrix.needsUpdate=true;
    if(dirtyRings)ripplesMesh.instanceMatrix.needsUpdate=true;
  }

  function tick(dt){
    updateEffects(dt);
    const x=ctx.px,z=ctx.pz;
    const dx=x-lastX,dz=z-lastZ;
    const distance=Math.hypot(dx,dz);
    lastX=x;lastZ=z;
    if(!Number.isFinite(distance)||distance>2){
      walked=0;return;
    }
    // Only step on the terrain itself, not on logs, rocks or mid-jump.
    const grounded=ctx.onGround&&Math.abs(ctx.feetY-ctx.terrain.heightAt(x,z))<.16;
    if(!grounded){
      walked=0;return;
    }
    if(distance<.002){
      walked=0;return;
    }
    // Derive cadence from actual travel, including root-motion animations.
    walked+=distance;
    const stride=ctx.sprinting ? .9 : .69;
    if(walked>=stride){
      walked%=stride;
      const dX=dx/distance,dZ=dz/distance;
      // Sideways from movement, works when strafing and walking backwards.
      const side=step++%2===0?1:-1;
      const footX=x+dZ*side*.15,footZ=z-dX*side*.15;
      splash(footX,footZ,Math.min(5,distance/Math.max(dt,.016)),
        dX,dZ,ctx.sprinting);
    }
  }

  function clear(){
    for(const d of drops)d.life=0;
    for(const r of rings)r.life=0;
    hideAll();
    lastX=ctx.px;lastZ=ctx.pz;
    walked=0;
  }
  function dispose(){
    clear();
    ctx.scene.remove(dropsMesh,ripplesMesh);
    dropsMesh.dispose();ripplesMesh.dispose();
    dropGeo.dispose();rippleGeo.dispose();
    dropMat.dispose();rippleMat.dispose();
  }
  return {tick,clear,dispose};
}
