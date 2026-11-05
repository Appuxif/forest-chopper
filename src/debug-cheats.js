import {createDebugMobSpawner} from './debug-mob-spawn.js';
import {ITEM_STACK,AXE_STATS} from './inventory.js';
import {itemDisplayName,itemDisplayIcon} from './item-display.js';
import {createDebugPlayers,MAX_DEBUG_PLAYERS} from './debug-players.js?v=20261103-debug-player1';

export function safeTeleportPoint(ctx,x,z,{step=1,maxRadius=40}={}){
 if(!Number.isFinite(x)||!Number.isFinite(z)||Math.abs(x)>200000||Math.abs(z)>200000)return null;
 const safe=(tx,tz)=>{
  const y=ctx.terrain.heightAt(tx,tz);
  if(!Number.isFinite(y)||ctx.terrain.waterDepthAt(tx,tz)>.12)return null;
  const offsets=[[0,0],[.5,0],[-.5,0],[0,.5],[0,-.5]];
  if(offsets.some(([dx,dz])=>ctx.blocksPlayerAt(tx+dx,tz+dz,y,{includeTrees:true})))return null;
  return {x:tx,y,z:tz};
 };
 const direct=safe(x,z);if(direct)return direct;
 for(let radius=step;radius<=maxRadius;radius+=step){
  const n=Math.max(12,Math.ceil(2*Math.PI*radius/step));
  for(let i=0;i<n;i++){
   const a=i*2*Math.PI/n,point=safe(x+Math.cos(a)*radius,z+Math.sin(a)*radius);
   if(point)return point;
  }
 }
 return null;
}

