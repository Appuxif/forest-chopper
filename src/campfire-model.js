import {fireLighting} from './lighting-profile.js?v=20261103-shadow-visibility-cache1';
import {applyFireShadowPolicy} from './fire-shadow-policy.js?v=20261103-day-night-fire-shadows1';
import {createFireEffects,resolveFireTier,firePreset} from './fire-effects.js?v=20261102-night-lighting1';

// Shared upgraded crafting campfire: identical at spawn, in player structures,
// and in inventory thumbnails. Logs converge upward in the centre, while
// their outer ends rest near the rock ring.
// Fire lighting, activation, caster radius and cached-shadow visibility
// remain independent. Every fire has a single point light and cubemap.
const shared=new WeakMap();

function fireAssets(THREE){
 let asset=shared.get(THREE);
 if(!asset){
  asset={
   logGeo:new THREE.BoxGeometry(1,1,1),
   rockGeo:new THREE.DodecahedronGeometry(.24,0),
   flameGeo:new THREE.ConeGeometry(.435,.89,7),
   innerFlameGeo:new THREE.ConeGeometry(.225,.52,6),
   logMat:new THREE.MeshLambertMaterial({color:0x805437}),
   stoneMat:new THREE.MeshLambertMaterial({color:0x797c75}),
   // The transparent outer cone surrounds an opaque, off-centre yellow core.
   flameMat:new THREE.MeshLambertMaterial({
    color:0xffd54a,emissive:0xffca3c,emissiveIntensity:.28,
    transparent:true,opacity:.95,depthWrite:false}),
   innerFlameMat:new THREE.MeshLambertMaterial({
    color:0xffee77,emissive:0xffd657,emissiveIntensity:.20}),
   sparkMat:new THREE.MeshLambertMaterial({
    color:0xffd477,emissive:0xffa33d,emissiveIntensity:.55}),
  };
  shared.set(THREE,asset);
 }
 return asset;
}

export function disposeCampfireEffects(group){
 const data=(group?.userData?.fireOrigin??group)?.userData;
 if(!data?.fireEffects)return;
 data.fireEffects.dispose();
 data.fireEffects=null;
}

// Reusable two-cone fire. The campfire and the torch share materials,
// animation, and the three-spark effect; only the geometry scale/placement differs.
export function attachAnimatedFire(ctx,parent,{
 kind='campfire',baseY=.73,innerOffset={x:.06,y:-.14,z:.02},
 lightY=1.5,lightIntensity=1.8,lightDistance=9,
 sparkY=1.05,sparkSpacing=.13,sparkSpread=.20,sparkDepth=.16,
 shadows=false,
}={}){
 const THREE=ctx.THREE,asset=fireAssets(THREE);
 // Static fuel/stone/torch-head geometry is kept separately for far glow-only LOD.
 parent.userData.fireBody=parent.children.slice();
 if(kind==='torch'&&!asset.torchFlameGeo){
  asset.torchFlameGeo=new THREE.ConeGeometry(.20,.62,7);
  asset.torchInnerGeo=new THREE.ConeGeometry(.11,.36,6);
 }
 const outerGeo=kind==='torch'?asset.torchFlameGeo:asset.flameGeo;
 const innerGeo=kind==='torch'?asset.torchInnerGeo:asset.innerFlameGeo;
 const flame=new THREE.Mesh(outerGeo,asset.flameMat);
 flame.position.set(0,baseY,0);
 parent.add(flame);
 const inner=new THREE.Mesh(innerGeo,asset.innerFlameMat);
 inner.position.set(innerOffset.x,baseY+innerOffset.y,innerOffset.z);
 inner.userData.baseX=inner.position.x;
 inner.userData.baseY=inner.position.y;
 inner.userData.baseZ=inner.position.z;
 parent.add(inner);
 const sparks=[];
 for(let i=0;i<3;i++){
  const spark=new THREE.Mesh(ctx.flowerGeo,asset.sparkMat);
  spark.scale.set(.10,.10,.10);
  spark.position.set((i-1)*sparkSpread,sparkY+i*sparkSpacing,(i%2?sparkDepth:-sparkDepth));
  spark.userData.baseX=spark.position.x;
  spark.userData.baseY=spark.position.y;
  spark.userData.baseZ=spark.position.z;
  parent.add(spark);sparks.push(spark);
 }
 const light=new THREE.PointLight(0xffaa66,lightIntensity,lightDistance,2);
 light.position.set(0,lightY,0);
 light.castShadow=false;
 light.layers?.enable(1);light.layers?.enable(3);
 light.shadow?.mapSize?.set?.(256,256);
 if(light.shadow?.camera){
  light.shadow.camera.near=.2;
  light.shadow.camera.far=Math.max(9,lightDistance+1);
 }
 if(light.shadow){
  light.shadow.bias=-.001;light.shadow.normalBias=.025;
  light.shadow.radius=2;light.shadow.autoUpdate=false;light.shadow.needsUpdate=false;
 }
 light.userData??={};
 parent.add(light);
 parent.userData.flame=flame;
 parent.userData.innerFlame=inner;
 parent.userData.sparks=sparks;
 parent.userData.light=light;
 parent.userData.fireKind=kind;
 return {flame,inner,light,sparks};
}

