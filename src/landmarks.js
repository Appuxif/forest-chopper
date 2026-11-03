import {fireLighting} from './lighting-profile.js?v=20261103-shadow-visibility-cache1';
import {fireShadowPolicy,selectFireShadowSources,STARTER_FIRE_ID} from './fire-shadow-policy.js?v=20261103-day-night-fire-shadows1';
import {createCampfireModel,animateCampfireModel,presentCampfireModel,disposeCampfireEffects,applyFireLightSettings,applyFireShadowMode} from './campfire-model.js?v=20261103-unified-sun-cascades1';
import {createFireVisibilityTester} from './fire-effects.js?v=20261102-night-lighting1';
import {createTrailTexture} from './trail-texture.js';
// Shared low-poly navigation cues. The trail is purely visual:
// tree spawn coordinates, collision, server and save state remain unchanged.
export function createLandmarks(ctx,doc=document) {
  const THREE=ctx.THREE;
  const trailGeometry=new THREE.PlaneGeometry(ctx.chunkSize,3.2,12,4);
  const trailMaterial=new THREE.MeshLambertMaterial({
    map:createTrailTexture(THREE,doc,ctx.chunkSize,ctx.renderer),
    side:THREE.DoubleSide,
  });
  const poleGeometry=new THREE.CylinderGeometry(.115,.15,2.1,6);
  const poleMaterial=new THREE.MeshLambertMaterial({color:0x76553b});
  const boardGeometry=new THREE.PlaneGeometry(3.0,.8);
  const reduceMotion=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):{matches:false};
  let activeFire=null,lastFireTick=-Infinity,lastVisibility=-Infinity;
  const fireVisibility=createFireVisibilityTester(ctx);

  const boardMaterials=['←  К НАЧАЛУ','К НАЧАЛУ  →'].map(label=>{
    const canvas=doc.createElement('canvas');
    canvas.width=512;canvas.height=128;
    const g=canvas.getContext('2d');
    g.fillStyle='#d8bc85';g.fillRect(0,0,512,128);
    g.strokeStyle='#755638';g.lineWidth=12;g.strokeRect(6,6,500,116);
    g.font='bold 34px sans-serif';g.fillStyle='#34291b';g.textAlign='center';
    g.textBaseline='middle';g.fillText(label,256,64,470);
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    return new THREE.MeshLambertMaterial({map:texture,side:THREE.DoubleSide});
  });

  function signPosition(cx,cz) {
    const candidates=[[12,4.8],[17,4.8],[7,4.8],[12,7.8],[17,7.8]];
    for(const [ox,oz] of candidates) {
      const x=cx*ctx.chunkSize+ox,z=cz*ctx.chunkSize+oz;
      let blocked=false;
      // Consider the original deterministic positions, even for already-felled trees.
      for(let i=0;i<8;i++){
        const tx=cx*ctx.chunkSize+ctx.rand(cx,cz,i*3)*ctx.chunkSize;
        const tz=cz*ctx.chunkSize+ctx.rand(cx,cz,i*3+1)*ctx.chunkSize;
        if(Math.hypot(tx,tz)<8)continue;
        if((tx-x)**2+(tz-z)**2<3*3){blocked=true;break;}
      }
      if(!blocked)return {x,z};
    }
    return null;
  }

  function createCampfire(parent) {
    if(activeFire){
      disposeCampfireEffects(activeFire.group);
      activeFire.light?.shadow?.dispose?.();
    }
    const visual=createCampfireModel(ctx,{shadows:true});
    const fire=visual.group;
    fire.position.set(5,ctx.terrain.heightAt(5,5),5);
    fire.userData.landmark='campfire';
    parent.add(fire);
    parent.userData?.shadowDecor?.push(fire);
    parent.userData?.grassClearings?.push({x:5,z:5,radius:1.65});
    activeFire={parent,...visual};
    lastFireTick=-Infinity;lastVisibility=-Infinity;
  }

  function tick(now) {
    if(!activeFire)return;
    if(ctx.chunks.get('0,0')!==activeFire.parent){
      disposeCampfireEffects(activeFire.group);
      activeFire.light?.shadow?.dispose?.();
      activeFire=null;return;
    }
    if(!Number.isFinite(now))return;
    const {light,group}=activeFire;
    const distance=Math.hypot(ctx.px-5,ctx.pz-5);
    if(now-lastVisibility>=150){
      lastVisibility=now;fireVisibility.begin();
      const onScreen=fireVisibility.visible(5,group.position.y,5,'campfire',distance);
      presentCampfireModel(ctx,group,{lit:true,distance,onScreen});
      const lighting=applyFireLightSettings(ctx,group,'campfire',ctx.terrain?.nightBlend??0);
      light.visible=distance<lighting.activationDistance+2;
    }
    // This runs each game tick; autoUpdate lets WebGL refresh the selected
    // fire's cubemap on every rendered frame even without a VFX update.
    const night=ctx.terrain?.nightBlend??0;
    const built=[...(ctx.campStructures?.items?.values()??[])]
      .filter(item=>item.lit&&(item.kind==='torch'||item.kind==='campfire'))
      .map(item=>{
        const profile=fireLighting(ctx.settings??{},item.kind,night);
        return {
          id:item.id,distance:Math.hypot(item.x-ctx.px,item.z-ctx.pz),
          radius:profile.radius,
          activationDistance:profile.activationDistance,
        };
      })
      .filter(item=>item.distance<item.activationDistance+2)
      .sort((a,b)=>a.distance-b.distance);
    const candidates=built.map(item=>({
      ...item,visible:true,
    }));
    const shadowVisibility=fireLighting(ctx.settings??{},'campfire',night).shadowVisibilityDistance;
    const casterRadius=fireLighting(ctx.settings??{},'campfire',night).radius;
    candidates.push({id:STARTER_FIRE_ID,distance,
      radius:casterRadius,visible:light.visible});
    const shadowSources=selectFireShadowSources(candidates,
      ctx.settings?.fireShadowLimit??2,100);
    applyFireShadowMode(ctx,group,fireShadowPolicy({
      night,settings:ctx.settings,selected:shadowSources.has(STARTER_FIRE_ID),
      visible:light.visible,distance,
      radius:shadowVisibility,maxRange:100,
    }),now,distance);
    const tier=group.userData.fireEffects?.tier;
    if(tier==='off'||tier==='glow'||distance>=100){
      if(reduceMotion.matches){
        animateCampfireModel(group,now,true,true,ctx);
        applyFireLightSettings(ctx,group,'campfire',ctx.terrain?.nightBlend??0);
      }
      return;
    }
    if(reduceMotion.matches){
      animateCampfireModel(group,now,true,true,ctx);
      applyFireLightSettings(ctx,group,'campfire',ctx.terrain?.nightBlend??0);
      return;
    }
    // Spark motion stays independent of the legacy low-poly flame throttle.
    animateCampfireModel(group,now,false,false,ctx);
    if(now-lastFireTick<150)return;
    lastFireTick=now;
    animateCampfireModel(group,now,false,true,ctx);
    applyFireLightSettings(ctx,group,'campfire',ctx.terrain?.nightBlend??0);
    const flicker=1+Math.sin(now*.007)*.06;
    light.intensity*=flicker;
  }

  function decorate(group,cx,cz) {
    if(cz!==0)return;
    // Trail follows the heightfield; each chunk owns its subdivided geometry.
    const centerX=cx*ctx.chunkSize+ctx.chunkSize/2;
    const geometry=trailGeometry.clone();
    const vertices=geometry.getAttribute('position');
    for(let i=0;i<vertices.count;i++){
      const x=centerX+vertices.getX(i),z=-vertices.getY(i);
      vertices.setZ(i,ctx.terrain.heightAt(x,z)+.025);
    }
    vertices.needsUpdate=true;
    geometry.computeVertexNormals();
    (group.userData.terrainGeometries??=[]).push(geometry);
    const trail=new THREE.Mesh(geometry,trailMaterial);
    trail.rotation.x=-Math.PI/2;
    trail.position.set(centerX,0,0);
    // This plane covers the real ground; without receiveShadow trees cannot
    // darken the trail even though the ground below receives shadows.
    trail.receiveShadow=true;
    trail.userData.landmark='trail';
    group.add(trail);
    if(cx===0)createCampfire(group);

    // Every third chunk, one noninteractive sign on the edge of the trail.
    if(cx%3!==0)return;
    const position=signPosition(cx,cz);
    if(!position)return;
    const pole=new THREE.Mesh(poleGeometry,poleMaterial);
    pole.position.set(position.x,ctx.terrain.heightAt(position.x,position.z)+1.05,position.z);
    pole.userData.landmark='signpost';
    pole.castShadow=true;
    group.add(pole);
    group.userData?.shadowDecor?.push(pole);
    group.userData?.grassClearings?.push({x:position.x,z:position.z,radius:.85});
    const board=new THREE.Mesh(boardGeometry,boardMaterials[cx<0?1:0]);
    board.position.set(position.x,ctx.terrain.heightAt(position.x,position.z)+2.0,position.z);
    board.rotation.y=Math.PI; // Facing the trail to the south; readable from the path.
    board.userData.landmark='signboard';
    board.castShadow=true;
    group.add(board);
    group.userData?.shadowDecor?.push(board);
  }
  return {decorate,signPosition,tick,
    get fireDistance(){return activeFire?Math.hypot(ctx.px-5,ctx.pz-5):Infinity;}};
}