export function installDebugCheats(ctx){
 const state={hunger:false,immortal:false,stamina:false,flying:false,freezeTime:false,timeOverride:false,mobileUp:false,mobileDown:false};
 let downButton=null;
 function updateFlightButtons(){if(downButton)downButton.hidden=!state.flying||ctx.isOnline();}
 ctx.debugCheats=state;
 const debugPlayers=createDebugPlayers(ctx,{findSafePoint:safeTeleportPoint});
 ctx.debugPlayers=debugPlayers;
 const onlyOffline=()=>{if(ctx.isOnline())throw Error('Читы недоступны в сетевой игре');};
 function reset(){
  ctx.dayCycle.setFrozen(false);
  ctx.dayCycle.setDebugOverride(false);
  for(const key of Object.keys(state))state[key]=false;
  ctx.verticalSpeed=0;updateFlightButtons();
 }
 const spawnMob=createDebugMobSpawner(ctx,{findSafePoint:safeTeleportPoint});
 const cheats={
  state,
  tick(){
   if(ctx.isOnline()){if(Object.values(state).some(Boolean))reset();return;}
   if(ctx.deathSystem?.active)return;
   if(state.hunger||state.immortal||state.stamina){
    const v=ctx.vitals.serialize();
    if((state.hunger&&v.hunger!==5)||(state.immortal&&v.health!==5)||(state.stamina&&(v.stamina!==5||v.staminaLocked))){
     ctx.vitals.restore({...v,health:state.immortal?5:v.health,hunger:state.hunger?5:v.hunger,
      stamina:state.stamina?5:v.stamina,staminaLocked:state.stamina?false:v.staminaLocked,
      hungerProgress:state.hunger?0:v.hungerProgress,starvationProgress:state.hunger?0:v.starvationProgress});
     ctx.vitals.render();
    }
   }
  },
  toggle(key,enabled){
   onlyOffline();
   if(!['hunger','immortal','stamina','flying','freezeTime'].includes(key))throw Error('Неизвестный чит');
   if(key==='freezeTime'){
    if(!ctx.dayCycle.setFrozen(!!enabled))throw Error('Нельзя заморозить сетевое время');
    state.freezeTime=!!enabled;
    ctx.dayCycle.setDebugOverride(state.freezeTime||state.timeOverride);
    ctx.dayCycle.tick(performance.now());
    return state.freezeTime;
   }
   state[key]=!!enabled;
   if(key==='flying'){
    state.mobileUp=false;state.mobileDown=false;updateFlightButtons();
    ctx.verticalSpeed=0;ctx.jumpRequested=false;
    if(enabled){ctx.onGround=false;ctx.feetY=Math.max(ctx.feetY,ctx.terrain.heightAt(ctx.px,ctx.pz)+2);}
    else ctx.onGround=false;
   }
   cheats.tick();return state[key];
  },
  teleport(x,z){
   onlyOffline();
   const point=safeTeleportPoint(ctx,Number(x),Number(z));
   if(!point)throw Error('Безопасная точка не найдена в радиусе 40 м');
   ctx.px=point.x;ctx.pz=point.z;ctx.feetY=state.flying?point.y+2:point.y;
   ctx.onGround=!state.flying;ctx.verticalSpeed=0;ctx.jumpRequested=false;
   ctx.updateChunks();ctx.offlineSave?.markDirty?.();
   return point;
  },
  grant(id,count=1,tier=0){
   onlyOffline();
   if(!Object.hasOwn(ITEM_STACK,id))throw Error('Неизвестный предмет');
   count=Number(count);tier=Number(tier);
   if(!Number.isInteger(count)||count<1||count>100)throw Error('Количество должно быть от 1 до 100');
   if(id==='axe'&&(!Number.isInteger(tier)||tier<0||tier>=AXE_STATS.length))throw Error('Неверный уровень топора');
   const inventory=ctx.inventory.state;
   let added=0;
   for(let i=0;i<count;i++){
    if(!inventory.addItem(id==='axe'?{id,tier}:{id,count:1}))break;
    added++;
   }
   ctx.inventory.render();ctx.offlineSave?.markDirty?.();
   if(!added)throw Error('Не хватает слотов или грузоподъёмности');
   return added;
  },
  time(hour){
   onlyOffline();
   hour=Number(hour);
   if(!Number.isInteger(hour)||hour<0||hour>15)throw Error('Час должен быть от 0 до 15');
   if(!ctx.dayCycle.setOfflinePhase(hour/16))throw Error('Ошибка установки времени');
   state.timeOverride=ctx.dayCycle.setDebugOverride(true);
   ctx.dayCycle.tick(performance.now());ctx.offlineSave?.markDirty?.();
   return hour;
  },
  spawnMob(type,options){onlyOffline();return spawnMob(type,options);},
  clearMobs(){onlyOffline();return ctx.mobs.clearDebug();},
  spawnPlayer(count=1){onlyOffline();return debugPlayers.spawn(count);},
  followPlayer(id,enabled=true){onlyOffline();return debugPlayers.follow(id,enabled);},
  damagePlayer(id,amount=1){onlyOffline();return debugPlayers.damage(id,amount);},
  respawnPlayer(id){onlyOffline();return debugPlayers.respawn(id);},
  removePlayer(id){onlyOffline();return debugPlayers.remove(id);},
  clearPlayers(){onlyOffline();debugPlayers.clear();return true;},
  get players(){return debugPlayers.list();},
  reset
 };
 ctx.debugCheatsController=cheats;
 const style=document.createElement('style');
 style.textContent=`
 #fc-cheats{position:fixed;top:52px;right:12px;z-index:1200;display:flex;flex-direction:column;width:min(350px,calc(100vw - 24px));max-height:calc(100dvh - 65px);overflow:hidden;background:#13221ff5;color:#eff4ee;border:1px solid #637965;border-radius:12px;box-shadow:0 12px 40px #0008;padding:14px;font:13px system-ui}
 #fc-cheats[hidden]{display:none!important}
 #fc-cheats .cheats-header{display:flex;flex-shrink:0;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
 #fc-cheats .cheats-body{min-height:0;overflow-y:auto;overscroll-behavior:contain}
 #fc-cheats h3{margin:0;font-size:17px}#fc-cheats section{border-top:1px solid #455448;padding:10px 0;display:grid;gap:7px}
 #fc-cheats #fc-cheats-close{flex-shrink:0;min-width:96px;min-height:44px;font-size:14px;font-weight:700;white-space:nowrap}
 #fc-cheats label{display:flex;align-items:center;gap:8px}#fc-cheats input:not([type=checkbox]):not([type=range]){width:100%;min-width:0;box-sizing:border-box;background:#192e28;color:white;border:1px solid #637965;border-radius:6px;padding:7px}
 #fc-cheats button,#fc-cheats-toggle{background:#345741;color:#fff;border:1px solid #76977c;border-radius:7px;padding:6px 9px;cursor:pointer;font:13px system-ui}
 #fc-cheats .fields{display:flex;gap:6px}#fc-cheats .fields>*{min-width:0;flex:1}
 #fc-cheats .catalog{max-height:205px;overflow-y:auto;display:grid;gap:3px}
 #fc-cheats .catalog button{text-align:left;background:#20372b}
 #fc-cheats .catalog button.chosen{background:#477650}
 #fc-cheats .note{font-size:11px;color:#bed0bd}
 #fc-cheats-toggle{position:fixed;right:12px;top:12px;z-index:1201}
 #fc-fly-down{position:fixed;z-index:15;right:120px;bottom:128px;width:62px;height:62px;border-radius:50%;font-size:29px;background:#274a66e8;border:1px solid #9cc8e3;touch-action:none;user-select:none}
 #fc-fly-down[hidden]{display:none!important}
 @media(pointer:fine){#fc-fly-down{display:none!important}}
 `;
 document.head.append(style);
 const toggle=document.createElement('button');
 toggle.id='fc-cheats-toggle';toggle.textContent='🎮 Читы';
 const panel=document.createElement('aside');panel.id='fc-cheats';panel.hidden=true;
 panel.innerHTML=`<div class="cheats-header"><h3>🎮 Читы · одиночная игра</h3><button id="fc-cheats-close" type="button" aria-label="Закрыть окно читов" title="Закрыть">Закрыть ×</button></div>
 <div class="cheats-body">
 <section id="fc-cheat-flags"></section>
 <section><b>📍 Безопасный телепорт</b><div class="fields"><input id="fc-tpx" type="number" step="1" placeholder="X"><input id="fc-tpz" type="number" step="1" placeholder="Z"><button id="fc-tp">Перейти</button></div><span class="note">Проверка деревьев, построек, предметов и воды; поиск рядом с точкой.</span></section>
 <section><b>🎒 Каталог предметов</b><input id="fc-search" placeholder="Поиск по названию или ID"><div id="fc-catalog" class="catalog"></div><span id="fc-choice" class="note">Выбери предмет</span><div class="fields"><input id="fc-count" type="number" min="1" max="100" value="1"><select id="fc-tier"><option value="0">Топор 1</option><option value="1">Топор 2</option><option value="2">Топор 3</option><option value="3">Топор 4</option></select><button id="fc-add">Добавить</button></div></section>
 <section><b>🐔 Тестовые мобы · Курица</b><span class="note">Перед игроком, только offline. До 8 тестовых мобов, без сохранения.</span>
 <div class="fields"><select id="fc-mob-color"><option value="">Случайный окрас</option></select><input id="fc-mob-count" type="number" min="1" max="8" step="1" value="1"></div>
 <div class="fields"><button id="fc-mob-spawn">Создать курицу</button><button id="fc-mob-clear">Удалить тестовых мобов</button></div></section>
 <section><b>👤 Тестовые игроки</b><span class="note">Создаются той же моделью, что и участники сети. Имеют отдельные здоровье, голод, выносливость, инвентарь и ragdoll. Не сохраняются в мире и не подключаются к серверу.</span>
 <div class="fields"><input id="fc-player-count" type="number" min="1" max="8" step="1" value="1"><button id="fc-player-spawn">Создать игрока</button></div>
 <label>Выбранный игрок<select id="fc-player-select" aria-label="Тестовый игрок"></select></label>
 <div class="fields"><button id="fc-player-follow">Следовать</button><button id="fc-player-stop">Стоять</button><button id="fc-player-hit">Урон −1</button></div>
 <div class="fields"><button id="fc-player-kill">Убить</button><button id="fc-player-respawn">Возродить</button><button id="fc-player-remove">Удалить</button></div>
 <button id="fc-player-clear">Удалить всех тестовых игроков</button>
 <span id="fc-player-status" class="note" aria-live="polite">Игроков нет (максимум 8).</span></section>
 <section><b>🌗 Время дня <output id="fc-time-label">0</output>/15</b><input id="fc-time" type="range" min="0" max="15" step="1" value="0"><button id="fc-settime">Установить</button><span class="note">0 — начало суток, 8 — середина ночи; цикл 16 минут.</span></section>
 <div id="fc-cheat-msg" role="status" class="note"></div></div>`;
 downButton=document.createElement('button');
 downButton.id='fc-fly-down';downButton.type='button';downButton.textContent='⬇';
 downButton.setAttribute('aria-label','Спуститься в режиме полёта');
 downButton.hidden=true;
 const downwardPointers=new Set();
 downButton.addEventListener('pointerdown',e=>{
  if(!state.flying||ctx.isOnline())return;
  e.preventDefault();downwardPointers.add(e.pointerId);state.mobileDown=true;
  downButton.setPointerCapture?.(e.pointerId);
 });
 for(const type of ['pointerup','pointercancel','lostpointercapture'])
  downButton.addEventListener(type,e=>{
   downwardPointers.delete(e.pointerId);
   state.mobileDown=downwardPointers.size>0&&state.flying;
  });
 window.addEventListener('blur',()=>{downwardPointers.clear();state.mobileDown=false;});
 document.body.append(toggle,panel,downButton);
 toggle.onclick=()=>{panel.hidden=!panel.hidden;};
 const $=id=>panel.querySelector('#'+id);
 $('fc-cheats-close').onclick=()=>{panel.hidden=true;toggle.focus({preventScroll:true});};
 const notice=(message,error=false)=>{const node=$('fc-cheat-msg');node.textContent=message;node.style.color=error?'#ff9c8c':'#c7e8b5';};
 const perform=fn=>{try{notice(String(fn()));}catch(e){notice(e.message,true);}};
 const flags=$('fc-cheat-flags');
 for(const [key,label] of [['hunger','Отключить голод'],['immortal','Бессмертие'],['stamina','Бесконечная выносливость'],['flying','Полёт по взгляду (WASD, Space/Shift ↑, Ctrl ↓)'],['freezeTime','⏸ Заморозить время суток']]){
  const line=document.createElement('label'),checkbox=document.createElement('input');
  checkbox.type='checkbox';line.append(checkbox,document.createTextNode(label));flags.append(line);
  checkbox.onchange=()=>{try{cheats.toggle(key,checkbox.checked);notice(label);}catch(e){checkbox.checked=false;notice(e.message,true);}};
 }
 $('fc-tp').onclick=()=>perform(()=>{const p=cheats.teleport($('fc-tpx').value,$('fc-tpz').value);return 'Телепорт: '+p.x.toFixed(1)+', '+p.z.toFixed(1);});
 const catalog=$('fc-catalog');
 let selected='log';
 const items=Object.keys(ITEM_STACK).sort((a,b)=>itemDisplayName(a).localeCompare(itemDisplayName(b),'ru'));
 function renderCatalog(){
  const search=$('fc-search').value.trim().toLowerCase();catalog.replaceChildren();
  for(const id of items){
   const name=itemDisplayName(id);
   if(!name.toLowerCase().includes(search)&&!id.toLowerCase().includes(search))continue;
   const btn=document.createElement('button');btn.type='button';btn.textContent=itemDisplayIcon(id)+' '+name+' · '+id;
   if(selected===id)btn.className='chosen';
   btn.onclick=()=>{selected=id;$('fc-choice').textContent='Выбран: '+name; $('fc-tier').hidden=id!=='axe';renderCatalog();};
   catalog.append(btn);
  }
 }
 $('fc-search').oninput=renderCatalog;
 $('fc-choice').textContent='Выбран: '+itemDisplayName(selected);
 $('fc-tier').hidden=true;renderCatalog();
 $('fc-add').onclick=()=>perform(()=>{const n=cheats.grant(selected,$('fc-count').value,$('fc-tier').value);return 'Добавлено: '+n+' × '+itemDisplayName(selected);});
 const colors=ctx.mobs?.registry.get('chicken')?.subcategories??{};
 for(const [id,variant] of Object.entries(colors)){
  const option=document.createElement('option');option.value=id;option.textContent=variant.name??id;$('fc-mob-color').append(option);
 }
 $('fc-mob-spawn').onclick=()=>perform(()=>{
  const created=cheats.spawnMob('chicken',{count:$('fc-mob-count').value,subcategory:$('fc-mob-color').value||undefined});
  return 'Куриц создано: '+created.length;
 });
 $('fc-mob-clear').onclick=()=>perform(()=>'Удалено: '+cheats.clearMobs());
 const playerSelect=$('fc-player-select');
 function updateDebugPlayers(preferred=null){
  const players=debugPlayers.list();
  const selected=preferred??Number(playerSelect.value);
  playerSelect.replaceChildren();
  for(const player of players){
   const option=document.createElement('option');
   option.value=String(player.id);
   option.textContent=player.name+(player.dead?' 💀':player.following?' 🚶':'');
   playerSelect.append(option);
  }
  if(players.some(p=>p.id===selected))playerSelect.value=String(selected);
  const current=players.find(p=>p.id===Number(playerSelect.value));
  $('fc-player-status').textContent=current
   ?current.name+' · HP '+current.health+'/5, голод '+current.hunger+'/5, силы '+current.stamina.toFixed(1)+'/5 · '+(current.dead?'мёртв':current.following?'следует за вами':'стоит')
   :'Игроков нет (максимум '+MAX_DEBUG_PLAYERS+').';
 }
 playerSelect.onchange=()=>updateDebugPlayers();
 const action=fn=>perform(()=>{
  const state=fn();
  updateDebugPlayers(state?.id??null);
  return typeof state==='string'?state:state?.name??'Готово';
 });
 const chosen=()=>Number(playerSelect.value);
 $('fc-player-spawn').onclick=()=>action(()=>{
  const created=cheats.spawnPlayer($('fc-player-count').value);
  updateDebugPlayers(created.at(-1)?.id);
  return 'Создано: '+created.length+'; всего: '+debugPlayers.size;
 });
 $('fc-player-follow').onclick=()=>action(()=>cheats.followPlayer(chosen(),true));
 $('fc-player-stop').onclick=()=>action(()=>cheats.followPlayer(chosen(),false));
 $('fc-player-hit').onclick=()=>action(()=>cheats.damagePlayer(chosen(),1));
 $('fc-player-kill').onclick=()=>action(()=>cheats.damagePlayer(chosen(),5));
 $('fc-player-respawn').onclick=()=>action(()=>cheats.respawnPlayer(chosen()));
 $('fc-player-remove').onclick=()=>action(()=>{cheats.removePlayer(chosen());return 'Тестовый игрок удалён';});
 $('fc-player-clear').onclick=()=>action(()=>{cheats.clearPlayers();return 'Все тестовые игроки удалены';});
 updateDebugPlayers();
 $('fc-time').oninput=()=>$('fc-time-label').textContent=$('fc-time').value;
 $('fc-settime').onclick=()=>perform(()=>{cheats.time($('fc-time').value);return 'Время установлено: '+$('fc-time').value+'/15';});
 const timer=setInterval(()=>{
  const online=ctx.isOnline();
  toggle.hidden=online;panel.hidden=online||panel.hidden;updateFlightButtons();
  if(!panel.hidden)updateDebugPlayers();
  if(online){
   if(Object.values(state).some(Boolean))reset();
   for(const box of flags.querySelectorAll('input'))box.checked=false;
  }
 },250);
 window.addEventListener('pagehide',()=>{clearInterval(timer);debugPlayers.clear();});
 return cheats;
}
