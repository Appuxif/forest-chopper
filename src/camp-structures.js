import {CAMP_RECIPES,MAX_CAMP_STRUCTURES,validCampStructure,isFireKind} from './camp-rules.js';

// Procedural campsite with bounded lights, offline snapshots and online authority.
export function createCampStructures(ctx,doc=document){
  const {THREE,scene}=ctx,items=new Map();
  let lastId=0,lastLighting=0;
  const wood=new THREE.MeshLambertMaterial({color:0x805437});
  const stone=new THREE.MeshLambertMaterial({color:0x797c75});
  const flameMat=new THREE.MeshBasicMaterial({color:0xffa435});
  const woodGeo=new THREE.BoxGeometry(1,1,1);
  const rockGeo=new THREE.DodecahedronGeometry(.24,0);
  const flameGeo=new THREE.ConeGeometry(.23,.65,6);
  const button=doc.createElement('button');
  button.type='button';button.className='fc-camp-toggle';
  button.style.cssText='position:fixed;bottom:125px;left:50%;transform:translateX(-50%);z-index:9;padding:9px 13px;border-radius:9px;color:#f8efd5;background:#513b28;border:1px solid #afc09a;display:none';
  button.textContent='🔥 Зажечь / погасить (F)';doc.body.append(button);

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
      for(let i=0;i<9;i++){
        const angle=2*Math.PI*i/9;
        const rock=new THREE.Mesh(rockGeo,stone);rock.position.set(Math.sin(angle)*.66,.18,Math.cos(angle)*.66);
        rock.castShadow=true;g.add(rock);
      }
      for(let i=0;i<4;i++)beam(0,.22,0,1.25,.18,.17,wood,0,i*Math.PI/4);
      // A grounded obstacle rather than an invisible full-height box.
      collision.push({x:0,y:.20,z:0,w:1.6,h:.40,d:1.6});
    }else if(item.kind==='torch'){
      beam(0,.8,0,.14,1.6,.14,wood);
      beam(0,1.60,0,.28,.22,.28,wood);
    }else if(item.kind==='table'||item.kind==='workbench'){
      const h=item.kind==='workbench'?.9:.74;
      beam(0,h,0,2.0,.13,1.0,wood);
      for(const x of [-.85,.85])for(const z of [-.35,.35])beam(x,h/2,z,.13,h-.08,.13,wood);
      if(item.kind==='workbench'){
        beam(0,h+.13,.38,1.65,.16,.18,stone);
        beam(0,.34,0,1.6,.12,.7,wood);
      }
    }else if(item.kind==='fence'){
      for(const x of [-1,1])beam(x,.65,0,.15,1.3,.17,wood);
      for(const y of [.5,1.08])beam(0,y,0,2.25,.15,.13,wood);
    }
    let flame=null,light=null;
    if(isFireKind(item.kind)){
      flame=new THREE.Mesh(flameGeo,flameMat);
      flame.position.set(0,item.kind==='torch'?1.93:.55,0);
      g.add(flame);
      light=new THREE.PointLight(0xffaa55,item.kind==='torch'?1.6:2.2,item.kind==='torch'?8:11);
      light.position.copy(flame.position);light.castShadow=false;g.add(light);
      g.userData.flame=flame;g.userData.light=light;
    }
    g.userData.collisionBoxes=collision;
    g.userData.collisionRadius=item.kind==='torch'?1.2:2.3;
    g.position.set(item.x,ctx.terrain.heightAt(item.x,item.z),item.z);
    g.rotation.y=item.orientation*Math.PI/2;
    return g;
  }
  function updateFlame(item){
    const flame=item.group.userData.flame;
    if(flame)flame.visible=item.lit;
    const light=item.group.userData.light;
    // Enabled lights are selected in tick(): never light all saved fires at once.
    if(light)light.visible=false;
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
    if(item.id<0)lastId=Math.min(lastId,item.id);
    ctx.atmosphere?.invalidateStaticShadows?.();
    return true;
  }
  function remove(id){const item=items.get(id);if(!item)return false;
    scene.remove(item.group);items.delete(id);ctx.atmosphere?.invalidateStaticShadows?.();return true;}
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
  function use(){const fire=nearFire();return fire?toggle(fire.id):false;}
  function position(){
    return {x:Math.round((ctx.px-Math.sin(ctx.yaw)*3)*2)/2,
      z:Math.round((ctx.pz-Math.cos(ctx.yaw)*3)*2)/2};
  }
  function place(kind){
    const cost=CAMP_RECIPES[kind],inventory=ctx.inventory?.state;
    if(!cost||!inventory||!Object.entries(cost).every(([id,n])=>inventory.count(id)>=n))return false;
    if(items.size>=MAX_CAMP_STRUCTURES)return false;
    const {x,z}=position();
    if(ctx.terrain.waterDepthAt(x,z)>.12||[...items.values()].some(s=>Math.hypot(s.x-x,s.z-z)<2.4)
      ||[...ctx.storages?.structures?.values()??[]].some(s=>Math.hypot(s.x-x,s.z-z)<2.4))return false;
    if(ctx.isOnline?.()){ctx.sendNet({type:'camp_place',kind,x,z,orientation:ctx.orientation??0});return true;}
    const entry={kind,id:--lastId,x,z,orientation:ctx.orientation??0,lit:false};
    if(!add(entry))return false;
    for(const [id,n] of Object.entries(cost))inventory.spend(id,n);
    ctx.wood=inventory.wood();ctx.inventory.render();ctx.offlineSave?.markDirty?.();
    return true;
  }
  function tick(now=0){
    const fire=nearFire();
    button.style.display=fire?'block':'none';
    if(fire)button.textContent=(fire.lit?'🕯️ Погасить':'🔥 Зажечь')+' (F)';
    if(now-lastLighting<200)return;
    lastLighting=now;
    // Three nearest lit fires receive actual light, others keep cheap emissive flames.
    const lit=[...items.values()].filter(x=>x.lit&&isFireKind(x.kind))
      .sort((a,b)=>Math.hypot(a.x-ctx.px,a.z-ctx.pz)-Math.hypot(b.x-ctx.px,b.z-ctx.pz));
    const lighted=new Set(lit.slice(0,3).map(x=>x.id));
    for(const item of items.values()){
      const light=item.group.userData.light;
      if(light)light.visible=item.lit&&lighted.has(item.id);
    }
  }
  button.onclick=use;
  return {add,remove,clear,set,snapshot,place,toggle,use,tick,nearFire,
    get items(){return items;}};
}
