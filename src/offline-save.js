import {logCenterY,applyLogRotation,validBuildLog} from './log-grid.js';
import {isDecorResourceId} from './collectible-decor.js';
import {baseTerrainHeight} from './terrain-noise.js';
import {pondHeightBeforeLakes} from './ponds.js';
import {validBench,MAX_BENCHES} from './crafting.js';
import {validItem,createInventoryModel} from './inventory.js';
import {segmentMask} from './fallen-log-layout.js';
import {BOX_LIFETIME_SECONDS,MAX_GROUND_DROPS} from './ground-boxes.js';
import {validStorage} from './storage-model.js';
import {validCampStructure,MAX_CAMP_STRUCTURES} from './camp-rules.js';
import {RESOURCE_RESPAWN_SECONDS} from './resource-zones.js';
import {MAX_VITALS,HUNGER_INTERVAL_SECONDS,STARVATION_DAMAGE_INTERVAL} from './vitals.js';
import {validDeathMarker} from './death.js';
// Offline-only world snapshots. Server saves are independent and authoritative.
// This module intentionally never reads/writes the multiplayer world JSON.
export const slotKey = slot => {
  if (!Number.isInteger(slot) || slot < 1 || slot > 10) throw new RangeError('Invalid save slot');
  return `forest-chopper:slot:v1:${slot}`;
};
// Permit 10k dropped items plus other world state; storage quota still applies.
const MAX_BYTES = 4_000_000;
const MAX_LOGS = 10_000;
const MAX_TREES = 20_000;
const validId = id => typeof id === 'string' && /^-?\d+,-?\d+:[0-7]$/.test(id) && id.length <= 35;
const coordinate = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 240000;
const nonnegative = n => Number.isSafeInteger(n) && n >= 0 && n <= 10_000_000;