export function createCampfireModel(ctx,{shadows=false}={}){
 const THREE=ctx.THREE,asset=fireAssets(THREE);
 const g=new THREE.Group();
 // Stone ring from the newer crafted model, with subtle natural variation.
 for(let i=0;i<9;i++){
  const angle=i*Math.PI*2/9;
  const rock=new THREE.Mesh(asset.rockGeo,asset.stoneMat);
  rock.position.set(Math.sin(angle)*.66,.16,Math.cos(angle)*.66);
  const v=.94+(i%3)*.065;
  rock.scale.set(v, .75+(i%2)*.14, v);
  rock.rotation.y=angle;
  rock.castShadow=true;g.add(rock);
 }
 // Nine spokes, one from every gap between the nine surrounding stones.
 // Outer tips rest near the ring (radius ~.70, y ~.20), while the inner
 // tips converge above the centre (y ~.55).
 // Each beam is another 20% thinner than before: .126 -> .1008 m.
 const rockStep=Math.PI*2/9;
 const incline=-.45;
 for(let i=0;i<9;i++){
  const angle=(i+.5)*rockStep;
  const log=new THREE.Mesh(asset.logGeo,asset.logMat);
  log.position.set(Math.sin(angle)*.34,.38,Math.cos(angle)*.34);
  log.scale.set(.80,.1008,.1008);
  log.rotation.order='YXZ';
  log.rotation.set(0,angle-Math.PI/2,incline);
  log.castShadow=true;
  g.add(log);
 }
 // There are deliberately no glowing embers/coals under the flames.
 const fire=attachAnimatedFire(ctx,g,{shadows});
 g.userData.collisionBoxes=[{x:0,y:.20,z:0,w:1.6,h:.40,d:1.6}];
 g.userData.collisionRadius=2.3;
 return {group:g,...fire};
}


// Apply game graphics preset/distance to the source-generator effects.
// Expensive instances are allocated lazily and reused across LOD changes.
export function presentCampfireModel(ctx,group,{lit=true,distance=0,onScreen=true}={}){
 const visual=group?.userData?.fireOrigin??group;
 const data=visual?.userData;
 if(!data?.flame)return 'off';
 const tier=!lit||!onScreen?'off':
   resolveFireTier(ctx.settings?.flameShader===false?'low':firePreset(ctx.settings),distance);
 // Over 100m only the glowing billboard remains (no rocks or logs drawn).
 for(const part of data.fireBody??[])part.visible=distance<100;
 const legacy=tier==='low';
 data.flame.visible=legacy;
 if(data.innerFlame)data.innerFlame.visible=legacy;
 for(const spark of data.sparks??[])spark.visible=legacy;
 if((['ultra','high','medium','glow'].includes(tier)||ctx.settings?.flameBillboard!==false)&&lit&&ctx.THREE.InstancedMesh&&!data.fireEffects){
  data.fireEffects=createFireEffects(ctx.THREE,visual,data.fireKind??'campfire');
 }
 data.fireEffects?.setTier(tier);
 data.fireEffects?.setBillboardEnabled?.(ctx.settings?.flameBillboard!==false);
 return tier;
}

