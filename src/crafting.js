// One intentionally small, real recipe. Server is authoritative in online rooms.
export const BENCH_COST=3;
export const BENCH_REFUND=2;
export const MAX_BENCHES=200;
export const validBench = item => item?.kind==='bench' && [0,1,2,3].includes(item.orientation) &&
  Number.isFinite(item.x) && Number.isFinite(item.z) &&
  Math.abs(item.x)<=240000 && Math.abs(item.z)<=240000 &&
  Math.abs(item.x*2-Math.round(item.x*2))<1e-4 &&
  Math.abs(item.z*2-Math.round(item.z*2))<1e-4;

export function createCrafting(ctx,doc=document) {
  const THREE=ctx.THREE,items=new Map();
  // Shared unit geometries, not unique meshes/textures for each placed bench.
  const beamGeo=new THREE.BoxGeometry(1,1,1);
  const boltGeo=new THREE.CylinderGeometry(.035,.035,.018,6);
  const plankMat=new THREE.MeshLambertMaterial({color:0xb68a54});
  const legMat=new THREE.MeshLambertMaterial({color:0x705038});
  const metalMat=new THREE.MeshLambertMaterial({color:0x3e4542});
  const ghostMat=new THREE.MeshLambertMaterial({color:0x83efb5,transparent:true,opacity:.48,depthWrite:false});
  // Shorter legs, with the existing seat/back/arm proportions unchanged.
  // Moving all upper parts together keeps them connected to the new leg tops.
  const legHeight=.75*.5,seatDrop=.75-legHeight;
  const upperY=y=>y-seatDrop;
  let offlineId=0;
  function mesh(item,preview=false){
    const g=new THREE.Group();
    // Collider primitives follow the actual procedural mesh: no duplicated
    // dimensions or manual offsets in the physics module.
    const collisionBoxes=[];
    const make=(name,x,y,z,w,h,d,material,rotX=0,rotZ=0)=>{
      const m=new THREE.Mesh(beamGeo,preview?ghostMat:material);
      m.name=name;m.position.set(x,y,z);m.scale.set(w,h,d);
      m.rotation.x=rotX;m.rotation.z=rotZ;m.castShadow=true;g.add(m);
      const cx=Math.abs(Math.cos(rotX)),sx=Math.abs(Math.sin(rotX));
      const cz=Math.abs(Math.cos(rotZ)),sz=Math.abs(Math.sin(rotZ));
      const rotatedHeight=cx*h+sx*d;
      collisionBoxes.push({x,y,z,w:cz*w+sz*rotatedHeight,
        h:cz*rotatedHeight+sz*w,d:cx*d+sx*h});
      return m;
    };
    // Four independently visible slightly rounded-looking slats (thin dark gaps).
    for(let i=0;i<4;i++)
      make('Seat slat '+i,0,upperY(.90),-.315+i*.21,2.12,.105,.176,plankMat);
    // Under-seat frame, cross rails and legs with a mild outward splay.
    for(const x of [-.88,.88]){
      make('Seat support',x,upperY(.775),.02,.16,.18,.92,legMat);
      for(const z of [-.27,.32])
        make('Leg',x+(x<0?-.045:.045),legHeight/2+.015,z,.145,legHeight,.17,legMat,0,x<0?-.055:.055);
      make('Cross brace',x,.43*.5,.02,.12,.13,.77,legMat);
      make('Back upright',x,upperY(1.28),.41,.10,1.15,.10,legMat,-.13);
      make('Armrest',x,upperY(1.22),-.09,.12,.065,.66,plankMat,-.08);
      make('Arm post',x,upperY(1.04),-.34,.09,.34,.09,legMat);
    }
    // Three separate backrest planks, leaning at a comfortable angle.
    for(let i=0;i<3;i++)
      make('Backrest slat '+i,0,upperY(1.24+i*.24),.44+i*.037,2.14,.095,.075,plankMat,-.15);
    // Slim end-braces strengthen the silhouette without excessive geometry.
    make('Lower crossrail',0,.27*.5,.32,1.78,.12,.13,legMat);
    for(const x of [-.81,.81])for(const y of [1.28,1.72]){
      const rivet=new THREE.Mesh(boltGeo,preview?ghostMat:metalMat);
      rivet.name='Metal fastener';rivet.position.set(x,upperY(y),.54+(y-1.28)*.155);
      rivet.rotation.x=Math.PI/2;rivet.castShadow=true;g.add(rivet);
    }
    g.userData.collisionBoxes=collisionBoxes;
    g.userData.collisionRadius=Math.max(1,...collisionBoxes.map(b=>Math.hypot(b.x,b.z)+Math.hypot(b.w,b.d)/2));
    g.position.set(item.x,ctx.terrain.heightAt(item.x,item.z),item.z);
    g.rotation.y=item.orientation*Math.PI/2;
    if(preview)g.userData.itemPreview='bench';
    return g;
  }
  function add(item){
    if(!validBench(item)||items.size>=MAX_BENCHES||items.has(item.id))return false;
    const group=mesh(item);ctx.scene.add(group);
    items.set(item.id,{...item,group});
    ctx.atmosphere?.invalidateStaticShadows?.();
    if(Number.isInteger(item.id) && item.id<0)offlineId=Math.min(offlineId,item.id);
    return true;
  }
  function remove(id){
    const old=items.get(id);if(!old)return false;
    ctx.scene.remove(old.group);items.delete(id);
    ctx.atmosphere?.invalidateStaticShadows?.();
    return true;
  }
  function clear(){for(const id of [...items.keys()])remove(id);}
  function candidate(){
    const x=Math.round((ctx.px-Math.sin(ctx.yaw)*3.7)*2)/2;
    const z=Math.round((ctx.pz-Math.cos(ctx.yaw)*3.7)*2)/2;
    return {kind:'bench',x,z,orientation:ctx.orientation};
  }
  function createPreview(){return mesh({kind:'bench',x:0,z:0,orientation:0},true);}
  function colorPreview(group,invalid){if(group)ghostMat.color.setHex(invalid?0xff6666:0x83efb5);}
  function craftItem(){
    if(ctx.inventory){
      if(ctx.wood<3)return false;
      if(ctx.isOnline()){ctx.sendNet({type:'craft_item',recipe:'bench'});return true;}
      if(!ctx.inventory.state.craftBench()){ctx.notify('Нет места в сумке','warning');return false;}
      ctx.wood=ctx.inventory.state.wood();ctx.inventory.render();ctx.offlineSave.markDirty();
      ctx.notify('🪑 Скамейка скрафчена','success');return true;
    }
    return false;
  }
  function placeItem(){
    if(!ctx.inventory || ctx.inventory.selected!=='bench')return false;
    const item=candidate(),error=allowed(item);
    if(error){ctx.notify(error,'warning');return false;}
    if(ctx.isOnline()){ctx.sendNet({type:'place_item',x:item.x,z:item.z,orientation:item.orientation});return true;}
    if(!add({...item,id:--offlineId}))return false;
    ctx.inventory.state.removeBench(ctx.inventory.state.selectedSlot());
    ctx.inventory.render();ctx.offlineSave.markDirty();
    ctx.notify('🪑 Скамейка установлена','success');return true;
  }
  function allowed(item){
    if(ctx.inventory){if(ctx.inventory.selected!=='bench')return 'Выбери скамейку в быстром слоте';}
    else if(!ctx.buildMode)return 'Включите строительство';
    // The inventory bench is already paid for during crafting.
    if(!ctx.inventory && ctx.wood<BENCH_COST)return 'Для скамейки нужны 3 🪵';
    if(items.size>=MAX_BENCHES)return 'Достигнут лимит скамеек';
    if(ctx.terrain.waterDepthAt(item.x,item.z)>.2)return 'Нельзя ставить скамейку в воде';
    if([...ctx.trees.values()].some(t=>Math.hypot(t.position.x-item.x,t.position.z-item.z)<.75)
       || ctx.blocksPlayerAt(item.x,item.z,ctx.terrain.heightAt(item.x,item.z)))return 'Место занято';
    if([...items.values()].some(x=>Math.hypot(x.x-item.x,x.z-item.z)<2.5))
      return 'Скамейка уже стоит слишком близко';
    return '';
  }
  function place(){
    const item=candidate(),error=allowed(item);
    if(error){ctx.notify(error,'warning','bench-invalid');return false;}
    if(ctx.isOnline()){
      ctx.sendNet({type:'craft',recipe:'bench',x:item.x,z:item.z,orientation:item.orientation});
      return true; // Await server confirmation. Never debit optimistically.
    }
    item.id=--offlineId;
    if(!add(item))return false;
    ctx.wood-=BENCH_COST;ctx.$('wood').textContent=ctx.wood;
    ctx.offlineSave.markDirty();
    ctx.notify('🪑 Скамейка установлена · −3 🪵','success','bench-add');
    return true;
  }
  function dismantle(id){
    const item=items.get(id);if(!item||!ctx.inventory?.equipped)return false;
    if(Math.hypot(item.x-ctx.px,item.z-ctx.pz)>6)return false;
    if(!ctx.inventory.state.hasSpace()){ctx.notify('Сумка заполнена или превышен лимит 100 кг','warning');return false;}
    if(ctx.isOnline()){ctx.sendNet({type:'hit_structure',kind:'bench',id});return true;}
    if(!ctx.inventory.state.addBench())return false;
    remove(id);ctx.inventory.render();ctx.offlineSave.markDirty();
    ctx.notify('🪑 Скамейка возвращена в сумку','success');return true;
  }
  function removeNear(){
    if(!ctx.buildMode)return false;
    const item=candidate();
    const nearest=[...items.values()].map(x=>({...x,d:Math.hypot(x.x-item.x,x.z-item.z)}))
      .sort((a,b)=>a.d-b.d)[0];
    if(!nearest||nearest.d>2.4){ctx.notify('Поблизости нет скамейки','warning','bench-none');return false;}
    if(ctx.isOnline()){
      ctx.sendNet({type:'remove_furniture',id:nearest.id});
      return true;
    }
    remove(nearest.id);ctx.wood+=BENCH_REFUND;ctx.$('wood').textContent=ctx.wood;
    ctx.offlineSave.markDirty();
    ctx.notify('🪑 Скамейка убрана · +2 🪵','success','bench-remove');
    return true;
  }
  const buildbar=ctx.$('buildbar');
  const placeButton=doc.createElement('button');
  placeButton.id='fc-craft-bench';placeButton.type='button';
  placeButton.textContent='🪑 Скамейка · 3 🪵';placeButton.style.display='none';
  placeButton.onclick=place;
  const removeButton=doc.createElement('button');
  removeButton.id='fc-remove-bench';removeButton.type='button';
  removeButton.textContent='↶ Убрать скамейку · +2 🪵';removeButton.style.display='none';
  removeButton.onclick=removeNear;
  buildbar.append(placeButton,removeButton);
  function setMode(on){placeButton.style.display=removeButton.style.display=ctx.inventory?'none':on?'block':'none';}
  function snapshot(){return [...items.values()].map(({kind,x,z,orientation})=>({kind,x,z,orientation}));}
  return {add,remove,clear,place,removeNear,setMode,snapshot,createPreview,createIconModel:()=>mesh({x:0,z:0,orientation:0},false),colorPreview,placeError:allowed,candidate,placeItem,craftItem,dismantle,
    get items(){return items;}};
}
