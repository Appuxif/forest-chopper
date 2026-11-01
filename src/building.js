import {isStructureItem} from './structure-items.js';
import {snapLog,logCenterY,applyLogRotation,BUILD_HEIGHT_STEPS,logHalfExtents} from './log-grid.js';
// Building is predicted locally for both offline and online play.
// The multiplayer server remains authoritative for placement and wood cost.
export function createBuilding(ctx) {
  function makeLog() {
    const mesh = new ctx.THREE.Mesh(ctx.logGeo, [ctx.logMat, ctx.endMat, ctx.endMat]);
    mesh.rotation.z = Math.PI / 2;
    mesh.castShadow=true;
    return mesh;
  }

  function overlaps(a,b) {
    const aa=logHalfExtents(a),bb=logHalfExtents(b);
    return Math.abs(a.x-b.x)<aa.x+bb.x &&
      Math.abs(a.z-b.z)<aa.z+bb.z;
  }

  function candidate() {
    const distance = 3.7, dirX = -Math.sin(ctx.yaw), dirZ = -Math.cos(ctx.yaw);
    const offset=ctx.buildOffset??{x:0,z:0,height:0};
    const x=snapLog(ctx.px+dirX*distance+offset.x);
    const z=snapLog(ctx.pz+dirZ*distance+offset.z);
    const height=offset.height;
    const orientation=ctx.orientation%3;
    return {x,z,orientation,height,
      y:logCenterY({orientation,height},ctx.terrain.heightAt(x,z),ctx.logRadius)};
  }

  function nudge(axis,direction){
    if(!ctx.buildMode||ctx.inventory?.selected!=='log')return false;
    const offset=ctx.buildOffset??(ctx.buildOffset={x:0,z:0,height:0});
    if(axis==='height')offset.height=Math.max(0,Math.min(BUILD_HEIGHT_STEPS-1,offset.height+direction));
    else if(axis==='x'||axis==='z')offset[axis]=Math.max(-5,Math.min(5,offset[axis]+direction*.5));
    else return false;
    updatePreview();
    return true;
  }
  function rotate(){
    ctx.orientation=(ctx.orientation+1)%(ctx.inventory?.selected==='log'?3:4);
    updatePreview();
  }

  function placeError(p) {
    if(ctx.inventory && ctx.inventory.selected!=='log')return 'Выбери брёвна в быстром слоте';
    if (!ctx.buildMode) return 'Сначала включите строительство';
    if (!p) return 'Место установки не выбрано';
    if (ctx.wood < 1) return 'Недостаточно древесины';
    if(ctx.terrain.waterDepthAt(p.x,p.z)>.2)return 'Нельзя строить в воде';
    if (!Number.isInteger(p.height)||p.height<0||p.height>=BUILD_HEIGHT_STEPS)
      return 'Высота вне строительной сетки';
    if(Math.hypot(p.x-ctx.px,p.z-ctx.pz)>6)return 'Слишком далеко для строительства';
    if(ctx.placed.some(old=>
      old.x===p.x&&old.z===p.z&&old.height===p.height&&old.orientation===p.orientation))
      return 'Здесь уже установлено бревно';
    return '';
  }

  function hint(message) { ctx.$('buildhint').textContent = message; }

  function updatePreview() {
    if (!ctx.buildMode){disposePreview();return;}
    if(ctx.inventory?.selected==='bench'){
      ctx.placement=ctx.crafting?.candidate?.();
      if(ctx.preview?.userData?.itemPreview!=='bench'){
        disposePreview();ctx.preview=ctx.crafting?.createPreview?.();
        if(ctx.preview)ctx.scene.add(ctx.preview);
      }
      if(ctx.preview&&ctx.placement){
        ctx.preview.position.set(ctx.placement.x,ctx.terrain.heightAt(ctx.placement.x,ctx.placement.z),ctx.placement.z);
        ctx.preview.rotation.y=ctx.orientation*Math.PI/2;
      }
      const error=ctx.crafting?.placeError?.(ctx.placement)??'';
      ctx.crafting?.colorPreview?.(ctx.preview,!!error);
      hint(error||'🪑 Клик — поставить скамейку');
      return;
    }
    const kind=ctx.inventory?.selected;
    if(isStructureItem(kind)){
      const x=snapLog(ctx.px-Math.sin(ctx.yaw)*3);
      const z=snapLog(ctx.pz-Math.cos(ctx.yaw)*3);
      const y=ctx.terrain.heightAt(x,z);
      ctx.placement={x,z,orientation:ctx.orientation%4};
      if(ctx.preview?.userData?.itemPreview!==kind){
        disposePreview();
        const model=(kind==='chest'||kind==='rack'
          ?ctx.storages?.createIconModel?.(kind)
          :ctx.campStructures?.createIconModel?.(kind));
        if(model){
          const materials=[];
          model.traverse(node=>{
            if(node.isLight)node.visible=false;
            if(!node.isMesh)return;
            node.material=(Array.isArray(node.material)?node.material:[node.material])
              .map(m=>{
                const mat=m.clone();
                mat.transparent=true;mat.opacity=.48;mat.depthWrite=false;
                if(mat.color)mat.color.setHex(0x83efb5);
                materials.push(mat);
                return mat;
              });
            if(node.material.length===1)node.material=node.material[0];
          });
          model.userData.itemPreview=kind;
          model.userData.previewMaterials=materials;
          ctx.preview=model;
          ctx.scene.add(model);
        }
      }
      if(ctx.preview){
        ctx.preview.position.set(x,y,z);
        ctx.preview.rotation.y=ctx.placement.orientation*Math.PI/2;
      }
      const water=ctx.terrain.waterDepthAt(x,z)>.12;
      const crowded=[...ctx.campStructures?.items?.values()??[],
        ...ctx.storages?.structures?.values()??[]]
        .some(item=>Math.hypot(item.x-x,item.z-z)<2.4);
      const error=water?'Нельзя ставить в воде':crowded?'Место занято':'';
      if(ctx.preview){
        ctx.preview.userData.previewError=error;
        for(const material of ctx.preview.userData.previewMaterials??[])
          material.color?.setHex(error?0xff6666:0x83efb5);
      }
      hint(error||'Клик / E — поставить готовую постройку');
      return;
    }
    if(ctx.preview?.userData?.itemPreview==='bench')disposePreview();
    ctx.placement = candidate();
    if (!ctx.preview) {
      ctx.preview = makeLog();
      ctx.preview.userData={itemPreview:'log'};
      // Individual translucent material, the log geometry is shared.
      ctx.preview.material = new ctx.THREE.MeshLambertMaterial({
        color: 0x83efb5, transparent: true, opacity: .48, depthWrite: false,
      });
      ctx.scene.add(ctx.preview);
    }
    ctx.preview.position.set(ctx.placement.x, ctx.placement.y, ctx.placement.z);
    applyLogRotation(ctx.preview,ctx.placement.orientation);
    const error = placeError(ctx.placement);
    ctx.preview.material.color.setHex(error ? 0xff6666 : 0x83efb5);
    hint(error || 'Ось '+['X','Z','Y'][ctx.placement.orientation]+' · Высота +'+
      (ctx.placement.height*.5).toFixed(1)+' м · PgUp/PgDn ↕ · Alt+стрелки ↔ · R повернуть');
  }

  function placeLog() {
    // Recompute on the actual click; preview is refreshed only every few frames.
    const p = ctx.buildMode ? candidate() : null;
    const error = placeError(p);
    if (error) { hint(error); ctx.notify(error, 'warning'); return false; }
    ctx.placement = p;
    if (ctx.isOnline()) {
      ctx.sendNet({type: ctx.inventory?'place_item':'place', x: p.x, z: p.z, orientation: p.orientation, height: p.height});
      return true; // Sent, not confirmed; server applies the final placement.
    }
    if(ctx.inventory&&!ctx.inventory.state.spendLogs(1)){
      hint('Не удалось списать бревно');return false;
    }
    const mesh = makeLog();
    mesh.position.set(p.x, p.y, p.z);
    applyLogRotation(mesh,p.orientation);
    ctx.scene.add(mesh);
    ctx.placed.push({...p, mesh});
    ctx.atmosphere?.invalidateStaticShadows?.();
    ctx.wood=ctx.inventory?ctx.inventory.state.wood():ctx.wood-1;
    ctx.inventory?.render();
    ctx.tutorial.complete('log-placed');
    ctx.progress.record('log-placed');
    ctx.offlineSave.markDirty();
    ctx.$('wood').textContent = ctx.wood;
    ctx.notify('Бревно установлено · −1 🪵', 'success', 'log-placed');
    updatePreview();
    return true;
  }

  function removeLog() {
    if(ctx.inventory&&!ctx.inventory.equipped)return false;
    if (!ctx.buildMode && !ctx.inventory) { hint('Сначала включите строительство'); ctx.notify('Сначала включите строительство', 'warning'); return false; }
    const p = candidate();
    let idx = -1;
    let closest=Infinity;
    for(let i=0;i<ctx.placed.length;i++){
      const a=ctx.placed[i];
      const distance=Math.hypot(a.x-p.x,a.z-p.z,(a.y??0)-p.y);
      if(distance<2.0&&distance<closest){idx=i;closest=distance;}
    }
    if (idx < 0) { hint('Нет брёвен поблизости'); ctx.notify('Нет брёвен поблизости', 'warning'); return false; }
    const log = ctx.placed[idx];
    if(ctx.inventory && ctx.inventory.state.freeLogs()<1){ctx.notify('Сумка заполнена','warning');return false;}
    if (ctx.isOnline()) {
      if (log.id === undefined || log.id === null) return false;
      ctx.sendNet(ctx.inventory?{type:'hit_structure',kind:'log',id:log.id}:{type:'remove',id:log.id});
      return true; // Await log_remove, do not change resources optimistically.
    }
    if(ctx.inventory&&!ctx.inventory.state.addItem({id:'log',count:1})){
      ctx.notify?.('Сумка заполнена или превышен вес','warning');return false;
    }
    ctx.scene.remove(log.mesh);
    ctx.placed.splice(idx, 1);
    ctx.atmosphere?.invalidateStaticShadows?.();
    ctx.wood=ctx.inventory?ctx.inventory.state.wood():ctx.wood+1;
    ctx.inventory?.render();
    ctx.offlineSave.markDirty();
    ctx.$('wood').textContent = ctx.wood;
    ctx.notify('Бревно убрано · +1 🪵', 'success', 'log-removed');
    updatePreview();
    return true;
  }

  function disposePreview() {
    if (!ctx.preview) return;
    ctx.scene.remove(ctx.preview);
    if(ctx.preview.userData?.previewMaterials){
      for(const material of ctx.preview.userData.previewMaterials)material.dispose();
      const label=ctx.preview.userData.label;
      if(label){label.material?.map?.dispose();label.material?.dispose();label.geometry?.dispose();}
    }else if(!ctx.preview.userData?.itemPreview||ctx.preview.userData.itemPreview==='log')
      ctx.preview.material.dispose();
    ctx.preview = null;
  }

  function setMode(on) {
    ctx.buildMode = on;
    ctx.crafting?.setMode(on);
    ctx.$('mode').textContent = on ? '🪓 Рубить' : '🏗️ Строить';
    if(ctx.inventory)ctx.$('mode').style.display='none';
    ctx.$('mode').classList.toggle('active', on);
    for (const id of ['rotate', 'place', 'undo']) ctx.$(id).style.display = on ? 'block' : 'none';
    ctx.$('hit').style.display = on ? 'none' : 'block';
    hint('');
    if (!on) disposePreview();
  }

  ctx.$('mode').onclick = () => setMode(!ctx.buildMode);
  ctx.$('rotate').onclick = rotate;
  ctx.$('place').onclick = placeLog;
  ctx.$('undo').onclick = removeLog;

  return {makeLog, overlaps, candidate, placeError, updatePreview,
    placeLog, removeLog, setMode, disposePreview,nudge,rotate};
}
