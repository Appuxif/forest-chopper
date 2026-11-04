import {parseOfflineSave,slotKey} from './offline-save.js';
import {exportSlots,parseSlotArchive,importSlots,deleteSlot} from './save-slots.js?v=20261104-local-game3';
import {createSettings} from './settings.js?v=20261103-grass-presets-tuned1';
import {
  MENU_NAME_KEY,MENU_LAUNCH_KEY,MAX_SEED,parseSeed,listSavedSlots,
  normalizeServerAddress,serverStatusAddress,parseLaunchQuery,
  parseServerStatus,formatWorldAge,recentServers,rememberServer,
  favoriteServers,toggleFavoriteServer,
} from './main-menu-state.js?v=20261104-save-list2';

const $=id=>document.getElementById(id);
const storage=(()=>{try{return localStorage;}catch{return null;}})();
const launchStorage=(()=>{try{return sessionStorage;}catch{return null;}})();
const game=$('game'),menu=$('mainmenu'),home=$('menu-home'),
  newPanel=$('menu-new-panel'),savesPanel=$('menu-saves-panel'),onlinePanel=$('menu-online-panel'),helpPanel=$('menu-help-panel');
let launching=false,checking=null;
let menuSettings=null;
let selectedSlot=1;
function rawSlot(n){try{return storage?.getItem(slotKey(n));}catch{return null;}}
function refreshSlots(){
  const slots=listSavedSlots(storage);
  $('slots-export').disabled=!slots.some(item=>item.save);
  const list=$('menu-save-list');list.replaceChildren();
  for(const {slot,save,metadata} of slots){
    const item=document.createElement('li');item.className='save-slot'+(save?'':' save-slot-empty');
    const number=document.createElement('span');number.className='save-slot-number';number.textContent=String(slot).padStart(2,'0');
    if(save){
      const button=document.createElement('button');button.type='button';button.className='save-slot-button';
      const content=document.createElement('span');content.className='save-slot-content';
      const title=document.createElement('strong');title.textContent=`Seed ${save.seed}`;
      const stats=document.createElement('span');stats.className='save-slot-stats';
      stats.textContent=`🌲 ${save.cuts} деревьев · 🪵 ${save.logsCollected} брёвен`;
      const detail=document.createElement('span');detail.className='save-slot-detail';
      const date=value=>value?new Date(value).toLocaleString():'неизвестно';
      detail.textContent=`Создано: ${date(metadata.createdAt)} · Сохранено: ${date(metadata.savedAt)} · Координаты: ${[save.position.x,save.position.y,save.position.z].map(v=>v.toFixed(1)).join(', ')}`;
      content.append(title,stats,detail);button.append(number,content);
      button.onclick=()=>{selectedSlot=slot;launch({mode:'continue'});};
      const remove=document.createElement('button');remove.type='button';remove.className='save-slot-delete';
      remove.textContent='🗑';remove.setAttribute('aria-label',`Удалить сохранение из слота ${slot}`);
      remove.title='Удалить сохранение';
      remove.onclick=()=>{
        if(!confirm(`Вы уверены? Удалить сохранение из слота ${slot}?`))return;
        try{deleteSlot(storage,slot);refreshSlots();}
        catch(error){alert('Не удалось удалить сохранение: '+error.message);}
      };
      item.append(button,remove);
    }else{
      const button=document.createElement('button');button.type='button';button.className='save-slot-button';
      button.setAttribute('aria-label',`Начать новую игру в слоте ${slot}`);
      const label=document.createElement('span');label.className='save-slot-empty-label';label.textContent='Начать новую игру';
      const plus=document.createElement('span');plus.className='save-slot-plus';plus.textContent='+';plus.setAttribute('aria-hidden','true');
      button.append(number,label,plus);
      button.onclick=()=>openNewWorld(slot);item.append(button);
    }
    list.append(item);
  }
}
const importPanel=document.createElement('section');
importPanel.className='menu-card menu-section'; importPanel.hidden=true;
importPanel.innerHTML='<h2>Импорт сохранений</h2><p>Выберите слоты из файла. Занятые слоты с теми же номерами будут заменены.</p><div id="import-slots"></div><p class="menu-feedback" id="import-feedback" role="status"></p><div class="menu-actions"><button type="button" class="menu-btn secondary" id="import-all">Выбрать все</button><button type="button" class="menu-btn ghost" id="import-cancel">Отмена</button><button type="button" class="menu-btn primary" id="import-apply">Импортировать</button></div>';
home.after(importPanel);
let pendingImport=[];
$('slots-export').onclick=()=>{
  try {
    const archive=exportSlots(storage);
    if(!archive.slots.length){alert('Нет сохранений для экспорта');return;}
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(archive,null,2)],{type:'application/json'}));
    a.download='forest-chopper-saves.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }catch(error){alert('Ошибка экспорта: '+error.message);}
};
$('slots-import').onclick=()=>$('slots-file').click();
$('slots-file').onchange=async event=>{
  try {
    const file=event.target.files[0];if(!file)return;
    if(file.size>40_000_000)throw Error('Файл слишком большой');
    pendingImport=parseSlotArchive(await file.text());
    if(!pendingImport.length)throw Error('В файле нет сохранений');
    const root=$('import-slots');root.replaceChildren();
    for(const entry of pendingImport){
      const label=document.createElement('label');label.className='menu-import-slot';
      const input=document.createElement('input');input.type='checkbox';input.value=entry.slot;input.checked=true;
      const text=document.createElement('span');text.textContent=`Слот ${entry.slot} · seed ${entry.save.seed}${rawSlot(entry.slot)?' · будет заменён':''}`;
      label.append(input,text);root.append(label);
    }
    $('import-feedback').textContent='';view('import');
  }catch(error){alert('Ошибка импорта: '+error.message);}finally{event.target.value='';}
};
$('import-all').onclick=()=>{for(const input of $('import-slots').querySelectorAll('input'))input.checked=true;};
$('import-cancel').onclick=()=>view('saves');
$('import-apply').onclick=()=>{
  const chosen=new Set([...$('import-slots').querySelectorAll('input:checked')].map(input=>Number(input.value)));
  const entries=pendingImport.filter(entry=>chosen.has(entry.slot));
  if(!entries.length){$('import-feedback').textContent='Выберите хотя бы один слот';return;}
  if(entries.some(entry=>rawSlot(entry.slot))&&!confirm('Заменить существующие выбранные слоты?'))return;
  try {importSlots(storage,entries);view('saves');}catch(error){$('import-feedback').textContent='Ошибка записи: '+error.message;}
};