export function parseOfflineSave(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_BYTES) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Number.isInteger(data.seed)
        || data.seed < 0 || data.seed > 999998
        || !nonnegative(data.wood) || !nonnegative(data.cuts)
        || !nonnegative(data.logsCollected ?? 0)
        || (data.createdAt !== undefined && (!Number.isSafeInteger(data.createdAt) || data.createdAt <= 0))
        || (data.savedAt !== undefined && (!Number.isSafeInteger(data.savedAt) || data.savedAt <= 0))
        || !Array.isArray(data.felled) || data.felled.length > MAX_TREES
        || !data.damage || typeof data.damage !== 'object' || Array.isArray(data.damage)
        || !Array.isArray(data.logs) || data.logs.length > MAX_LOGS
        || !Array.isArray(data.furniture ?? []) || (data.furniture ?? []).length > MAX_BENCHES
        || !Array.isArray(data.storages??[]) || data.storages?.length>120
        || !Array.isArray(data.camp_structures??[]) || data.camp_structures?.length>MAX_CAMP_STRUCTURES
        || (data.dayPhase!==undefined&&
           (typeof data.dayPhase!=='number'||!Number.isFinite(data.dayPhase)||
            data.dayPhase<0||data.dayPhase>=1))
        || !data.position || !coordinate(data.position.x) || !coordinate(data.position.z)
        || !Number.isFinite(data.position.y ?? 0) || Math.abs(data.position.y ?? 0) > 240012
        || !Number.isFinite(data.position.yaw) || Math.abs(data.position.yaw) > 1e6
        || !Number.isFinite(data.position.pitch) || Math.abs(data.position.pitch) > 1.43)
      return null;
    if (data.felled.some(id => !validId(id))) return null;
    const damage = Object.entries(data.damage);
    if (damage.length > MAX_TREES || damage.some(([id,hp]) =>
      !validId(id) || !Number.isInteger(hp) || hp < 1 || hp > 12)) return null;
    // Invalidate obsolete 3.6 m building logs without resetting the rest
    // of the player's world, collected resources or inventory.
    const logs=[];
    for(const log of data.logs){
      if(log?.height===undefined)continue;
      if(!validBuildLog(log))return null;
      logs.push({x:log.x,z:log.z,height:log.height,orientation:log.orientation});
    }
    const boxes=[];
    let migrateLegacyFallenLogs=false;
    if(!Array.isArray(data.boxes??[])||data.boxes?.length>MAX_GROUND_DROPS)return null;
    for(const box of data.boxes??[]){
      if(!box||!Number.isSafeInteger(box.id)||box.id<0||box.id>2147483647
        ||!coordinate(box.x)||!coordinate(box.z)
        ||!Number.isFinite(box.expires_at)||box.expires_at<0
        ||!validItem(box.item))return null;
      if(box.kind==='fallen_logs'){
        const mask=segmentMask(box);
        if(box.item.id!=='log'||
          !Number.isFinite(box.direction??0)||Math.abs(box.direction??0)>100||
          !Number.isInteger(mask)||mask<1||mask>31||
          mask.toString(2).replaceAll('0','').length!==box.item.count||
          (box.tree!==undefined&&box.tree!==null&&typeof box.tree!=='string'))return null;
        const expiresAt=box.expires_at===0
          ?Date.now()/1000+BOX_LIFETIME_SECONDS:box.expires_at;
        if(box.expires_at===0)migrateLegacyFallenLogs=true;
        if(expiresAt>Date.now()/1000)boxes.push({
          id:box.id,x:box.x,z:box.z,kind:'fallen_logs',
          direction:box.direction??0,mask,tree:box.tree??null,
          expires_at:expiresAt,item:box.item,
        });
      }else{
        if(box.kind!==undefined)return null;
        if(box.expires_at>Date.now()/1000)boxes.push({id:box.id,x:box.x,z:box.z,expires_at:box.expires_at,item:box.item});
      }
    }
    const cooldowns={};
    const rawCooldowns=data.resource_cooldowns??{};
    if(!rawCooldowns||typeof rawCooldowns!=='object'||Array.isArray(rawCooldowns)
      ||Object.keys(rawCooldowns).length>100000)return null;
    for(const [id,expires] of Object.entries(rawCooldowns)){
      if(!(/^-?\d+,-?\d+:[01]$/.test(id)||isDecorResourceId(id))||!Number.isFinite(expires)
        ||expires>Date.now()/1000+RESOURCE_RESPAWN_SECONDS)return null;
      if(expires>Date.now()/1000)cooldowns[id]=expires;
    }
    if(data.inventory != null && !createInventoryModel().restore(data.inventory,data.wood))return null;
    const vitals=data.vitals??null;
    if(vitals!==null&&(!Number.isInteger(vitals.health)||vitals.health<0||vitals.health>MAX_VITALS
        ||!Number.isInteger(vitals.hunger)||vitals.hunger<0||vitals.hunger>MAX_VITALS
        ||(vitals.stamina!==undefined&&(!Number.isFinite(vitals.stamina)||vitals.stamina<0||vitals.stamina>MAX_VITALS))
        ||(vitals.staminaLocked!==undefined&&typeof vitals.staminaLocked!=='boolean')
        ||!Number.isFinite(vitals.hungerProgress)||vitals.hungerProgress<0
        ||vitals.hungerProgress>=HUNGER_INTERVAL_SECONDS
        ||(vitals.starvationProgress!==undefined&&(!Number.isFinite(vitals.starvationProgress)||vitals.starvationProgress<0||vitals.starvationProgress>=STARVATION_DAMAGE_INTERVAL))))return null;
    const death=data.death??null;
    if(death!==null&&(typeof death!=='object'||Array.isArray(death)
      ||(death.pending!==undefined&&typeof death.pending!=='boolean')
      ||(death.bedId!==null&&death.bedId!==undefined&&!Number.isSafeInteger(death.bedId))
      ||(death.marker!==null&&death.marker!==undefined&&(
        !Number.isFinite(death.marker.x)||!Number.isFinite(death.marker.z)
        ||Math.abs(death.marker.x)>240000||Math.abs(death.marker.z)>240000
        ||!Number.isFinite(death.marker.expires_at)
        ||death.marker.expires_at>Date.now()/1000+BOX_LIFETIME_SECONDS+2))))return null;
    const furniture=[];
    for(const item of data.furniture ?? []){if(!validBench(item))return null;furniture.push({kind:'bench',x:item.x,z:item.z,orientation:item.orientation});}
    const storages=data.storages??[];
    if(storages.some(item=>!validStorage(item)))return null;
    const campStructures=data.camp_structures??[];
    if(campStructures.some(item=>!validCampStructure(item)))return null;
    return {
      camp_structures:campStructures,storages,terrainVersion:[1,2,3].includes(data.terrainVersion)?data.terrainVersion:0,
      dayPhase:data.dayPhase??0,
      logsCollected:data.logsCollected??0, furniture,boxes,migrateLegacyFallenLogs,resource_cooldowns:cooldowns,vitals,death,inventory:data.inventory??null,seed: data.seed, wood: data.wood, cuts: data.cuts,
      felled: data.felled, damage, logs, position: {...data.position, y: data.position.y ?? 0},
    };
  } catch {
    return null;
  }
}

