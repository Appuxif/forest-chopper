import {isDecorResourceId} from './collectible-decor.js';
import {baseTerrainHeight} from './terrain-noise.js';
import {pondHeightBeforeLakes} from './ponds.js';
import {validBench,MAX_BENCHES} from './crafting.js';
import {validItem} from './inventory.js';
import {RESOURCE_RESPAWN_SECONDS} from './resource-zones.js';
import {MAX_VITALS,HUNGER_INTERVAL_SECONDS} from './vitals.js';
// Offline-only world snapshots. Server saves are independent and authoritative.
// This module intentionally never reads/writes the multiplayer world JSON.
export const OFFLINE_SAVE_KEY = 'forest-chopper:offline-world:v1';
const MAX_BYTES = 1_500_000;
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
        || !Array.isArray(data.felled) || data.felled.length > MAX_TREES
        || !data.damage || typeof data.damage !== 'object' || Array.isArray(data.damage)
        || !Array.isArray(data.logs) || data.logs.length > MAX_LOGS
        || !Array.isArray(data.furniture ?? []) || (data.furniture ?? []).length > MAX_BENCHES
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
    const logs = [];
    for (const log of data.logs) {
      if (!log || !coordinate(log.x) || !coordinate(log.z)
          || Math.abs(log.x * 2 - Math.round(log.x * 2)) > 1e-4
          || Math.abs(log.z * 2 - Math.round(log.z * 2)) > 1e-4
          || !Number.isInteger(log.level) || log.level < 0 || log.level >= 16
          || (log.orientation !== 0 && log.orientation !== 1)) return null;
      logs.push({x: log.x, z: log.z, level: log.level, orientation: log.orientation});
    }
    const boxes=[];
    if(!Array.isArray(data.boxes??[])||data.boxes?.length>500)return null;
    for(const box of data.boxes??[]){
      if(!box||!Number.isSafeInteger(box.id)||box.id<0||box.id>2147483647
        ||!coordinate(box.x)||!coordinate(box.z)
        ||!Number.isFinite(box.expires_at)||box.expires_at<0
        ||!validItem(box.item))return null;
      if(box.expires_at>Date.now()/1000)boxes.push({id:box.id,x:box.x,z:box.z,expires_at:box.expires_at,item:box.item});
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
    const vitals=data.vitals??null;
    if(vitals!==null&&(!Number.isInteger(vitals.health)||vitals.health<0||vitals.health>MAX_VITALS
        ||!Number.isInteger(vitals.hunger)||vitals.hunger<0||vitals.hunger>MAX_VITALS
        ||(vitals.stamina!==undefined&&(!Number.isFinite(vitals.stamina)||vitals.stamina<0||vitals.stamina>MAX_VITALS))
        ||(vitals.staminaLocked!==undefined&&typeof vitals.staminaLocked!=='boolean')
        ||!Number.isFinite(vitals.hungerProgress)||vitals.hungerProgress<0
        ||vitals.hungerProgress>=HUNGER_INTERVAL_SECONDS))return null;
    const furniture=[];
    for(const item of data.furniture ?? []){if(!validBench(item))return null;furniture.push({kind:'bench',x:item.x,z:item.z,orientation:item.orientation});}
    return {
      terrainVersion:[1,2,3].includes(data.terrainVersion)?data.terrainVersion:0,
      dayPhase:data.dayPhase??0,
      furniture,boxes,resource_cooldowns:cooldowns,vitals,inventory:data.inventory??null,seed: data.seed, wood: data.wood, cuts: data.cuts,
      felled: data.felled, damage, logs, position: {...data.position, y: data.position.y ?? 0},
    };
  } catch {
    return null;
  }
}

