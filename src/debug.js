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
  let eventSequence = 0;
  const addEvent = (type, details = {}) => {
    events.push({ id: ++eventSequence, time: Math.round(performance.now()), type, ...details });
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
  const taskRecords = new Map();
  let taskCounter = 0;
  let activeTask = null;
  const cancelled = signal => { if (signal?.aborted) throw new Error('Task cancelled'); };
  const wait = async (ms, signal) => {
    if (!signal) return pause(ms);
    cancelled(signal);
    await new Promise(resolve => {
      const timer = setTimeout(done, ms);
      function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
      signal.addEventListener('abort', done, {once:true});
    });
    cancelled(signal);
  };
  const describeTask = task => task ? ({id:task.id,type:task.type,status:task.status,
    startedAt:task.startedAt,finishedAt:task.finishedAt??null,
    progress:task.progress??null,result:task.result??null,error:task.error??null}) : null;
  const cancelActive = () => { if (activeTask?.status==='running') activeTask.controller.abort(); releaseAll(); };

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
    async hold(code, milliseconds = 500, signal) {
      if (!movementKeys.has(code)) throw new Error(`Unsupported movement key: ${code}`);
      if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 15000)
        throw new Error('Duration must be between 0 and 15000 ms');
      cancelled(signal);
      api.press(code);
      // Safety timeout also releases the key when an awaited DevTools call is cancelled.
      const timer = setTimeout(() => stop(code), milliseconds);
      activeTimers.set(code, timer);
      try { await wait(milliseconds, signal); } finally { if (activeTimers.get(code) === timer) stop(code); }
      // Avoid releasing a newer press that started during the hold.
      return api.state();
    },
    async move(direction, milliseconds = 500, sprint = false, signal) {
      const codes = { forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD' };
      if (!codes[direction]) throw new Error('Use forward, backward, left, or right');
      if (sprint) api.press('ShiftLeft');
      try { return await api.hold(codes[direction], milliseconds, signal); }
      finally { if (sprint) stop('ShiftLeft'); }
    },
    chat(limit=30) { return ctx.chatHistory.slice(-Math.max(1,Math.min(120,limit))); },
    say(text) { return ctx.sendChat(text); },
    tasks(limit=30) {return api.chat(120).filter(m=>/^\s*[!/](?:task|задача|поручение)(?:\s|:|$)/i.test(m.text)).slice(-limit);},
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
    async navigateTo(x,z,{sprint=true,stopDistance=1.7,timeout=12000,signal,onProgress}={}) {
      if (!Number.isFinite(x)||!Number.isFinite(z)) throw Error('Finite x,z required');
      timeout=Math.max(100,Math.min(30000,timeout));
      const start=performance.now();let stagnant=0,previous=Infinity;
      try {
        while (performance.now()-start < timeout) {
          cancelled(signal);
          const distance=Math.hypot(x-ctx.px,z-ctx.pz);
          onProgress?.({phase:'moving',distance:round(distance),x:round(ctx.px),z:round(ctx.pz)});
          if (distance <= stopDistance) return {status:'arrived',distance:round(distance),state:api.state()};
          if (distance >= previous-.015) stagnant++; else stagnant=0;
          if (stagnant>=5) {
            addEvent('blocked',{x:round(ctx.px),z:round(ctx.pz)});
            return {status:'blocked',distance:round(distance),state:api.state()};
          }
          previous=distance;
          api.lookAt(x,z);
          if(sprint)api.press('ShiftLeft');
          await api.hold('KeyW',180,signal);
        }
        return {status:'timeout',distance:round(Math.hypot(x-ctx.px,z-ctx.pz)),state:api.state()};
      } finally { releaseAll(); }
    },
    async chopTree(id,{maxHits=25,signal,onProgress}={}) {
      cancelled(signal);
      const tree=ctx.trees.get(id);
      if (!tree) return {status:'tree_not_found',id};
      // Approach to a point 1.8 m from the trunk, outside its mesh.
      const dx=ctx.px-tree.position.x,dz=ctx.pz-tree.position.z;
      const length=Math.hypot(dx,dz)||1;
      const tx=tree.position.x+dx/length*1.85,tz=tree.position.z+dz/length*1.85;
      const nav=await api.navigateTo(tx,tz,{sprint:true,stopDistance:.2,timeout:15000,signal,onProgress});
      if(nav.status!=='arrived' && nav.status!=='blocked') return {status:'navigation_'+nav.status,id,nav};
      api.lookAt(tree.position.x,tree.position.z);
      let hits=0;
      while (ctx.trees.has(id) && hits<maxHits) {
        cancelled(signal);
        // A raycast must actually select this trunk; don't blindly spam chop.
        if(ctx.aimed()?.userData.id!==id) return {status:'not_aimed',id,hits,position:api.state().position};
        const before=tree.userData.hp;
        onProgress?.({phase:'chopping',treeId:id,hits,hp:before});
        ctx.chop();hits++;
        await wait(1350,signal);
        if (tree.userData.hp===before && ctx.trees.has(id)) addEvent('chop_missed',{id});
      }
      return {status:ctx.trees.has(id)?'max_hits':'felled',id,hits,wood:ctx.wood,cuts:ctx.cuts};
    },
    startTask(type, params = {}) {
      if (activeTask?.status === 'running') return {status:'busy',active:describeTask(activeTask)};
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw Error('Task parameters must be an object');
      const supported = ['navigate','chopTree','move','followPlayer'];
      if (!supported.includes(type)) throw Error('Unsupported task type: '+type);
      const controller = new AbortController();
      const task = {id:++taskCounter,type,status:'running',startedAt:Date.now(),controller,progress:{phase:'starting'},
        ...(type==='followPlayer'?{playerId:Number(params.playerId)}:{})};
      activeTask=task;
      taskRecords.set(task.id,task);
      // Do not block the MCP tool call: the promise continues inside the browser.
      Promise.resolve().then(async () => {
        const signal=controller.signal;
        const onProgress = progress => { task.progress = progress; };
        if(type==='navigate') return api.navigateTo(params.x,params.z,{...params,signal,onProgress});
        if(type==='chopTree') return api.chopTree(params.treeId,{...params,signal,onProgress});
        if(type==='move') {
          onProgress({phase:'moving',direction:params.direction});
          return api.move(params.direction,params.milliseconds??500,params.sprint??false,signal);
        }
        if(type==='followPlayer') {
          const playerId=Number(params.playerId);
          if(!Number.isInteger(playerId)) throw Error('Valid playerId required');
          // Follow is a persistent mode. It only ends on explicit cancellation,
          // when the target leaves, or when this tab is closed/reloaded.
          while(true) {
            cancelled(signal);
            const player=ctx.avatars.get(playerId);
            if(!player) return {status:'player_not_found',playerId};
            const {x,z}=player.group.position;
            const distance=Math.hypot(x-ctx.px,z-ctx.pz);
            if(distance>3) {
              onProgress({phase:'following',playerId,distance:round(distance)});
              // Re-sample the moving target frequently; no fixed destination.
              const nav=await api.navigateTo(x,z,{sprint:true,stopDistance:2,timeout:1200,signal});
              if(nav.status==='blocked') {
                onProgress({phase:'blocked',playerId,distance:nav.distance});
                await wait(450,signal);
              }
            } else {
              onProgress({phase:'near_player',playerId,distance:round(distance)});
              await wait(350,signal);
            }
          }
        }
      }).then(result=>{task.status=controller.signal.aborted?'cancelled':'completed';task.result=result;},
        err=>{task.status=controller.signal.aborted?'cancelled':'failed';task.error=String(err?.message||err);})
        .finally(()=>{
          task.finishedAt=Date.now();
          if(activeTask===task) activeTask=null;
          releaseAll();
          while(taskRecords.size>30)taskRecords.delete(taskRecords.keys().next().value);
        });
      return describeTask(task);
    },
    // Toggle-style shortcuts: start once, stop when the player requests it.
    startFollowing(playerId) {
      const current=activeTask;
      if(current?.status==='running' && current.type==='followPlayer' && current.playerId===Number(playerId))
        return describeTask(current);
      return api.startTask('followPlayer',{playerId});
    },
    stopFollowing() {
      const task=activeTask;
      if(!task || task.type!=='followPlayer' || task.status!=='running')
        return {status:'not_following'};
      return api.cancelTask(task.id);
    },
    getTask(id) { return describeTask(taskRecords.get(Number(id))); },
    getActiveTask() { return describeTask(activeTask); },
    cancelTask(id) {
      const task=taskRecords.get(Number(id));
      if(!task)return {status:'not_found'};
      if(task.status==='running') task.controller.abort();
      return describeTask(task);
    },
    getSnapshot(radius=25,limit=18,afterChatId=0) {
      const lastTask=taskRecords.get(taskCounter);
      return {...api.observe(radius,limit),
        chat:api.chat(30).filter(m=>m.id>afterChatId),
        activeTask:api.getActiveTask(),lastTask:describeTask(lastTask),
        wood:ctx.wood,cuts:ctx.cuts,online:ctx.isOnline()};
    },
    // Tiny incremental feed for frequent MCP polling. Full observation is only
    // needed when choosing a new action or diagnosing a problem.
    getBrief(afterChatId=0,afterEventId=0,afterTaskId=0) {
      const chatCursor=Math.max(0,Number(afterChatId)||0);
      const eventCursor=Math.max(0,Number(afterEventId)||0);
      const taskCursor=Math.max(0,Number(afterTaskId)||0);
      // Return oldest unread items first so the caller can safely advance cursors.
      const chat=ctx.chatHistory.filter(m=>m.id>chatCursor).slice(0,20)
        .map(m=>({id:m.id,from:m.from,name:m.name,text:m.text}));
      const recentEvents=events.filter(e=>e.id>eventCursor).slice(0,20)
        .map(({id,type,...details})=>({id,type,...details}));
      const compactTask=task=>task?{
        id:task.id,type:task.type,status:task.status,
        ...(task.progress?{progress:task.progress}:{}),
        ...(task.status!=='running'?{
          outcome:task.result?.status??(task.status==='failed'?task.error:null)
        }:{}),
      }:null;
      const last=taskRecords.get(taskCounter);
      return {
        chat,chatId:chat.at(-1)?.id??chatCursor,
        events:recentEvents,eventId:recentEvents.at(-1)?.id??eventCursor,
        active:compactTask(activeTask),
        ...(last&&last.id>taskCursor&&last.status!=='running'?{last:compactTask(last)}:{}),
        position:[round(ctx.px),round(ctx.pz)],wood:ctx.wood,cuts:ctx.cuts,online:ctx.isOnline(),
      };
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
    help: 'startFollowing(playerId), stopFollowing(), startTask(type,params), getTask(id), cancelTask(id), getActiveTask(), getSnapshot(radius,limit,afterChatId), getBrief(afterChatId,afterEventId,afterTaskId), chat(limit), say(text), tasks(limit), observe(radius,limit), lookAt(x,z), navigateTo(x,z,options), chopTree(id), events(since), move(direction,ms,sprint), hold(code,ms), jump(), chop(), state()'
  };
  window.__gameDebug = api;
  window.addEventListener('blur', releaseAll);
  window.addEventListener('pagehide', cancelActive);
  console.info('Forest Chopper debug controls ready:', api.help);
}
