// Building is predicted locally for both offline and online play.
// The multiplayer server remains authoritative for placement and wood cost.
export function createBuilding(ctx) {
  function makeLog() {
    const mesh = new ctx.THREE.Mesh(ctx.logGeo, [ctx.logMat, ctx.endMat, ctx.endMat]);
    mesh.rotation.z = Math.PI / 2;
    mesh.castShadow=true;
    return mesh;
  }

  function overlaps(a, b) {
    return Math.abs(a.x - b.x) < (a.orientation === 0 && b.orientation === 0 ? 3.2 : 1.65)
      && Math.abs(a.z - b.z) < (a.orientation === 1 && b.orientation === 1 ? 3.2 : 1.65);
  }

  function candidate() {
    const distance = 3.7, dirX = -Math.sin(ctx.yaw), dirZ = -Math.cos(ctx.yaw);
    const x = Math.round((ctx.px + dirX * distance) * 2) / 2;
    const z = Math.round((ctx.pz + dirZ * distance) * 2) / 2;
    let level = 0;
    for (const p of ctx.placed) {
      if (overlaps({x, z, orientation: ctx.orientation % 2}, p)) level = Math.max(level, p.level + 1);
    }
    return {x, z, orientation: ctx.orientation % 2, level, y: ctx.logRadius + level * ctx.logRadius * 1.8};
  }

  function placeError(p) {
    if(ctx.inventory && ctx.inventory.selected!=='log')return 'Выбери брёвна в быстром слоте';
    if (!ctx.buildMode) return 'Сначала включите строительство';
    if (!p) return 'Место установки не выбрано';
    if (ctx.wood < 1) return 'Недостаточно древесины';
    if (p.level >= 16) return 'Слишком высокая стена (не более 16 уровней)';
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
        ctx.preview.position.set(ctx.placement.x,0,ctx.placement.z);
        ctx.preview.rotation.y=ctx.orientation*Math.PI/2;
      }
      const error=ctx.crafting?.placeError?.(ctx.placement)??'';
      ctx.crafting?.colorPreview?.(ctx.preview,!!error);
      hint(error||'🪑 Клик — поставить скамейку');
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
    ctx.preview.rotation.set(0, 0, Math.PI / 2);
    if (ctx.orientation % 2 === 1) ctx.preview.rotation.y = Math.PI / 2;
    const error = placeError(ctx.placement);
    ctx.preview.material.color.setHex(error ? 0xff6666 : 0x83efb5);
    hint(error || `Высота: ${ctx.placement.level + 1} · Цена: 1 🪵`);
  }

  function placeLog() {
    // Recompute on the actual click; preview is refreshed only every few frames.
    const p = ctx.buildMode ? candidate() : null;
    const error = placeError(p);
    if (error) { hint(error); ctx.notify(error, 'warning'); return false; }
    ctx.placement = p;
    if (ctx.isOnline()) {
      ctx.sendNet({type: ctx.inventory?'place_item':'place', x: p.x, z: p.z, orientation: p.orientation});
      return true; // Sent, not confirmed; server applies the final placement.
    }
    const mesh = makeLog();
    mesh.position.set(p.x, p.y, p.z);
    if (p.orientation === 1) mesh.rotation.y = Math.PI / 2;
    ctx.scene.add(mesh);
    ctx.placed.push({...p, mesh});
    ctx.atmosphere?.invalidateStaticShadows?.();
    ctx.wood--;
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
    for (let i = ctx.placed.length - 1; i >= 0; i--) {
      const a = ctx.placed[i];
      if (Math.hypot(a.x - p.x, a.z - p.z) < 2.4) { idx = i; break; }
    }
    if (idx < 0) { hint('Нет брёвен поблизости'); ctx.notify('Нет брёвен поблизости', 'warning'); return false; }
    const log = ctx.placed[idx];
    if(ctx.inventory && ctx.inventory.state.freeLogs()<1){ctx.notify('Сумка заполнена','warning');return false;}
    if (ctx.isOnline()) {
      if (log.id === undefined || log.id === null) return false;
      ctx.sendNet(ctx.inventory?{type:'hit_structure',kind:'log',id:log.id}:{type:'remove',id:log.id});
      return true; // Await log_remove, do not change resources optimistically.
    }
    ctx.scene.remove(log.mesh);
    ctx.placed.splice(idx, 1);
    ctx.atmosphere?.invalidateStaticShadows?.();
    ctx.wood++;
    ctx.offlineSave.markDirty();
    ctx.$('wood').textContent = ctx.wood;
    ctx.notify('Бревно убрано · +1 🪵', 'success', 'log-removed');
    updatePreview();
    return true;
  }

  function disposePreview() {
    if (!ctx.preview) return;
    ctx.scene.remove(ctx.preview);
    if(!ctx.preview.userData?.itemPreview || ctx.preview.userData.itemPreview==='log')ctx.preview.material.dispose();
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
  ctx.$('rotate').onclick = () => ctx.orientation = (ctx.orientation + 1) % 4;
  ctx.$('place').onclick = placeLog;
  ctx.$('undo').onclick = removeLog;

  return {makeLog, overlaps, candidate, placeError, updatePreview,
    placeLog, removeLog, setMode, disposePreview};
}
