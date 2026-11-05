import {buildMobFlocks} from './mob-flocking.js';
import {mobDeathMotion} from './mob-death-motion.js';
import {validateMobType,selectMobSubcategory} from './mob-types.js';
import {createMobBehaviorRegistry} from './mob-ai.js';
function hash32(value) {
  let h = 2166136261;
  for (const char of String(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

function seededRandom(seed) {
  let state = hash32(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function playerPosition(player) {
  const position = player?.position || player;
  const x = Number(position?.x);
  const z = Number(position?.z);
  return Number.isFinite(x) && Number.isFinite(z) ? {x,z,id:player?.id,kind:player?.kind??'player',faction:player?.faction??'players',alive:player?.alive!==false} : null;
}

function cloneRecord(record) {
  return { ...record, loot: { ...record.loot } };
}

export function createMobPopulation({
  definition, seed=0,heightAt=()=>0,canStand=()=>true,random,clipDurations={},
  behaviors=createMobBehaviorRegistry(),legacySnapshot=false,
}={}) {
  if(!validateMobType(definition))throw new TypeError('Invalid mob definition');
  const behavior=behaviors.get(definition.behavior.id);
  const roles=definition.animations,spawn=definition.spawn;
  const CELL_SIZE=spawn.cellSize,MOB_RADIUS=spawn.activeRadius,MAX_ACTIVE=spawn.liveLimit,MAX_CORPSES=spawn.corpseLimit;
  const RESPAWN_SECONDS=spawn.respawnSeconds,CORPSE_TTL_MS=spawn.corpseTTLSeconds*1000;
  const ITEMS=new Set(Object.keys(definition.loot));
  const CLIPS=[...new Set([roles.idle,roles.walk,roles.fast,roles.run,roles.rest,...roles.forage])];
  const emptyLoot=()=>Object.fromEntries([...ITEMS].map(id=>[id,0]));
  const validLoot=loot=>loot&&typeof loot==='object'&&!Array.isArray(loot)&&Object.keys(loot).length===ITEMS.size&&[...ITEMS].every(id=>Number.isSafeInteger(loot[id])&&loot[id]>=0&&loot[id]<=definition.loot[id].max);
  const appearance=record=>({...record,type:definition.id,displayName:definition.name,category:definition.category??definition.id,
    subcategory:record.subcategory??selectMobSubcategory(definition,seed,record.id),faction:definition.faction,maxHp:definition.stats.maxHealth});
  const seedValue = Number.isFinite(Number(seed)) ? Number(seed) : hash32(seed);
  const rng = typeof random === 'function' ? random : seededRandom(seedValue);
  const randomUnit = () => Math.max(0, Math.min(0.999999999999, finite(Number(rng()), 0)));
  const durations={...roles.durations,...clipDurations};
  let debugCounter=0;
  let clock = 0;
  let behaviorClock = 0;
  let realNow = Date.now;
  let mobs = new Map();
  let generations = new Map();
  let initialSites = null;
  let candidateCache = new Map();
  let lastCandidatePositions = null;
  let candidateCacheAge = Infinity;

  const siteKey = (cx, cz, member) => `${cx},${cz},${member}`;
  const mobId = (cx, cz, member, generation) => `${spawn.idPrefix}:${cx},${cz}:${member}:g${generation}`;

  function safePoint(x, z) {
    try {
      const y = Number(heightAt(x, z));
      return Number.isFinite(y) && canStand(x, z) !== false ? y : null;
    } catch {
      return null;
    }
  }

  function makeInitialSites() {
    if (initialSites) return initialSites;
    const positions = [];
    for (let radius = 8; radius <= 14 && positions.length !== spawn.starterCount; radius += 1) {
      for (let offset = 0; offset < 24 && positions.length !== spawn.starterCount; offset++) {
        const points = [0, 1, 2].map(i => {
          const angle = (offset / 24 + i / 3) * Math.PI * 2;
          return [Math.cos(angle) * radius, Math.sin(angle) * radius];
        });
        const yValues = points.map(([x, z]) => safePoint(x, z));
        if (yValues.every(y => y !== null)) {
          positions.push(...points.map(([x, z], member) => ({ x, y: yValues[member], z })));
        }
      }
    }
    if (positions.length !== spawn.starterCount) {
      const safePoints = [];
      for (let radius = 8; radius <= 20 && positions.length !== spawn.starterCount; radius += 1) {
        for (let i = 0; i < 64; i++) {
          const angle = i / 64 * Math.PI * 2;
          const x = Math.cos(angle) * radius;
          const z = Math.sin(angle) * radius;
          const y = safePoint(x, z);
          if (y !== null) safePoints.push({ x, y, z });
        }
      }
      for (const point of safePoints) {
        if (positions.every(existing => Math.hypot(point.x - existing.x, point.z - existing.z) >= 8)) positions.push(point);
        if (positions.length === spawn.starterCount) break;
      }
    }
    initialSites = positions.length === spawn.starterCount ? positions.map((p, member) => ({ ...p, cx: 0, cz: 0, member })) : [];
    return initialSites;
  }

  function siteCandidates(cx, cz) {
    if (cx === 0 && cz === 0) return makeInitialSites();
    const seedKey = `${seedValue}:${cx}:${cz}`;
    const roll = hash32(`${seedKey}:presence`) / 4294967296;
    if (roll >= spawn.chance) return [];
    const count = spawn.groupMin + (hash32(`${seedKey}:count`) % (spawn.groupMax-spawn.groupMin+1));
    const baseX = cx * CELL_SIZE + hash32(`${seedKey}:x`) / 4294967296 * CELL_SIZE;
    const baseZ = cz * CELL_SIZE + hash32(`${seedKey}:z`) / 4294967296 * CELL_SIZE;
    const result = [];
    for (let member = 0; member < count; member++) {
      const angle = hash32(`${seedKey}:${member}:angle`) / 4294967296 * Math.PI * 2;
      const radius = member === 0 ? 0 : 0.6 + hash32(`${seedKey}:${member}:radius`) / 4294967296 * 2.2;
      let x = baseX + Math.cos(angle) * radius;
      let z = baseZ + Math.sin(angle) * radius;
      let y = safePoint(x, z);
      if (y === null) {
        let found = false;
        for (let attempt = 0; attempt < 12; attempt++) {
          const a = angle + attempt * 2.399963229728653;
          x = baseX + Math.cos(a) * (1 + Math.floor(attempt / 6) * 2);
          z = baseZ + Math.sin(a) * (1 + Math.floor(attempt / 6) * 2);
          y = safePoint(x, z);
          if (y !== null) { found = true; break; }
        }
        if (!found) continue;
      }
      result.push({ cx, cz, member, x, y, z });
    }
    return result;
  }

  function newMob(site, generation = 0, options = {}) {
    const id = options.id??mobId(site.cx, site.cz, site.member, generation);
    const localRandom = seededRandom(`${seedValue}:${id}:behavior`);
    const mob = {
      id, x: site.x, y: site.y, z: site.z, spawnX: site.spawnX??site.x, spawnZ: site.spawnZ??site.z,
      yaw: localRandom() * Math.PI * 2,
      state: roles.idle, stateStart: behaviorClock, hp: definition.stats.maxHealth, deathAt: null,
      loot: emptyLoot(),
      velocityX: 0, velocityZ: 0,
      cx: site.cx, cz: site.cz, member: site.member, generation,
      fleeClearTime: 0, actionTime: 3 + localRandom() * 5,
      peck: 0, randomState: hash32(`${seedValue}:${id}:behavior`) || 1,
      targetX: site.x, targetZ: site.z,
    };
    if(options.transient){mob.transient=true;mob.subcategory=options.subcategory;mob.flockId=options.flockId;}
    const record=appearance(mob);mobs.set(id,record);
    return record;
  }

  function mobRandom(mob) {
    let value = (mob.randomState + 0x6d2b79f5) >>> 0;
    mob.randomState = value;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  function die(mob) {
    if (mob.hp <= 0) return false;
    mob.hp = 0;
    mob.state = 'Dead';
    mob.stateStart = behaviorClock;
    mob.deathAt = realNow();
    mob.deathClock = clock;
    mob.loot=Object.fromEntries(Object.entries(definition.loot).map(([id,range])=>[id,range.min+Math.floor(randomUnit()*(range.max-range.min+1))]));
    if(!mob.transient)generations.set(siteKey(mob.cx, mob.cz, mob.member), Math.max(generations.get(siteKey(mob.cx, mob.cz, mob.member)) ?? 0, mob.generation));
    return true;
  }

  function closestDistanceSquared(position, players) {
    let minimum = Infinity;
    for (const player of players) {
      const dx = position.x - player.x;
      const dz = position.z - player.z;
      minimum = Math.min(minimum, dx * dx + dz * dz);
    }
    return minimum;
  }

  function beginState(mob,state){
    mob.state=state;mob.stateStart=behaviorClock;
    const [min,max]=definition.behavior.actionSeconds;
    mob.actionTime=roles.forage.includes(state)?durations[state]:min+mobRandom(mob)*(max-min);
    if(state===roles.walk||state===roles.fast){mob.targetX=mob.x+(mobRandom(mob)*2-1)*8;mob.targetZ=mob.z+(mobRandom(mob)*2-1)*8;}
  }
  function updateMob(mob,dt,targets,groups){behavior(mob,{dt,targets,definition,random:mobRandom,beginState,safePoint,flock:groups.get(mob.flockId??(mob.transient?mob.id:`${mob.cx},${mob.cz}`))});}

  function tick(dt, players = [], { clockRunning = true,targets=null } = {}) {
    const step = Math.max(0, Math.min(3600, finite(Number(dt), 0)));
    const normalizedPlayers = (Array.isArray(players) ? players : []).map(playerPosition).filter(Boolean);
    if (clockRunning) clock += step;
    behaviorClock += step;
    const radius2 = MOB_RADIUS * MOB_RADIUS;
    let activeKeys=new Set();

    if (normalizedPlayers.length) {
      candidateCacheAge += step;
      const movedEnough = !lastCandidatePositions || lastCandidatePositions.length !== normalizedPlayers.length ||
        normalizedPlayers.some((player, index) => {
          const previous = lastCandidatePositions[index];
          return !previous || (player.x - previous.x) ** 2 + (player.z - previous.z) ** 2 >= 144;
        });
      if (movedEnough || candidateCacheAge >= 0.5) {
        candidateCache = new Map();
        const cellReach = Math.ceil(MOB_RADIUS / CELL_SIZE);
        for (const player of normalizedPlayers) {
          const cx = Math.floor(player.x / CELL_SIZE);
          const cz = Math.floor(player.z / CELL_SIZE);
          for (let dz = -cellReach - 1; dz <= cellReach + 1; dz++) {
            for (let dx = -cellReach - 1; dx <= cellReach + 1; dx++) {
              for (const site of siteCandidates(cx + dx, cz + dz)) candidateCache.set(siteKey(site.cx, site.cz, site.member), site);
            }
          }
        }
        for (const key of generations.keys()) {
          const [cx, cz, member] = key.split(',').map(Number);
          const site = siteCandidates(cx, cz).find(candidate => candidate.member === member);
          if (site) candidateCache.set(key, site);
        }
        lastCandidatePositions = normalizedPlayers.map(({ x, z }) => ({ x, z }));
        candidateCacheAge = 0;
      }
      const candidates = new Map();
      for (const [key, site] of candidateCache) {
        const generation=generations.get(key)||0;
        const existing=mobs.get(mobId(site.cx,site.cz,site.member,generation));
        const d2=closestDistanceSquared(existing?.hp>0?existing:site,normalizedPlayers);
        if(d2<=radius2)candidates.set(key,{site,d2});
      }
      // Spawn sectors are only for discovering new animals. A moving animal
      // stays eligible by its actual position even after its home sector leaves.
      for(const mob of mobs.values()){
        if(mob.hp<=0||mob.transient)continue;
        const d2=closestDistanceSquared(mob,normalizedPlayers);
        if(d2<=radius2)candidates.set(siteKey(mob.cx,mob.cz,mob.member),{site:mob,d2});
      }
      const ordered = [...candidates.entries()].sort((a, b) => a[1].d2 - b[1].d2).slice(0, MAX_ACTIVE);
      activeKeys = new Set(ordered.map(([key]) => key));
      for (const [key, { site }] of ordered) {
        const generation = generations.get(key) || 0;
        const id = mobId(site.cx, site.cz, site.member, generation);
        if (!mobs.has(id)) newMob(site, generation);
      }

      const groups=buildMobFlocks(mobs.values());
      for (const mob of mobs.values()) {
        const d2 = closestDistanceSquared(mob, normalizedPlayers);
        if (d2 > radius2) continue;
        if (mob.hp <= 0) {
          if (mob.deathAt !== null && realNow() - mob.deathAt >= CORPSE_TTL_MS) {
            mob.loot=emptyLoot();
          }
          continue;
        }
        const key = siteKey(mob.cx, mob.cz, mob.member);
        if (mob.transient||activeKeys.has(key)) updateMob(mob, step, targets??normalizedPlayers,groups);
      }

      if (clockRunning) {
        for (const [key, generation] of [...generations]) {
          const [cx, cz, member] = key.split(',').map(Number);
          const slot = candidateCache.get(key);
          if (!slot || !normalizedPlayers.some(p => (slot.x - p.x) ** 2 + (slot.z - p.z) ** 2 <= radius2)) continue;
          const currentId = mobId(cx, cz, member, generation);
          const current = mobs.get(currentId);
          if (current?.hp === 0 && clock - current.deathClock >= RESPAWN_SECONDS) {
            generations.set(key, generation + 1);
            newMob(slot, generation + 1);
          }
        }
      }
    } else {
      candidateCache.clear();
      lastCandidatePositions = null;
      candidateCacheAge = Infinity;
    }

    const playersOrOrigin = normalizedPlayers;
    for (const [id, mob] of mobs) {
      const key = siteKey(mob.cx, mob.cz, mob.member);
      if (mob.hp > 0 && ((!mob.transient&&!activeKeys.has(key)) || closestDistanceSquared(mob, normalizedPlayers) > radius2)) mobs.delete(id);
      else if (mob.hp === 0 && mob.deathAt !== null && realNow() - mob.deathAt >= CORPSE_TTL_MS) {
        if (mob.transient||(generations.get(key) ?? 0) > mob.generation) mobs.delete(id);
      }
    }
    const visible = [...mobs.values()].filter(mob => playersOrOrigin.some(player =>
      (mob.x - player.x) ** 2 + (mob.z - player.z) ** 2 <= radius2) &&
      (mob.hp > 0 || (mob.deathAt !== null && realNow() - mob.deathAt < CORPSE_TTL_MS)));
    const nearest = (a, b) => closestDistanceSquared(a, playersOrOrigin) - closestDistanceSquared(b, playersOrOrigin);
    const live = visible.filter(mob => mob.hp > 0).sort(nearest).slice(0, MAX_ACTIVE);
    const corpses = visible.filter(mob => mob.hp <= 0).sort(nearest).slice(0, MAX_CORPSES);
    return [...live, ...corpses].map(cloneRecord);
  }

  function findMob(id) { return mobs.get(String(id)); }

  function damage(id,amount,attacker=null){
    const mob=findMob(id);if(!mob||mob.hp<=0||!Number.isFinite(amount)||amount<=0)return false;
    if(amount<mob.hp){mob.hp-=amount;return true;}
    if(attacker)Object.assign(mob,mobDeathMotion(mob,attacker));
    return die(mob);
  }
  function hit(id,attacker=null){return damage(id,1,attacker);}

  function take(id, item, count, canAdd = () => true, add = () => true) {
    const mob = findMob(id);
    if (!mob || mob.hp > 0 || !ITEMS.has(item) || !Number.isInteger(count) || count <= 0) return 0;
    if (mob.deathAt === null || realNow() - mob.deathAt >= CORPSE_TTL_MS) {
      mob.loot=emptyLoot();
      return 0;
    }
    const available = mob.loot[item];
    const taken = Math.min(count, available);
    if (!taken) return 0;
    try {
      if (canAdd(item, taken) !== true || add(item, taken) !== true) return 0;
    } catch { return 0; }
    mob.loot[item] -= taken;
    return taken;
  }

  function snapshot() {
    const corpses = [...mobs.values()].filter(mob => mob.hp === 0&&!mob.transient).map(mob => ({
      id: mob.id, cx: mob.cx, cz: mob.cz, member: mob.member, generation: mob.generation,
      x: mob.x, y: mob.y, z: mob.z, yaw: mob.yaw, deathAt: mob.deathAt,
      deathClock: mob.deathClock, loot: {...mob.loot},subcategory:mob.subcategory,
    }));
    const live = [...mobs.values()].filter(mob => mob.hp > 0&&!mob.transient).slice(0, MAX_ACTIVE).map(mob => ({
      id: mob.id, cx: mob.cx, cz: mob.cz, member: mob.member, generation: mob.generation,
      x: mob.x, y: mob.y, z: mob.z, yaw: mob.yaw, state: mob.state, stateStart: mob.stateStart,
      spawnX:mob.spawnX,spawnZ:mob.spawnZ,
      subcategory:mob.subcategory,flockFollowing:mob.flockFollowing===true,hp: mob.hp, velocityX: mob.velocityX, velocityZ: mob.velocityZ, fleeClearTime: mob.fleeClearTime,
      actionTime: mob.actionTime, randomState: mob.randomState, targetX: mob.targetX, targetZ: mob.targetZ,
    }));
    return {
      version: 1, ...(legacySnapshot?{}:{type:definition.id}),seed: seedValue, clock, behaviorClock,
      generations: [...generations].map(([key, generation]) => [key, generation]),
      corpses, live,
    };
  }

  function restore(value) {
    if (!value || (value.type!==undefined&&value.type!==definition.id)||value.version !== 1 || value.seed !== seedValue || !Number.isFinite(value.clock) || value.clock < 0 ||
        (value.behaviorClock !== undefined && (!Number.isFinite(value.behaviorClock) || value.behaviorClock < 0)) ||
        !Array.isArray(value.generations) || value.generations.length > 100_000 ||
        !Array.isArray(value.corpses) || value.corpses.length > 100_000 ||
        (value.live !== undefined && (!Array.isArray(value.live) || value.live.length > MAX_ACTIVE))) return false;
    const nextGenerations = new Map();
    for (const pair of value.generations) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !Number.isSafeInteger(pair[1]) || pair[1] < 0 || pair[1] > 1_000_000_000) return false;
      const parts = pair[0].split(',').map(Number);
      if (parts.length !== 3 || parts.some(n => !Number.isInteger(n)) || parts.some(n => Math.abs(n) > 100_000) ||
          parts[2] < 0 || parts[2] >= spawn.groupMax || parts.join(',') !== pair[0] || nextGenerations.has(pair[0])) return false;
      if (!siteCandidates(parts[0], parts[1]).some(site => site.member === parts[2])) return false;
      nextGenerations.set(pair[0], pair[1]);
    }
    const nextMobs = new Map();
    for (const body of value.corpses) {
      if (!body || typeof body.id !== 'string' || !Number.isInteger(body.cx) || !Number.isInteger(body.cz) ||
          !Number.isInteger(body.member) || body.member < 0 || body.member >= spawn.groupMax || !Number.isInteger(body.generation) || body.generation < 0 ||
          ![body.x, body.y, body.z, body.yaw, body.deathAt, body.deathClock].every(Number.isFinite) || body.deathAt < 0 ||
          body.deathClock < 0 || body.deathClock > value.clock || Math.abs(body.x) > 9_600_000 ||
          Math.abs(body.z) > 9_600_000 || Math.abs(body.y) > 100_000 ||
          !validLoot(body.loot)||(body.subcategory!==undefined&&!Object.hasOwn(definition.subcategories,body.subcategory))||
          body.id !== mobId(body.cx, body.cz, body.member, body.generation) || nextMobs.has(body.id)) return false;
      const slot = siteKey(body.cx, body.cz, body.member);
      if (!nextGenerations.has(slot) || body.generation > nextGenerations.get(slot)) return false;
      nextMobs.set(body.id, appearance({
        ...body, state: 'Dead', stateStart: body.deathClock, hp: 0,
        velocityX: 0, velocityZ: 0, fleeClearTime: 0, actionTime: 0, peck: 0,
        randomState: hash32(body.id) || 1, targetX: body.x, targetZ: body.z,
        loot: {...body.loot},
      }));
    }
    for (const animal of value.live || []) {
      const hasSpawnX=Object.hasOwn(animal??{},'spawnX'),hasSpawnZ=Object.hasOwn(animal??{},'spawnZ');
      if (!animal || typeof animal.id !== 'string' || !Number.isInteger(animal.cx) || !Number.isInteger(animal.cz) ||
          !Number.isInteger(animal.member) || animal.member < 0 || animal.member >= spawn.groupMax || !Number.isInteger(animal.generation) ||
          animal.generation < 0 || (animal.flockFollowing!==undefined&&typeof animal.flockFollowing!=='boolean')||!CLIPS.includes(animal.state) ||
          ![animal.x, animal.y, animal.z, animal.yaw, animal.stateStart, animal.hp, animal.velocityX, animal.velocityZ,
            animal.fleeClearTime, animal.actionTime, animal.targetX, animal.targetZ].every(Number.isFinite) ||
          Math.abs(animal.x) > 9_600_000 || Math.abs(animal.z) > 9_600_000 || Math.abs(animal.y) > 100_000 ||
          (hasSpawnX!==hasSpawnZ)||(hasSpawnX&&(!Number.isFinite(animal.spawnX)||!Number.isFinite(animal.spawnZ)||Math.abs(animal.spawnX)>9_600_000||Math.abs(animal.spawnZ)>9_600_000))||
          Math.abs(animal.targetX) > 9_600_000 || Math.abs(animal.targetZ) > 9_600_000 || (animal.hp<=0||animal.hp>definition.stats.maxHealth)||(animal.subcategory!==undefined&&!Object.hasOwn(definition.subcategories,animal.subcategory)) ||
          animal.stateStart < 0 || animal.stateStart > (value.behaviorClock ?? value.clock) || animal.fleeClearTime < 0 ||
          animal.actionTime < 0 || !Number.isSafeInteger(animal.randomState) || animal.randomState < 0 || animal.randomState > 0xffffffff ||
          animal.id !== mobId(animal.cx, animal.cz, animal.member, animal.generation) || nextMobs.has(animal.id)) return false;
      const slot = siteKey(animal.cx, animal.cz, animal.member);
      const sourceSite=siteCandidates(animal.cx, animal.cz).find(site => site.member === animal.member);
      if ((nextGenerations.get(slot) ?? 0) !== animal.generation || !sourceSite) return false;
      nextMobs.set(animal.id, appearance({
        ...animal, spawnX:hasSpawnX?animal.spawnX:sourceSite.x,spawnZ:hasSpawnZ?animal.spawnZ:sourceSite.z,
        deathAt: null, loot: emptyLoot(), deathClock: null,
        peck: 0,
      }));
    }
    clock = value.clock;
    behaviorClock = value.behaviorClock ?? value.clock;
    generations = nextGenerations;
    mobs = nextMobs;
    candidateCache.clear();
    lastCandidatePositions = null;
    candidateCacheAge = Infinity;
    return true;
  }

  function clear() {
    mobs.clear();
    generations.clear();
    debugCounter=0;
    clock = 0;
    behaviorClock = 0;
    initialSites = null;
    candidateCache.clear();
    lastCandidatePositions = null;
    candidateCacheAge = Infinity;
  }

  function spawnTransient(x,z,{subcategory,flockId}={}){
    if(!Number.isFinite(x)||!Number.isFinite(z)||Math.abs(x)>200000||Math.abs(z)>200000)return null;
    if(flockId!==undefined&&(typeof flockId!=='string'||flockId.length>100))return null;
    if(subcategory!==undefined&&!Object.hasOwn(definition.subcategories,subcategory))return null;
    if([...mobs.values()].filter(m=>m.transient).length>=8)return null;
    const y=safePoint(x,z);if(y===null)return null;
    const mob=newMob({x,y,z,cx:Math.floor(x/CELL_SIZE),cz:Math.floor(z/CELL_SIZE),member:0},0,
      {id:`${spawn.idPrefix}:debug:${++debugCounter}`,transient:true,subcategory,flockId});
    return cloneRecord(mob);
  }
  function clearTransient(){const ids=[];for(const [id,mob] of mobs)if(mob.transient){ids.push(id);mobs.delete(id);}return ids;}
  return { tick, hit, damage, take, snapshot, restore, clear, reset: clear,spawnTransient,clearTransient,setClipDurations(values){for(const [clip,duration] of Object.entries(values))if(Number.isFinite(duration)&&duration>0)durations[clip]=duration;}, get clips() { return [...CLIPS]; } };
}