// Keep the original low-quality fire animation and sparks unchanged.
// Called per frame for lit fires. No new geometry, materials or light sources.
// When reduced motion is requested, sparks return to their resting positions.
export function animateCampfireModel(group,now,reducedMotion=false,animateFlames=true,ctx=null){
 const visual=group?.userData?.fireOrigin??group;
 const {flame,innerFlame,sparks=[],fireEffects}=visual?.userData??{};
 if(!Number.isFinite(now))return;
 if(fireEffects&&ctx){
  fireEffects.tick(now,ctx.camera?.position,group.position,reducedMotion);
 }
 if(!flame||flame.visible===false)return;
 const t=now*.001;
 if(animateFlames){
  if(reducedMotion){
   flame.scale.set(1,1,1);
   if(innerFlame){
    innerFlame.scale.set(1,1,1);
    innerFlame.position.set(innerFlame.userData.baseX,
      innerFlame.userData.baseY,innerFlame.userData.baseZ);
   }
  }else{
   flame.scale.x=1+Math.sin(t*4.8)*.06;
   flame.scale.y=1+Math.sin(now*.009)*.09;
   flame.scale.z=1+Math.cos(t*4.1)*.05;
   if(innerFlame){
    innerFlame.scale.x=1+Math.cos(t*5.2)*.04;
    innerFlame.scale.y=1+Math.sin(now*.013+1)*.075;
    innerFlame.scale.z=1+Math.sin(t*4.7)*.03;
    innerFlame.position.x=innerFlame.userData.baseX+Math.sin(t*2.7)*.01;
    innerFlame.position.z=innerFlame.userData.baseZ+Math.cos(t*2.1)*.01;
   }
  }
 }
 for(let i=0;i<sparks.length;i++){
  const spark=sparks[i],base=spark.userData;
  if(reducedMotion){
   spark.position.set(base.baseX,base.baseY,base.baseZ);
  }else{
   const rise=(t*.44+i/3)%1;
   spark.position.set(
    base.baseX+Math.sin(t*2.1+i*2.4)*.055,
    base.baseY-.08+rise*.38,
    base.baseZ+Math.cos(t*1.7+i*2.0)*.055);
  }
 }
}

export function applyFireLightSettings(ctx,group,kind,night=0){
 const data=(group?.userData?.fireOrigin??group)?.userData;
 const light=data?.light??group?.userData?.light;
 if(!light)return null;
 const state=fireLighting(ctx.settings??{},kind,night);
 if(light.position.y!==state.height){
  light.position.y=state.height;
  if(light.shadow)light.shadow.needsUpdate=true;
 }
 light.distance=state.visibilityDistance;
 light.decay=state.decay;
 light.userData??={};
 if(light.userData.shadowCasterRange!==state.radius){
  light.userData.shadowCasterRange=state.radius;
  if(light.shadow)light.shadow.needsUpdate=true;
 }
 light.intensity=state.intensity;
 if(light.shadow?.camera &&
    Math.abs(light.shadow.camera.far-state.visibilityDistance-1)>.1){
  light.shadow.camera.far=state.visibilityDistance+1;
  light.shadow.camera.updateProjectionMatrix?.();
  light.shadow.needsUpdate=true;
 }
 return state;
}

// One PointLight and one cubemap per fire. The map includes trees, buildings
// and characters. All in-range maps remain sampled; only the nearest N refresh.
export function applyFireShadowMode(ctx,group,policy,now=0,distance=0){
 const data=(group?.userData?.fireOrigin??group)?.userData;
 const light=data?.light??group?.userData?.light;
 if(!light)return;
 light.userData??={};
 const radius=light.userData.shadowCasterRange??30;
 const visible=policy.castShadow;
 const live=visible&&policy.autoUpdate&&distance<=radius+2;
 applyFireShadowPolicy(light,{castShadow:visible,autoUpdate:live});
 // Keep the last GPU cubemap unchanged when the refresh slot moves away.
 light.userData.shadowFrozen=visible&&!live;
 const revision=ctx.atmosphere?.staticShadowRevision??0;
 if(visible&&!live&&light.userData.lastCombinedRevision!==revision){
  if(light.shadow)light.shadow.needsUpdate=true;
 }
 light.userData.lastCombinedRevision=revision;
}