function feedback(message='',kind=''){
  const node=$('menu-server-feedback');
  node.textContent=message;node.className='menu-feedback'+(kind?' '+kind:'');
}
function view(name='home'){
  if(checking){checking.cancel();checking=null;}
  home.hidden=name!=='home';
  newPanel.hidden=name!=='new';
  savesPanel.hidden=name!=='saves';
  onlinePanel.hidden=name!=='online';
  helpPanel.hidden=name!=='help';
  importPanel.hidden=name!=='import';
  if(name==='home'||name==='saves'||name==='new')refreshSlots();
}
function randomSeed(){
  const values=new Uint32Array(1);
  if(globalThis.crypto?.getRandomValues)crypto.getRandomValues(values);
  else values[0]=Math.floor(Math.random()*2**32);
  return values[0]%(MAX_SEED+1);
}
function updateRecents(){
  const root=$('menu-recent-servers');root.replaceChildren();
  const favorites=favoriteServers(storage);
  const items=[...new Set([...favorites,...recentServers(storage)])];
  for(const address of items){
    const group=document.createElement('div');group.className='menu-chip-group';
    const chip=document.createElement('button');
    chip.type='button';chip.className='menu-chip';chip.textContent=address;
    chip.onclick=()=>{$('menu-server').value=address;updateStatus(null);};
    const star=document.createElement('button');star.type='button';
    star.className='menu-chip menu-star';
    star.textContent=favorites.includes(address)?'★':'☆';
    star.title=favorites.includes(address)?'Убрать из избранного':'В избранное';
    star.setAttribute('aria-label',star.title);
    star.onclick=()=>{toggleFavoriteServer(storage,address);updateRecents();};
    group.append(chip,star);root.append(group);
  }
}
function updateStatus(data){
  const container=$('menu-server-info');
  container.hidden=!data;
  container.replaceChildren();
  if(!data)return;
  const header=document.createElement('strong');header.textContent=data.name;
  const grid=document.createElement('div');grid.className='menu-server-data';
  const values=[
    ['Игроки',data.online+' / '+data.maxPlayers],
    ['Возраст мира',formatWorldAge(Date.now()/1000-data.createdAt)],
    ['Seed',String(data.seed)],
    ['Время суток',Math.floor((data.dayPhase%1)*24).toString().padStart(2,'0')+':'+
      Math.floor((data.dayPhase*24%1)*60).toString().padStart(2,'0')],
  ];
  for(const [label,value] of values){
    const item=document.createElement('div'),caption=document.createElement('span'),
      title=document.createElement('strong');
    caption.textContent=label;title.textContent=value;
    item.append(caption,title);grid.append(item);
  }
  container.append(header,grid);
}
export function probeServer(address,{timeout=3500,Socket=WebSocket}={}){
  const endpoint=serverStatusAddress(address);
  let socket,timer,done=false;
  const promise=new Promise((resolve,reject)=>{
    try{socket=new Socket(endpoint);}
    catch(error){reject(error);return;}
    const finish=(error,result)=>{
      if(done)return;
      done=true;clearTimeout(timer);
      socket.onmessage=socket.onerror=socket.onclose=null;
      try{socket.close();}catch{}
      if(error)reject(error);else resolve(result);
    };
    timer=setTimeout(()=>finish(new Error('Сервер не отвечает')),timeout);
    socket.onmessage=event=>{
      let data;
      try{data=parseServerStatus(JSON.parse(event.data));}catch{}
      finish(data?null:new Error('Сервер не поддерживает запрос статуса'),data);
    };
    socket.onerror=()=>finish(new Error('Не удалось подключиться к серверу'));
    socket.onclose=()=>finish(new Error('Сервер закрыл соединение'));
  });
  return {promise,cancel:()=>{if(!done){done=true;clearTimeout(timer);try{socket?.close();}catch{}}}};
}
async function checkServer(){
  if(checking){checking.cancel();checking=null;}
  const address=normalizeServerAddress($('menu-server').value);
  if(!address){feedback('Введите корректный ws:// или wss:// адрес','error');return;}
  $('menu-server').value=address;
  updateStatus(null);feedback('Проверяем доступность…');
  const started=performance.now();
  const probe=probeServer(address);checking=probe;
  try{
    const data=await probe.promise;
    if(checking!==probe)return;
    updateStatus(data);
    feedback('Сервер доступен · '+Math.round(performance.now()-started)+' мс','success');
    rememberServer(storage,address);updateRecents();
  }catch(error){
    if(checking!==probe)return;
    feedback(error.message+' · можно попробовать подключиться напрямую','error');
  }finally{if(checking===probe)checking=null;}
}
async function launch(options,{force=false,auto=false}={}){
  if(launching)return;
  launching=true;
  if(checking){checking.cancel();checking=null;}
  options.slot=selectedSlot;
  if(options.mode==='new'&&rawSlot(options.slot)&&!force&&!confirm('Создать новый лес? Текущее сохранение будет заменено. Общие достижения и настройки останутся.')){
    launching=false;
    if(auto)location.replace(location.pathname+location.hash);
    return;
  }
  // Same-document dynamic import does not require browser storage. Session
  // storage is a harmless fallback for tools that load main.js directly.
  globalThis.__forestLaunch=options;
  try{launchStorage?.setItem(MENU_LAUNCH_KEY,JSON.stringify(options));}
  catch{}
  // No Three.js or Worker initialization has occurred before this point.
  menuSettings?.destroy();
  menuSettings=null;
  // Apply before revealing #game: no frame should show a partially built HUD.
  document.body.classList.add('fc-world-loading');
  menu.hidden=true;game.hidden=false;
  try{
    await import('./main.js?v=20261104-save-slots1');
  }catch(error){
    console.error('Forest Chopper startup failed',error);
    delete globalThis.__forestLaunch;
    try{launchStorage?.removeItem(MENU_LAUNCH_KEY);}catch{}
    document.body.classList.remove('fc-world-loading');
    game.hidden=true;menu.hidden=false;
    if($('load'))$('load').textContent='Загрузка игры…';
    feedback('Не удалось запустить игру: '+error.message,'error');
    view(options.mode==='online'?'online':'home');
    launching=false;
  }
}
$('menu-saves').onclick=()=>view('saves');
function openNewWorld(slot){
  selectedSlot=slot;
  $('menu-new-slot').textContent=`Слот ${slot}`;
  view('new');$('menu-seed').value=String(randomSeed());
}
$('menu-new-back').onclick=()=>view('saves');
$('menu-online').onclick=()=>{view('online');updateRecents();};
$('menu-help').onclick=()=>view('help');
for(const button of document.querySelectorAll('.menu-back'))button.onclick=()=>view();
$('menu-random-seed').onclick=()=>{$('menu-seed').value=String(randomSeed());};
function createNewWorld({force=false,auto=false}={}){
  const seed=parseSeed($('menu-seed').value);
  if(seed===null){$('menu-seed').setCustomValidity('Seed должен быть целым числом от 0 до '+MAX_SEED);$('menu-seed').reportValidity();return;}
  $('menu-seed').setCustomValidity('');
  launch({mode:'new',seed},{force,auto});
}
$('menu-create').onclick=()=>createNewWorld();
$('menu-seed').oninput=()=>$('menu-seed').setCustomValidity('');
$('menu-settings').onclick=()=>{
  if(!menuSettings){
    menuSettings=createSettings(document);
    menuSettings.setMenuMode(true);
  }
  menuSettings.open();
};
$('menu-fullscreen').onclick=()=>{
  if(document.fullscreenElement)document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
};
$('menu-check-server').onclick=checkServer;
$('menu-connection-mode').onchange=()=>{
  const direct=$('menu-connection-mode').value==='direct';
  $('menu-direct-controls').hidden=!direct;
  $('menu-p2p-controls').hidden=direct;
  $('menu-peer-room').closest('label')?.removeAttribute('hidden');
  $('menu-peer-room').disabled=$('menu-connection-mode').value==='host';
  updateStatus(null);feedback();
};
$('menu-peer-custom').onchange=()=>{
  $('menu-peer-config').hidden=!$('menu-peer-custom').checked;
};
$('menu-join').onclick=()=>{
  const name=$('menu-player-name').value.trim().slice(0,22)||'Лесоруб';
  const mode=$('menu-connection-mode').value;
  let address;
  if(mode==='direct'){
    address=normalizeServerAddress($('menu-server').value);
    if(!address){feedback('Введите корректный адрес сервера','error');return;}
  }else{
    address=normalizeServerAddress($('menu-peer-proxy').value);
    if(!address){feedback('Укажите WebSocket адрес сервера хоста','error');return;}
    if(mode==='guest'&&!$('menu-peer-room').value.trim()){
      feedback('Для подключения необходим ID P2P-комнаты','error');return;
    }
  }
  try{storage?.setItem(MENU_NAME_KEY,name);}catch{}
  if(mode==='direct')rememberServer(storage,address);
  launch({mode:'online',modeConnection:mode,address,name,
    peerRoom:$('menu-peer-room').value.trim(),
    peerCustom:$('menu-peer-custom').checked,
    peerHost:$('menu-peer-host').value.trim(),
    peerPort:$('menu-peer-port').value,
    peerPath:$('menu-peer-path').value,
    peerSecure:$('menu-peer-secure').checked,
  });
};
const savedName=(()=>{try{return storage?.getItem(MENU_NAME_KEY);}catch{return null;}})();
if(savedName)$('menu-player-name').value=savedName.slice(0,22);
$('menu-server').value=recentServers(storage)[0]??'ws://localhost:8765';
$('menu-seed').value=String(randomSeed());
view();

