import test from 'node:test';
import assert from 'node:assert/strict';
import { createHenWorld, HEN_RULES, validateHenSnapshot } from '../src/hen-rules.js';

test('seeded world guarantees three nearby hens and stable cell populations', () => {
  const worldA = createHenWorld({ seed: 712, heightAt: () => 2, canStand: () => true });
  const worldB = createHenWorld({ seed: 712, heightAt: () => 2, canStand: () => true });
  const first = worldA.tick(0, [{ x: 0, z: 0 }]);
  const second = worldB.tick(0, [{ x: 0, z: 0 }]);
  assert.equal(first.filter(hen => hen.hp > 0).length >= 3, true);
  assert.deepEqual(first.map(({ id, x, y, z }) => ({ id, x, y, z })), second.map(({ id, x, y, z }) => ({ id, x, y, z })));
  assert.ok(first.every(hen => Math.hypot(hen.x, hen.z) < 20));
  const startingPositions = first.slice(0, 3);
  for (let i = 0; i < startingPositions.length; i++) {
    for (let j = i + 1; j < startingPositions.length; j++) {
      assert.ok(Math.hypot(startingPositions[i].x - startingPositions[j].x, startingPositions[i].z - startingPositions[j].z) >= 8);
    }
  }
  assert.equal(HEN_RULES.CELL_SIZE, 96);
  assert.equal(HEN_RULES.HEN_RADIUS, 120);
});

test('hens only spawn on standable ground and active population is capped around players', () => {
  const dryWorld = createHenWorld({ seed: 9, heightAt: () => -1, canStand: () => false });
  assert.equal(dryWorld.tick(0, [{ x: 0, z: 0 }]).length, 0);

  const world = createHenWorld({ seed: 47 });
  const active = world.tick(0, [{ x: 0, z: 0 }, { x: 400, z: -200 }]);
  assert.ok(active.length <= 24);
  assert.ok(active.every(hen => [{ x: 0, z: 0 }, { x: 400, z: -200 }]
    .some(player => (hen.x - player.x) ** 2 + (hen.z - player.z) ** 2 <= 120 ** 2)));
});

test('candidate terrain checks are cached for half a second and refresh after player movement', () => {
  let heightCalls = 0;
  // Isolate generation queries from locomotion/cohesion terrain probes.
  const world = createHenWorld({ seed: 19, heightAt: () => { heightCalls++; return 0; },behaviors:{get:()=>()=>{}} });
  world.tick(0, [{ x: 0, z: 0 }]);
  const firstCount = heightCalls;
  world.tick(0.1, [{ x: 0, z: 0 }]);
  assert.equal(heightCalls, firstCount);
  world.tick(0.4, [{ x: 0, z: 0 }]);
  assert.ok(heightCalls > firstCount);
  const refreshedCount = heightCalls;
  world.tick(0.01, [{ x: 12, z: 0 }]);
  assert.ok(heightCalls > refreshedCount);
});

test('animal behavior keeps moving while day and respawn clock is paused', () => {
  const world = createHenWorld({ seed: 17 });
  const hen = world.tick(0, [{ x: 0, z: 0 }])[0];
  const player = { x: hen.x + 20, z: hen.z };
  world.tick(9, [player], { clockRunning: false });
  const paused = world.tick(0, [player], { clockRunning: false }).find(record => record.id === hen.id);
  assert.equal(world.snapshot().clock, 0);
  assert.equal(world.snapshot().behaviorClock, 9);
  assert.ok(paused.stateStart > 0);
  assert.ok(paused.state !== 'Run');
});

test('nearby players trigger Run and the hen calms after three clear seconds beyond 10m', () => {
  const world = createHenWorld({ seed: 81 });
  const hen = world.tick(0, [{ x: 0, z: 0 }])[0];
  assert.ok(hen);
  world.tick(0.1, [{ x: hen.x + 2, z: hen.z }]);
  let fleeing = world.tick(0, [{ x: hen.x + 2, z: hen.z }]).find(record => record.id === hen.id);
  assert.equal(fleeing.state, 'Run');
  world.tick(1, [{ x: hen.x + 20, z: hen.z }]);
  world.tick(1, [{ x: hen.x + 20, z: hen.z }]);
  world.tick(1.1, [{ x: hen.x + 20, z: hen.z }]);
  fleeing = world.tick(0, [{ x: hen.x + 20, z: hen.z }]).find(record => record.id === hen.id);
  assert.notEqual(fleeing.state, 'Run');
  assert.ok(HEN_RULES.CLIPS.includes(fleeing.state));
});