export function createOfflineSave(ctx, {
  storage = null,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = id => clearTimeout(id),
  now = () => performance.now(),
} = {}) {
  if (!storage) {
    try {storage = window.localStorage;} catch { /* Storage blocked. */ }
  }
  let suspended = false, timer = null, lastWrite = now();

  function snapshot() {
    return {
      version: 1, terrainVersion: 3, seed: ctx.seed, wood: ctx.wood, cuts: ctx.cuts,
      dayPhase:ctx.dayCycle?.offlinePhase??0,
      position: {x: ctx.px, y: ctx.feetY, z: ctx.pz, yaw: ctx.yaw, pitch: ctx.pitch},
      felled: [...ctx.felled], damage: Object.fromEntries(ctx.treeDamage),
      logs: ctx.placed.map(({x,z,level,orientation}) => ({x,z,level,orientation})),
      furniture: ctx.crafting?.snapshot() ?? [],
      inventory:ctx.inventory?.serialize?.()??undefined,
      vitals:ctx.vitals?.serialize?.()??undefined,
      boxes:ctx.groundBoxes?.snapshot?.()??[],
      resource_cooldowns:ctx.forestResources?.snapshotCooldowns?.()??{},
    };
  }
  function save() {
    if (suspended || !storage) return false;
    const state = snapshot();
    const payload = JSON.stringify(state);
    if (payload.length > MAX_BYTES || state.logs.length > MAX_LOGS ||
        state.felled.length > MAX_TREES || state.furniture.length > MAX_BENCHES || Object.keys(state.damage).length > MAX_TREES) {
      console.warn('Forest Chopper: offline save exceeds the supported size.');
      lastWrite = now();
      return false;
    }
    try {
      storage.setItem(OFFLINE_SAVE_KEY, payload);
      lastWrite = now();
      return true;
    } catch {
      console.warn('Forest Chopper: offline save could not be written.');
      lastWrite = now();
      return false;
    }
  }
  function restore() {
    if (!storage || suspended) return false;
    let raw;
    try {raw = storage.getItem(OFFLINE_SAVE_KEY);} catch {return false;}
    const state = parseOfflineSave(raw);
    if (!state) return false;
    if(ctx.vitals&&!ctx.vitals.restore(state.vitals))return false;
    if(ctx.inventory&&!ctx.inventory.restore(state.inventory,state.wood))return false;
    if(ctx.forestResources&&!ctx.forestResources.restoreCooldowns(state.resource_cooldowns))return false;
    ctx.seed = state.seed;
    ctx.dayCycle?.setOfflinePhase?.(state.dayPhase);
    ctx.wood = state.wood;ctx.cuts = state.cuts;
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
      const y = ctx.terrain.heightAt(log.x,log.z)+ctx.logRadius + log.level * ctx.logRadius * 1.8;
      mesh.position.set(log.x, y, log.z);
      if (log.orientation === 1) mesh.rotation.y = Math.PI / 2;
      ctx.scene.add(mesh);
      ctx.placed.push({...log, y, mesh});
    }
    for(const furniture of state.furniture){ctx.crafting?.add({...furniture,id:-(ctx.crafting.items.size+1)});}
    ctx.groundBoxes?.set?.(state.boxes);
    ctx.$('wood').textContent = ctx.wood;
    ctx.$('cut').textContent = ctx.cuts;
    return true;
  }
  function markDirty() {
    if (suspended || !storage || timer !== null) return;
    timer = setTimer(() => {timer = null;save();}, 900);
  }
  function tick(time) {
    if (!suspended && storage && time - lastWrite > 15000) markDirty();
  }
  function suspend() {
    if (suspended) return;
    if (timer !== null) {clearTimer(timer);timer = null;}
    save(); // Flush the offline world *before* server welcome replaces it.
    suspended = true;
  }
  function reset() {
    if (timer !== null) {clearTimer(timer);timer = null;}
    suspended = false;
    lastWrite = now();
    try {storage?.removeItem(OFFLINE_SAVE_KEY);} catch { /* In-memory play still works. */ }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      if (timer !== null) {clearTimer(timer);timer = null;}
      save();
    });
  }
  return {save, restore, markDirty, tick, suspend, reset,
    get suspended() {return suspended;}};
}