// Apply URL shortcuts after the normal menu listeners exist. The same menu
// actions validate seeds/servers and save player preferences as manual input.
function applyLaunchQuery(){
  const query=parseLaunchQuery(location.search);
  if(query.name!==null){
    $('menu-player-name').value=query.name;
    try{storage?.setItem(MENU_NAME_KEY,query.name);}catch{}
  }
  if(query.performance!==null||query.diag!==null){
    menuSettings??=createSettings(document);
    menuSettings.setMenuMode(true);
    if(query.performance!==null)menuSettings.setPerformancePreset(query.performance);
    if(query.diag!==null)menuSettings.setShowFps(query.diag);
  }
  if(query.type==='continue'){
    const first=listSavedSlots(storage).find(item=>item.save);
    if(first){selectedSlot=first.slot;launch({mode:'continue'});}
  }
  else if(query.type==='new'){
    openNewWorld(1);
    if(query.seedProvided)$('menu-seed').value=query.seed===null?'invalid':String(query.seed);
    createNewWorld({force:query.force,auto:true});
  }else if(query.type==='multiplayer'){
    $('menu-online').click();
    $('menu-connection-mode').value='direct';
    $('menu-connection-mode').onchange();
    if(query.server!==null)$('menu-server').value=query.server;
    $('menu-join').click();
  }
}
applyLaunchQuery();