test('lethal hit creates one loot-bearing corpse and take respects capacity and amounts', () => {
  let now = 10_000;
  const realDateNow = Date.now;
  Date.now = () => now;
  try {
    const world = createHenWorld({ seed: 123, random: () => 0.999 });
    const hen = world.tick(0, [{ x: 0, z: 0 }])[0];
    assert.equal(world.hit('missing'), false);
    assert.equal(world.hit(hen.id), true);
    assert.equal(world.hit(hen.id), false);
    const corpse = world.tick(0, [{ x: 0, z: 0 }]).find(record => record.id === hen.id);
    assert.equal(corpse.hp, 0);
    assert.equal(corpse.state, 'Dead');
    assert.deepEqual(corpse.loot, { chicken_meat: 3, feather: 5 });
    assert.equal(world.take(hen.id, 'chicken_meat', 2, () => false, () => true), 0);
    assert.equal(world.take(hen.id, 'chicken_meat', 2, (kind, n) => kind === 'chicken_meat' && n === 2, () => true), 2);
    assert.equal(world.take(hen.id, 'chicken_meat', 5), 1);
    assert.equal(world.take(hen.id, 'chicken_meat', 1), 0);
    assert.equal(world.take(hen.id, 'unknown', 1), 0);
    assert.equal(world.take(hen.id, 'feather', 1, () => true, () => false), 0);
    assert.equal(world.tick(0, [{ x: 0, z: 0 }]).find(record => record.id === hen.id).loot.feather, 5);
  } finally {
    Date.now = realDateNow;
  }
});

test('simulation clock pauses, respawns after 48 running minutes, and keeps old corpse until one-hour TTL', () => {
  let now = 1_000_000;
  const realDateNow = Date.now;
  Date.now = () => now;
  try {
    const world = createHenWorld({ seed: 2, random: () => 0 });
    const startingHens = world.tick(0, [{ x: 0, z: 0 }]);
    const hen = startingHens[0];
    for (const startingHen of startingHens) world.hit(startingHen.id);
    const corpseId = hen.id;
    world.tick(47 * 60, [{ x: 0, z: 0 }], { clockRunning: false });
    assert.equal(world.tick(0, [{ x: 0, z: 0 }]).some(record => record.hp > 0), false);
    world.tick(47 * 60, [{ x: 0, z: 0 }]);
    assert.equal(world.tick(0, [{ x: 0, z: 0 }]).some(record => record.hp > 0), false);
    world.tick(60, [{ x: 0, z: 0 }]);
    let nearby = world.tick(0, [{ x: 0, z: 0 }]);
    assert.ok(nearby.some(record => record.hp > 0 && record.id !== corpseId));
    assert.ok(nearby.some(record => record.id === corpseId));
    now += HEN_RULES.CORPSE_TTL_MS + 1;
    assert.equal(world.take(corpseId, 'feather', 1), 0);
    nearby = world.tick(0, [{ x: 0, z: 0 }]);
    assert.equal(nearby.some(record => record.id === corpseId), false);
  } finally {
    Date.now = realDateNow;
  }
});

