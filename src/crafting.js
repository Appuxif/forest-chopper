// One intentionally small, real recipe. Server is authoritative in online rooms.
export const BENCH_COST=3;
export const BENCH_REFUND=2;
export const MAX_BENCHES=200;
export const validBench = item => item?.kind==='bench' && [0,1].includes(item.orientation) &&
  Number.isFinite(item.x) && Number.isFinite(item.z) &&
  Math.abs(item.x)<=240000 && Math.abs(item.z)<=240000 &&
  Math.abs(item.x*2-Math.round(item.x*2))<1e-4 &&
  Math.abs(item.z*2-Math.round(item.z*2))<1e-4;

export function createCrafting(ctx,doc=document) {
  const THREE=ctx.THREE,items=new Map();
  const plankGeo=new THREE.BoxGeometry(2,.22,.7);
  const legGeo=new THREE.BoxGeometry(.18,.8,.18);
  const plankMat=new THREE.MeshLambertMaterial({color:0xa57849});
  const legMat=new THREE.MeshLambertMaterial({color:0x6c492d});
  let offlineId=0;
  function mesh(item){
    const g=new THREE.Group();
    const seat=new THREE.Mesh(plankGeo,plankMat);
    seat.position.set(0,.87,0);g.add(seat);
    for(const x of [-.75,.75])for(const z of [-.24,.24]){
      const leg=new THREE.Mesh(legGeo,legMat);leg.position.set(x,.4,z);g.add(leg);
    }
    const back=new THREE.Mesh(plankGeo,plankMat);
    back.position.set(0,1.28,.31);back.rotation.x=-.17;g.add(back);
    g.traverse?.(node=>{if(node.isMesh)node.castShadow=true;});
    // Test doubles and new craftable types can use plain children as well.
    for(const part of g.children)if(part.geometry)part.castShadow=true;
    g.position.set(item.x,0,item.z);
    g.rotation.y=item.orientation*Math.PI/2;
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
  function allowed(item){
    if(!ctx.buildMode)return 'Включите строительство';
    if(ctx.wood<BENCH_COST)return 'Для скамейки нужны 3 🪵';
    if(items.size>=MAX_BENCHES)return 'Достигнут лимит скамеек';
    if([...ctx.trees.values()].some(t=>Math.hypot(t.position.x-item.x,t.position.z-item.z)<.75)
       || ctx.blocksPlayerAt(item.x,item.z,0))return 'Место занято';
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
  function setMode(on){placeButton.style.display=removeButton.style.display=on?'block':'none';}
  function snapshot(){return [...items.values()].map(({kind,x,z,orientation})=>({kind,x,z,orientation}));}
  return {add,remove,clear,place,removeNear,setMode,snapshot,
    get items(){return items;}};
}