export function createOfflineSave(ctx, {
  storage = null,
  slot = 1,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = id => clearTimeout(id),
  now = () => performance.now(),
} = {}) {
  if (!storage) {
    try {storage = window.localStorage;} catch { /* Storage blocked. */ }
  }
  let suspended = false, timer = null, lastWrite = now();
  let createdAt = Date.now();
  try { createdAt = JSON.parse(storage?.getItem(slotKey(slot)) || 'null')?.createdAt || createdAt; } catch {}

  function snapshot() {
    return {
      version: 1, createdAt, savedAt: Date.now(), terrainVersion: 3, seed: ctx.seed, wood: ctx.wood, cuts: ctx.cuts, logsCollected:ctx.logsCollected??0,
      dayPhase:ctx.dayCycle?.offlinePhase??0,
      position: {x: ctx.px, y: ctx.feetY, z: ctx.pz, yaw: ctx.yaw, pitch: ctx.pitch},
      felled: [...ctx.felled], damage: Object.fromEntries(ctx.treeDamage),
      logs: ctx.placed.map(({x,z,height,orientation}) => ({x,z,height,orientation})),
      furniture: ctx.crafting?.snapshot() ?? [],
      storages:ctx.storages?.snapshot?.()??[],
      inventory:ctx.inventory?.serialize?.()??undefined,
      vitals:ctx.vitals?.serialize?.()??undefined,
      death:ctx.deathSystem?.snapshot?.()??null,
      boxes:ctx.groundBoxes?.snapshot?.()??[],
      camp_structures:ctx.campStructures?.snapshot?.()??[],
      resource_cooldowns:ctx.forestResources?.snapshotCooldowns?.()??{},
    };
  }
  function save() {
    if (suspended || !storage) return false;
    const state = snapshot();
    const payload = JSON.stringify(state);
    if (payload.length > MAX_BYTES || state.logs.length > MAX_LOGS ||
        state.felled.length > MAX_TREES || state.boxes.length > MAX_GROUND_DROPS || state.furniture.length > MAX_BENCHES || Object.keys(state.damage).length > MAX_TREES) {
      console.warn('Forest Chopper: offline save exceeds the supported size.');
      lastWrite = now();
      return false;
    }
    try {
      storage.setItem(slotKey(slot), payload);
      lastWrite = now();
      return true;
    } catch {
      console.warn('Forest Chopper: offline save could not be written.');
      lastWrite = now();
      return false;
    }
  }
  function restoreSnapshot(raw,{replace=false}={}) {
    const state = parseOfflineSave(raw);
    if (!state || (replace && ctx.isOnline?.())) return false;
    if(replace)ctx.clearWorld?.();
    if(ctx.vitals&&!ctx.vitals.restore(state.vitals))return false;
    if(ctx.inventory&&!ctx.inventory.restore(state.inventory,state.wood))return false;
    if(ctx.forestResources&&!ctx.forestResources.restoreCooldowns(state.resource_cooldowns))return false;
    ctx.seed = state.seed;
    ctx.dayCycle?.setOfflinePhase?.(state.dayPhase);
    ctx.wood = state.wood;ctx.cuts = state.cuts;ctx.logsCollected = state.logsCollected;
    ctx.px = state.position.x;ctx.pz = state.position.z;
    ctx.yaw = state.position.yaw;ctx.pitch = state.position.pitch;
    const floor=ctx.terrain.heightAt(ctx.px,ctx.pz);
    // Old flat-world saves stored Y relative to ground at zero.
    const oldFloor=state.terrainVersion===3?floor:
      state.terrainVersion===2?pondHeightBeforeLakes(ctx.seed,ctx.px,ctx.pz):
      state.terrainVersion===1?baseTerrainHeight(ctx.seed,ctx.px,ctx.pz):0;
    const restoredY=state.position.y+floor-oldFloor;
    ctx.feetY=Math.max(restoredY,floor);ctx.verticalSpeed=0;
    ctx.onGround=Math.abs(ctx.feetY-floor)<.08;
    ctx.felled.clear();for (const id of state.felled)ctx.felled.add(id);
    ctx.treeDamage.clear();for (const [id,hp] of state.damage)ctx.treeDamage.set(id,hp);
    for (const log of state.logs) {
      const mesh = ctx.makeLog();
      const y = logCenterY(log,ctx.terrain.heightAt(log.x,log.z),ctx.logRadius);
      mesh.position.set(log.x,y,log.z);
      applyLogRotation(mesh,log.orientation);
      ctx.scene.add(mesh);
      ctx.placed.push({...log, y, mesh});
      ctx.collisionWorld?.invalidate?.();
    }
    for(const furniture of state.furniture){ctx.crafting?.add({...furniture,id:-(ctx.crafting.items.size+1)});}
    ctx.storages?.set?.(state.storages);
    ctx.campStructures?.set?.(state.camp_structures);
    ctx.groundBoxes?.set?.(state.boxes);
    ctx.deathSystem?.restore?.(state.death);
    ctx.$('wood').textContent = ctx.wood;
    ctx.$('cut').textContent = ctx.cuts;
    // Commit legacy TTL immediately; otherwise repeatedly reloading the page
    // could restart the one-hour countdown from zero.
    if(state.migrateLegacyFallenLogs&&!suspended)save();
    if(replace){
      ctx.ownAvatar?.group?.position?.set(ctx.px,ctx.feetY,ctx.pz);
      ctx.updateChunks?.();
      ctx.offlineSave?.markDirty?.();
    }
    return true;
  }
  function restore() {
    if (!storage || suspended) return false;
    let raw;
    try {raw = storage.getItem(slotKey(slot));} catch {return false;}
    return restoreSnapshot(raw);
  }
  function markDirty() {
    if (suspended || !storage || timer !== null) return;
    timer = setTimer(() => {timer = null;save();}, 900);
  }
  function tick(time) {
    if (!suspended && storage && time - lastWrite > 15000) markDirty();
  }
  function suspend({flush=true}={}) {
    if (suspended) return;
    if (timer !== null) {clearTimer(timer);timer = null;}
    // Entering multiplayer straight from the menu must not overwrite the
    // previous offline save with a freshly initialized empty world.
    if(flush)save();
    suspended = true;
  }
  function reset({preserve=false}={}) {
    if (timer !== null) {clearTimer(timer);timer = null;}
    suspended = false;
    createdAt = Date.now();
    lastWrite = now();
    if(!preserve)try {storage?.removeItem(slotKey(slot));} catch { /* In-memory play still works. */ }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      if (timer !== null) {clearTimer(timer);timer = null;}
      save();
    });
  }
  return {save, restore, restoreSnapshot, snapshot, markDirty, tick, suspend, reset,
    get suspended() {return suspended;}};
}
