import {fireLighting} from './lighting-profile.js?v=20261103-shadow-visibility-cache1';
import {fireShadowPolicy,selectFireShadowSources,STARTER_FIRE_ID} from './fire-shadow-policy.js?v=20261103-day-night-fire-shadows1';
import {createCampfireModel,attachAnimatedFire,animateCampfireModel,presentCampfireModel,disposeCampfireEffects,applyFireLightSettings,applyFireShadowMode} from './campfire-model.js?v=20261103-unified-sun-cascades1';
import {createFireVisibilityTester} from './fire-effects.js?v=20261102-night-lighting1';
import {CAMP_RECIPES,MAX_CAMP_STRUCTURES,validCampStructure,isFireKind} from './camp-rules.js';

// Procedural campsite with bounded lights, offline snapshots and online authority.
export function createCampStructures(ctx,doc=document){
  const {THREE,scene}=ctx,items=new Map();
  let lastId=0,lastLighting=-Infinity;
  const fireVisibility=createFireVisibilityTester(ctx);
  const wood=new THREE.MeshLambertMaterial({color:0x805437});
  const stone=new THREE.MeshLambertMaterial({color:0x797c75});
  const metal=new THREE.MeshStandardMaterial({color:0xb27a43,metalness:.67,roughness:.32});
  const darkMetal=new THREE.MeshStandardMaterial({color:0x474c4c,metalness:.55,roughness:.4});
  const glass=new THREE.MeshStandardMaterial({color:0xb8e1ed,transparent:true,opacity:.38,roughness:.13,metalness:.1,depthWrite:false,side:THREE.DoubleSide});
  const emerald=new THREE.MeshStandardMaterial({color:0x52b88b,transparent:true,opacity:.75,roughness:.25});
  const violet=new THREE.MeshStandardMaterial({color:0x8059ab,transparent:true,opacity:.8,roughness:.25});
  const mattress=new THREE.MeshLambertMaterial({color:0x8eaa8b});
  const pillow=new THREE.MeshLambertMaterial({color:0xd5d0b6});
  const woodGeo=new THREE.BoxGeometry(1,1,1);
  const rockGeo=new THREE.DodecahedronGeometry(.24,0);

  // Procedural woven-black-cloth map. Generated once, no external image asset.
  // Fine crossed threads plus uneven dark folds give the wrap a fabric surface.
  function createClothMap(){
    if(!THREE.CanvasTexture)return null;
    const canvas=doc?.createElement?.('canvas');
    const brush=canvas?.getContext?.('2d');
    if(!brush?.createImageData||!brush.putImageData)return null;
    canvas.width=128;canvas.height=128;
    const image=brush.createImageData(128,128);
    for(let y=0;y<128;y++)for(let x=0;x<128;x++){
      const fold=6*Math.sin(x*.16)+4*Math.sin(x*.43+y*.09);
      const threads=(x%4<2?5:-4)+(y%5<2?4:-3);
      const grain=3*Math.sin(x*3.7+y*2.9);
      const shade=Math.max(18,Math.min(62,37+fold+threads+grain));
      const i=(y*128+x)*4;
      image.data[i]=shade;
      image.data[i+1]=shade;
      image.data[i+2]=shade+1;
      image.data[i+3]=255;
    }
    brush.putImageData(image,0,0);
    const texture=new THREE.CanvasTexture(canvas);
    texture.wrapS=THREE.RepeatWrapping;
    texture.wrapT=THREE.RepeatWrapping;
    texture.colorSpace=THREE.SRGBColorSpace;
    return texture;
  }
  const clothTexture=createClothMap();
  const cloth=new THREE.MeshLambertMaterial({
    color:clothTexture?0xe8e8e8:0x222224,map:clothTexture,side:THREE.DoubleSide,
  });
  const clothFold=new THREE.MeshLambertMaterial({color:0x1c1c1e});

  function mesh(item){
    const g=new THREE.Group(),collision=[];
    function beam(x,y,z,w,h,d,material,rx=0,rz=0){
      const m=new THREE.Mesh(woodGeo,material);
      m.position.set(x,y,z);m.scale.set(w,h,d);m.rotation.x=rx;m.rotation.z=rz;
      m.castShadow=true;g.add(m);
      collision.push({x,y,z,w:Math.abs(w*Math.cos(rz))+Math.abs(h*Math.sin(rz)),
        h:Math.abs(w*Math.sin(rz))+Math.abs(h*Math.cos(rz)),d});
      return m;
    }
    if(item.kind==='campfire'){
      const fire=createCampfireModel(ctx);
      g.add(fire.group);
      g.userData.fireOrigin=fire.group;
      g.userData.flame=fire.flame;
      g.userData.innerFlame=fire.inner;
      g.userData.sparks=fire.sparks;
      g.userData.light=fire.light;
      collision.push(...fire.group.userData.collisionBoxes);
    }else if(item.kind==='torch'){
      // Same angular stones as the crafted campfire, clustered at the foot.
      for(let i=0;i<3;i++){
        const angle=i*Math.PI*2/3;
        const rock=new THREE.Mesh(rockGeo,stone);
        rock.position.set(Math.cos(angle)*.255,.14,Math.sin(angle)*.255);
        const scale=.88+(i%2)*.12;
        rock.scale.set(scale,.79+i*.055,scale);
        rock.rotation.y=angle;
        rock.castShadow=true;
        g.add(rock);
      }
      beam(0,.8,0,.14,1.6,.14,wood);
      // Fabric-wrapped cylindrical head, replacing the former square block.
      const head=new THREE.Mesh(new THREE.CylinderGeometry(.145,.128,.31,12,4),cloth);
      head.position.set(0,1.66,0);
      head.castShadow=true;
      g.add(head);
      // Uneven spiral folds give the black wrapping some silhouette.
      for(let i=0;i<3;i++){
        const fold=new THREE.Mesh(
          new THREE.CylinderGeometry(.148+i*.003,.145+i*.002,.055,12,1,true),
          clothFold);
        fold.position.set(0,1.55+i*.102,0);
        fold.rotation.z=(i-1)*.04;
        fold.rotation.y=i*.57;
        fold.castShadow=true;
        g.add(fold);
      }
    }else if(item.kind==='table'||item.kind==='workbench'){
      const h=item.kind==='workbench'?.9:.74;
      beam(0,h,0,2.0,.13,1.0,wood);
      for(const x of [-.85,.85])for(const z of [-.35,.35])beam(x,h/2,z,.13,h-.08,.13,wood);
      if(item.kind==='workbench'){
        beam(0,h+.13,.38,1.65,.16,.18,stone);
        beam(0,.34,0,1.6,.12,.7,wood);
      }
    }else if(item.kind==='alchemy_table'){
      // A heavy wooden laboratory workbench with a stone-covered top.
      beam(0,.94,0,2.25,.17,1.20,wood);
      beam(0,1.055,0,2.12,.085,1.08,stone);
      for(const x of [-.96,.96])for(const z of [-.42,.42])
        beam(x,.45,z,.16,.85,.16,wood);
      beam(0,.36,-.38,1.9,.12,.12,wood);
      beam(0,.38,.38,1.9,.12,.12,wood);
      // The still / copper distillation cube with an angled neck and spout.
      function prop(geometry,material,x,y,z){
        const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);
        m.castShadow=true;g.add(m);return m;
      }
      prop(new THREE.CylinderGeometry(.27,.31,.36,12),metal,-.58,1.29,-.12);
      prop(new THREE.CylinderGeometry(.13,.20,.12,12),darkMetal,-.58,1.51,-.12);
      prop(new THREE.CylinderGeometry(.064,.065,.34,10),metal,-.58,1.69,-.12);
      const pipe=prop(new THREE.CylinderGeometry(.045,.045,.70,9),metal,-.30,1.77,-.12);
      pipe.rotation.z=Math.PI/2-.20;
      prop(new THREE.CylinderGeometry(.055,.05,.30,9),metal,.06,1.62,-.12);
      // Retort: a round glass flask and a long tilted outlet.
      prop(new THREE.SphereGeometry(.19,12,9),glass,.42,1.38,-.28);
      prop(new THREE.SphereGeometry(.155,12,9),emerald,.42,1.35,-.28);
      const retort=prop(new THREE.CylinderGeometry(.045,.06,.45,10),glass,.56,1.57,-.28);
      retort.rotation.z=-.57;
      // Three laboratory flasks, partially filled with coloured solutions.
      for(const [x,z,fill] of [[-.22,.32,violet],[.26,.32,emerald],[.70,.29,violet]]){
        prop(new THREE.SphereGeometry(.14,12,9),glass,x,1.28,z);
        prop(new THREE.SphereGeometry(.105,12,9),fill,x,1.255,z);
        prop(new THREE.CylinderGeometry(.045,.07,.22,10),glass,x,1.47,z);
        prop(new THREE.CylinderGeometry(.08,.08,.055,10),darkMetal,x,1.59,z);
      }
    }else if(item.kind==='bed'){
      // A low wooden bed, green mattress and a recognizable pillow.
      for(const x of [-.58,.58])beam(x,.38,0,.14,.60,2.00,wood);
      beam(0,.37,-.91,1.36,.63,.14,wood);
      beam(0,.27,.92,1.36,.28,.14,wood);
      beam(0,.47,0,1.12,.26,1.78,mattress);
      beam(0,.64,-.62,.85,.10,.36,pillow);
      for(const x of [-.56,.56])for(const z of [-.92,.92])
        beam(x,.18,z,.12,.36,.12,wood);
    }else if(item.kind==='fence'){
      for(const x of [-1,1])beam(x,.65,0,.15,1.3,.17,wood);
      for(const y of [.5,1.08])beam(0,y,0,2.25,.15,.13,wood);
    }
    if(item.kind==='torch'){
      attachAnimatedFire(ctx,g,{
        kind:'torch',baseY:2.08,innerOffset:{x:.035,y:-.10,z:.012},
        lightY:2.23,lightIntensity:1.6,lightDistance:8,
        sparkY:2.30,sparkSpacing:.10,sparkSpread:.095,sparkDepth:.07,
      });
    }
    g.userData.collisionBoxes=collision;
    g.userData.collisionRadius=item.kind==='torch'?1.2:2.3;
    g.position.set(item.x,ctx.terrain.heightAt(item.x,item.z),item.z);
    g.rotation.y=item.orientation*Math.PI/2;
    return g;
  }
  function updateFlame(item){
    if(!isFireKind(item.kind))return;
    const distance=Math.hypot(item.x-ctx.px,item.z-ctx.pz);
    presentCampfireModel(ctx,item.group,{lit:item.lit,distance});
    applyFireLightSettings(ctx,item.group,item.kind,ctx.terrain?.nightBlend??0);
    // Enabled lights are selected in tick(): never light all saved fires at once.
    if(item.group.userData.light)item.group.userData.light.visible=false;
  }
  function add(item){
    if(!validCampStructure(item))return false;
    const existing=items.get(item.id);
    if(existing&&existing.kind===item.kind&&existing.x===item.x&&existing.z===item.z&&existing.orientation===item.orientation){
      existing.lit=item.lit;updateFlame(existing);return true;
    }
    if(existing)remove(item.id);
    if(items.size>=MAX_CAMP_STRUCTURES)return false;
    const entry={...item,group:mesh(item)};
    items.set(item.id,entry);scene.add(entry.group);updateFlame(entry);
    ctx.collisionWorld?.invalidate?.();
    if(item.id<0)lastId=Math.min(lastId,item.id);
    ctx.atmosphere?.invalidateStaticShadows?.();
    return true;
  }
  function remove(id){const item=items.get(id);if(!item)return false;
    disposeCampfireEffects(item.group);
    const origin=item.group.userData.fireOrigin??item.group;
    origin.userData.light?.shadow?.dispose?.();
    scene.remove(item.group);items.delete(id);ctx.collisionWorld?.invalidate?.();ctx.deathSystem?.onStructureRemoved?.(id);ctx.atmosphere?.invalidateStaticShadows?.();return true;}
  function clear(){for(const id of [...items.keys()])remove(id);}
  function set(list){clear();for(const item of list??[])add(item);}
  function snapshot(){return [...items.values()].map(({group,...item})=>({...item}));}
  function nearFire(radius=3.2){
    let nearest=null,distance=radius;
    for(const item of items.values())if(isFireKind(item.kind)){
      const d=Math.hypot(ctx.px-item.x,ctx.pz-item.z);
      if(d<distance){nearest=item;distance=d;}
    }
    return nearest;
  }
  function toggle(id){
    const item=items.get(id);
    if(!item||!isFireKind(item.kind)||Math.hypot(ctx.px-item.x,ctx.pz-item.z)>3.2)return false;
    if(ctx.isOnline?.()){ctx.sendNet({type:'camp_toggle',id});return true;}
    item.lit=!item.lit;updateFlame(item);ctx.offlineSave?.markDirty?.();return true;
  }
  function activate(id){
    const item=items.get(id);
    if(!item||Math.hypot(ctx.px-item.x,ctx.pz-item.z)>3.2)return false;
    return item.kind==='bed'?(ctx.ragdollControls?.sleepInBed(item),true):toggle(id);
  }
  function use(){const fire=nearFire();return fire?toggle(fire.id):false;}
  function position(){
    return {x:Math.round((ctx.px-Math.sin(ctx.yaw)*3)*2)/2,
      z:Math.round((ctx.pz-Math.cos(ctx.yaw)*3)*2)/2};
  }
  function place(kind){
    const inventory=ctx.inventory?.state;
    if(!Object.hasOwn(CAMP_RECIPES,kind)||ctx.inventory?.selected!==kind||
       !inventory||inventory.count(kind)<1||items.size>=MAX_CAMP_STRUCTURES)return false;
    const {x,z}=position();
    if(ctx.terrain.waterDepthAt(x,z)>.12||
      [...items.values()].some(s=>Math.hypot(s.x-x,s.z-z)<2.4)||
      [...ctx.storages?.structures?.values()??[]].some(s=>Math.hypot(s.x-x,s.z-z)<2.4))return false;
    if(ctx.isOnline?.()){ctx.sendNet({type:'camp_place',kind,x,z,orientation:(ctx.orientation??0)%4});return true;}
    const entry={kind,id:--lastId,x,z,orientation:(ctx.orientation??0)%4,lit:false};
    if(!add(entry))return false;
    if(!inventory.consumeSelected(kind)){remove(entry.id);return false;}
    ctx.wood=inventory.wood();ctx.inventory.render();ctx.offlineSave?.markDirty?.();
    return true;
  }
  function dismantle(id){
    const item=items.get(id),inventory=ctx.inventory?.state;
    if(!item||!ctx.inventory?.equipped||!inventory||
       Math.hypot(ctx.px-item.x,ctx.pz-item.z)>6)return false;
    const reward={id:item.kind,count:1};
    if(!inventory.canAdd(reward)){
      ctx.notify?.('Сумка заполнена или превышен вес','warning');return false;
    }
    if(ctx.isOnline?.()){ctx.sendNet({type:'hit_structure',kind:'camp',id});return true;}
    if(!inventory.addItem(reward))return false;
    remove(id);ctx.inventory.render();ctx.offlineSave?.markDirty?.();
    ctx.notify?.('Постройка возвращена в сумку','success');return true;
  }
  const reducedMotion=typeof matchMedia==='function'
    ?matchMedia('(prefers-reduced-motion: reduce)'):{matches:false};
  function tick(now=0){
    if(now-lastLighting>=150){
      lastLighting=now;
      fireVisibility.begin();
      // Visibility and distance LOD are resolved only ~7 times/sec.
      // Off-camera effects have no draw calls and no CPU animation.
      for(const item of items.values()){
        if(!isFireKind(item.kind))continue;
        const distance=Math.hypot(item.x-ctx.px,item.z-ctx.pz);
        const onScreen=item.lit&&fireVisibility.visible(
          item.x,item.group.position.y,item.z,item.kind,distance);
        presentCampfireModel(ctx,item.group,{lit:item.lit,distance,onScreen});
      }
      const lit=[...items.values()].filter(x=>x.lit&&isFireKind(x.kind))
        .sort((a,b)=>Math.hypot(a.x-ctx.px,a.z-ctx.pz)-Math.hypot(b.x-ctx.px,b.z-ctx.pz));
      const night=ctx.terrain?.nightBlend??0;
      // All fire lights inside their activation distance can illuminate and
      // display cached shadow maps. The independent 0–4 budget only limits
      // sources whose dynamic cubemaps refresh each rendered frame.
      const lighted=new Set(lit.filter(item=>
        Math.hypot(item.x-ctx.px,item.z-ctx.pz)<
          fireLighting(ctx.settings??{},item.kind,night).activationDistance+2
      ).map(item=>item.id));
      const candidates=[];
      for(const item of lit){
        const light=item.group.userData.light;
        if(!light)continue;
        const lighting=applyFireLightSettings(ctx,item.group,item.kind,night);
        const dist=Math.hypot(item.x-ctx.px,item.z-ctx.pz);
        // Existing PointLights stay attached to the fire and retain their
        // shadow maps while inactive. The slider only changes visibility.
        light.visible=lighted.has(item.id)&&dist<lighting.activationDistance+2;
        candidates.push({id:item.id,distance:dist,
          radius:lighting.radius,
          visible:light.visible});
      }
      const starterDistance=ctx.landmarks?.fireDistance??Infinity;
      if(Number.isFinite(starterDistance)){
        const starterProfile=fireLighting(ctx.settings??{},'campfire',night);
        candidates.push({id:STARTER_FIRE_ID,distance:starterDistance,
          radius:starterProfile.radius,
          visible:starterDistance<starterProfile.activationDistance+2});
      }
      const shadowSources=selectFireShadowSources(candidates,
        ctx.settings?.fireShadowLimit??2,100);
      for(const item of lit){
        const light=item.group.userData.light;
        if(!light)continue;
        applyFireShadowMode(ctx,item.group,fireShadowPolicy({
          night,settings:ctx.settings,selected:shadowSources.has(item.id),
          visible:light.visible,distance:Math.hypot(item.x-ctx.px,item.z-ctx.pz),
          radius:fireLighting(ctx.settings??{},item.kind,night).shadowVisibilityDistance,
          maxRange:100,
        }),now,Math.hypot(item.x-ctx.px,item.z-ctx.pz));
      }
      for(const item of items.values())if(!item.lit&&item.group.userData.light){
        item.group.userData.light.visible=false;
        applyFireShadowMode(ctx,item.group,{castShadow:false,autoUpdate:false},now);
          }
    }
    for(const item of items.values()){
      if(!item.lit||!isFireKind(item.kind))continue;
      const data=(item.group.userData.fireOrigin??item.group).userData;
      if(data.fireEffects?.tier==='off'||data.fireEffects?.tier==='glow')continue;
      if(Math.hypot(item.x-ctx.px,item.z-ctx.pz)<100)
        animateCampfireModel(item.group,now,reducedMotion.matches,true,ctx);
    }
  }
  return {add,remove,clear,set,snapshot,place,dismantle,toggle,activate,use,tick,nearFire,
    createIconModel:kind=>kind==='campfire'?createCampfireModel(ctx).group:mesh({kind,x:0,z:0,orientation:0,lit:false}),
    get items(){return items;}};
}
