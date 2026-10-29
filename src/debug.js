// Only loaded by index_debug.html. Never expose these controls on the normal page.
export function installDebug(ctx) {
  const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  const activeTimers = new Map();
  const stop = code => {
    ctx.keys[code] = false;
    if (activeTimers.has(code)) clearTimeout(activeTimers.get(code));
    activeTimers.delete(code);
  };
  const releaseAll = () => { for (const code of movementKeys) stop(code); };
  const events = [];
  const addEvent = (type, details = {}) => {
    events.push({ time: Math.round(performance.now()), type, ...details });
    if (events.length > 150) events.shift();
  };
  const heading = (x, z) => Math.atan2(-(x - ctx.px), -(z - ctx.pz));
  const relativeAngle = (x, z) => {
    let a = heading(x, z) - ctx.yaw;
    return Math.atan2(Math.sin(a), Math.cos(a));
  };
  const round = n => Math.round(n * 100) / 100;
  const positionOf = o => ({ x: round(o.x), z: round(o.z) });
  const describe = (type, id, x, z, extra = {}) => ({
    type, id, ...positionOf({x,z}), distance: round(Math.hypot(x-ctx.px,z-ctx.pz)),
    bearing: round(relativeAngle(x,z) * 180 / Math.PI), ...extra
  });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  let lastTreeHP = new Map();
  let lastPlayers = new Set();
  let lastCuts = ctx.cuts;
  let lastCollisionTime = 0;
  const scanEvents = () => {
    const players = new Set(ctx.avatars.keys());
    for (const id of players) if (!lastPlayers.has(id)) addEvent('player_seen', {id});
    for (const id of lastPlayers) if (!players.has(id)) addEvent('player_left', {id});
    lastPlayers = players;
    const current = new Map([...ctx.trees].map(([id,t]) => [id,t.userData.hp]));
    for (const [id,hp] of current) if (lastTreeHP.has(id) && lastTreeHP.get(id) > hp)
      addEvent('tree_hit', {id,hp});
    for (const [id,hp] of lastTreeHP) if (!current.has(id) && ctx.felled.has(id))
      addEvent('tree_felled', {id});
    lastTreeHP = current;
    if (ctx.cuts > lastCuts) addEvent('wood_collected', {cuts:ctx.cuts,wood:ctx.wood});
    lastCuts = ctx.cuts;
  };
  const eventPoll = setInterval(scanEvents, 250);
  window.addEventListener('pagehide', () => clearInterval(eventPoll));
  const api = {
    press(code) {
      if (!movementKeys.has(code)) throw new Error(`Unsupported movement key: ${code}`);
      stop(code);
      ctx.keys[code] = true;
      return api.state();
    },
    release(code) { stop(code); return api.state(); },
    releaseAll,
    async hold(code, milliseconds = 500) {
      if (!movementKeys.has(code)) throw new Error(`Unsupported movement key: ${code}`);
      if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 15000)
        throw new Error('Duration must be between 0 and 15000 ms');
      api.press(code);
      // Safety timeout also releases the key when an awaited DevTools call is cancelled.
      const timer = setTimeout(() => stop(code), milliseconds);
      activeTimers.set(code, timer);
      await new Promise(resolve => setTimeout(resolve, milliseconds));
      // Avoid releasing a newer press that started during the hold.
      if (activeTimers.get(code) === timer) stop(code);
      return api.state();
    },
    async move(direction, milliseconds = 500, sprint = false) {
      const codes = { forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD' };
      if (!codes[direction]) throw new Error('Use forward, backward, left, or right');
      if (sprint) api.press('ShiftLeft');
      try { return await api.hold(codes[direction], milliseconds); }
      finally { if (sprint) stop('ShiftLeft'); }
    },
    observe(radius = 12, limit = 18) {
      radius = Math.max(1, Math.min(100, Number(radius) || 12));
      limit = Math.max(1, Math.min(100, Math.floor(limit) || 18));
      const trees = [...ctx.trees.entries()].map(([id,t]) =>
        describe('tree',id,t.position.x,t.position.z,{hp:t.userData.hp,maxHp:t.userData.maxHp}))
        .filter(o => o.distance <= radius).sort((a,b)=>a.distance-b.distance).slice(0,limit);
      const players = [...ctx.avatars.entries()].map(([id,a]) =>
        describe('player',id,a.group.position.x,a.group.position.z,{jumping:a.jumping}))
        .filter(o => o.distance <= radius).sort((a,b)=>a.distance-b.distance);
      const logs = ctx.placed.map((log,i) => describe('log',log.id ?? i,log.x,log.z))
        .filter(o => o.distance <= radius).sort((a,b)=>a.distance-b.distance).slice(0,limit);
      const aimed = ctx.aimed();
      return {self:api.state(),target: aimed ? {id:aimed.userData.id,hp:aimed.userData.hp} : null,
        nearby:{trees,players,logs}, events:events.slice(-12)};
    },
    lookAt(x,z) {
      if (!Number.isFinite(x)||!Number.isFinite(z)) throw Error('Finite x,z required');
      ctx.yaw=heading(x,z);
      ctx.pitch=0;
      return api.state();
    },
    async navigateTo(x,z,{sprint=true,stopDistance=1.7,timeout=12000}={}) {
      if (!Number.isFinite(x)||!Number.isFinite(z)) throw Error('Finite x,z required');
      timeout=Math.max(100,Math.min(30000,timeout));
      const start=performance.now();let stagnant=0,previous=Infinity;
      try {
        while (performance.now()-start < timeout) {
          const distance=Math.hypot(x-ctx.px,z-ctx.pz);
          if (distance <= stopDistance) return {status:'arrived',distance:round(distance),state:api.state()};
          if (distance >= previous-.015) stagnant++; else stagnant=0;
          if (stagnant>=5) {
            addEvent('blocked',{x:round(ctx.px),z:round(ctx.pz)});
            return {status:'blocked',distance:round(distance),state:api.state()};
          }
          previous=distance;
          api.lookAt(x,z);
          if(sprint)api.press('ShiftLeft');
          await api.hold('KeyW',180);
        }
        return {status:'timeout',distance:round(Math.hypot(x-ctx.px,z-ctx.pz)),state:api.state()};
      } finally { releaseAll(); }
    },
    async chopTree(id,{maxHits=25}={}) {
      const tree=ctx.trees.get(id);
      if (!tree) return {status:'tree_not_found',id};
      // Approach to a point 1.8 m from the trunk, outside its mesh.
      const dx=ctx.px-tree.position.x,dz=ctx.pz-tree.position.z;
      const length=Math.hypot(dx,dz)||1;
      const tx=tree.position.x+dx/length*1.85,tz=tree.position.z+dz/length*1.85;
      const nav=await api.navigateTo(tx,tz,{sprint:true,stopDistance:.2,timeout:15000});
      if(nav.status!=='arrived' && nav.status!=='blocked') return {status:'navigation_'+nav.status,id,nav};
      api.lookAt(tree.position.x,tree.position.z);
      let hits=0;
      while (ctx.trees.has(id) && hits<maxHits) {
        // A raycast must actually select this trunk; don't blindly spam chop.
        if(ctx.aimed()?.userData.id!==id) return {status:'not_aimed',id,hits,position:api.state().position};
        const before=tree.userData.hp;
        ctx.chop();hits++;
        await pause(1350);
        if (tree.userData.hp===before && ctx.trees.has(id)) addEvent('chop_missed',{id});
      }
      return {status:ctx.trees.has(id)?'max_hits':'felled',id,hits,wood:ctx.wood,cuts:ctx.cuts};
    },
    events(since = 0) { return events.filter(e=>e.time>=since); },
    clearEvents(){events.length=0;},
    jump() { ctx.requestJump(); return api.state(); },
    chop() { ctx.chop(); return api.state(); },
    look(dx = 0, dy = 0) { ctx.look(dx, dy); return api.state(); },
    turn(radians) {
      if (!Number.isFinite(radians)) throw new Error('Angle must be finite');
      ctx.yaw += radians;
      return api.state();
    },
    view(thirdPerson = true) {
      if (!!thirdPerson !== ctx.thirdPerson) ctx.toggleView();
      return api.state();
    },
    state() {
      const avatar = ctx.ownAvatar;
      return {
        position: { x: ctx.px, y: ctx.feetY, z: ctx.pz },
        yaw: ctx.yaw, pitch: ctx.pitch, grounded: ctx.onGround,
        verticalSpeed: ctx.verticalSpeed, keys: Object.keys(ctx.keys).filter(k => ctx.keys[k]),
        animation: avatar ? { lower: avatar.lowerState, upper: avatar.upperState } : null,
        camera: { thirdPerson: ctx.thirdPerson },
        renderer: { draws: ctx.renderer.info.render.calls, triangles: ctx.renderer.info.render.triangles },
        world: { trees: ctx.trees.size, chunks: ctx.chunks.size }
      };
    },
    // Explicitly debug-only access for inspection of bones, materials and animation tracks.
    scene: ctx.scene, camera: ctx.camera, renderer: ctx.renderer,
    get player() { return ctx.ownAvatar; },
    get rootMotion() { return ctx.rootMotion; },
    help: 'observe(radius,limit), lookAt(x,z), navigateTo(x,z,options), chopTree(id), events(since), move(direction,ms,sprint), hold(code,ms), jump(), chop(), state()'
  };
  window.__gameDebug = api;
  window.addEventListener('blur', releaseAll);
  window.addEventListener('pagehide', releaseAll);
  console.info('Forest Chopper debug controls ready:', api.help);
}