test('expired corpse keeps its spawn tombstone through save until simulation-clock respawn', () => {
  let now = 2_000_000;
  const realDateNow = Date.now;
  Date.now = () => now;
  try {
    const world = createHenWorld({ seed: 221 });
    const hen = world.tick(0, [{ x: 0, z: 0 }])[0];
    world.hit(hen.id);
    now += HEN_RULES.CORPSE_TTL_MS + 1;
    assert.equal(world.take(hen.id, 'chicken_meat', 1), 0);
    const hidden = world.tick(0, [{ x: 0, z: 0 }], { clockRunning: false });
    assert.equal(hidden.some(record => record.id === hen.id), false);
    const saved = world.snapshot();
    assert.equal(saved.generations.find(([key]) => key === `${saved.corpses[0].cx},${saved.corpses[0].cz},${saved.corpses[0].member}`)?.[1], 0);

    const restored = createHenWorld({ seed: 221 });
    assert.equal(restored.restore(saved), true);
    assert.equal(restored.tick(0, [{ x: 0, z: 0 }], { clockRunning: false }).some(record => record.id === hen.id), false);
    const afterRespawn = restored.tick(HEN_RULES.RESPAWN_SECONDS, [{ x: 0, z: 0 }]);
    assert.ok(afterRespawn.some(record => record.id === hen.id.replace(/g0$/, 'g1') && record.hp > 0));
  } finally {
    Date.now = realDateNow;
  }
});

test('snapshot restores generation, corpse loot, live position/state and both clocks; malformed data is rejected', () => {
  const original = createHenWorld({ seed: 35, random: () => 0.2 });
  const hen = original.tick(2, [{ x: 0, z: 0 }])[0];
  original.tick(10, [{ x: 0, z: 0 }]);
  original.hit(hen.id);
  original.take(hen.id, 'feather', 1);
  const liveHen = original.tick(0, [{ x: 0, z: 0 }]).find(record => record.hp > 0);
  const saved = original.snapshot();
  assert.equal(validateHenSnapshot(saved, 35), true);
  assert.equal(validateHenSnapshot(saved, 36), false);
  const restored = createHenWorld({ seed: 35 });
  assert.equal(restored.restore(saved), true);
  assert.deepEqual(restored.snapshot(), saved);
  const restoredLive = restored.tick(0, [{ x: 0, z: 0 }]).find(record => record.id === liveHen.id);
  assert.deepEqual({ x: restoredLive.x, z: restoredLive.z, state: restoredLive.state, stateStart: restoredLive.stateStart },
    { x: liveHen.x, z: liveHen.z, state: liveHen.state, stateStart: liveHen.stateStart });
  const bad = structuredClone(saved);
  bad.corpses[0].loot.chicken_meat = 99;
  assert.equal(restored.restore(bad), false);
  assert.deepEqual(restored.snapshot(), saved);
});

test('nearby corpse output has its own cap and does not displace active hens', () => {
  const source = createHenWorld({ seed: 90 });
  source.tick(0, [{ x: 0, z: 0 }]);
  const saved = source.snapshot();
  const slot = saved.live[0];
  const slotKey = `${slot.cx},${slot.cz},${slot.member}`;
  saved.live = saved.live.filter(animal => animal.id !== slot.id);
  saved.generations = [[slotKey, 30]];
  saved.corpses = Array.from({ length: 30 }, (_, generation) => ({
    id: `hen:${slot.cx},${slot.cz}:${slot.member}:g${generation}`,
    cx: slot.cx, cz: slot.cz, member: slot.member, generation,
    x: slot.x, y: slot.y, z: slot.z, yaw: slot.yaw, deathAt: Date.now(), deathClock: 0,
    loot: { chicken_meat: 1, feather: 1 },
  }));

  const world = createHenWorld({ seed: 90 });
  assert.equal(world.restore(saved), true);
  const visible = world.tick(0, [{ x: 0, z: 0 }]);
  assert.ok(visible.filter(animal => animal.hp > 0).length >= 3);
  assert.equal(visible.filter(animal => animal.hp === 0).length, 30);
  assert.ok(visible.length <= HEN_RULES.MAX_ACTIVE + HEN_RULES.MAX_CORPSES);
});

test('clear resets clock, generations, and current hens', () => {
  const world = createHenWorld({ seed: 88 });
  const hen = world.tick(5, [{ x: 0, z: 0 }])[0];
  world.hit(hen.id);
  world.clear();
  assert.deepEqual(world.snapshot(), { version: 1, seed: 88, clock: 0, behaviorClock: 0, generations: [], corpses: [], live: [] });
});
