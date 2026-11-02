import {createSettings} from './settings.js?v=20261102-jump-voices1';
import {
  MENU_NAME_KEY,MENU_LAUNCH_KEY,MAX_SEED,parseSeed,readLocalWorld,
  formatSavedWorld,normalizeServerAddress,serverStatusAddress,parseLaunchQuery,
  parseServerStatus,formatWorldAge,recentServers,rememberServer,
  favoriteServers,toggleFavoriteServer,
} from './main-menu-state.js?v=20261102-url-launch1';

const $=id=>document.getElementById(id);
const storage=(()=>{try{return localStorage;}catch{return null;}})();
const launchStorage=(()=>{try{return sessionStorage;}catch{return null;}})();
const game=$('game'),menu=$('mainmenu'),home=$('menu-home'),
  newPanel=$('menu-new-panel'),onlinePanel=$('menu-online-panel'),helpPanel=$('menu-help-panel');
let launching=false,checking=null;
let menuSettings=null;

function feedback(message='',kind=''){
  const node=$('menu-server-feedback');
  node.textContent=message;node.className='menu-feedback'+(kind?' '+kind:'');
}
function view(name='home'){
  if(checking){checking.cancel();checking=null;}
  home.hidden=name!=='home';
  newPanel.hidden=name!=='new';
  onlinePanel.hidden=name!=='online';
  helpPanel.hidden=name!=='help';
  if(name==='home'){
    const saved=readLocalWorld(storage);
    $('menu-continue').disabled=!saved;
    $('menu-save-details').textContent=saved?formatSavedWorld(saved):'Нет локального сохранения';
  }
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
  const current=readLocalWorld(storage);
  if(options.mode==='new'&&current&&!force&&!confirm('Создать новый лес? Текущее сохранение будет заменено. Общие достижения и настройки останутся.')){
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
    await import('./main.js?v=20261102-prestage-logs1');
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
$('menu-continue').onclick=()=>{
  if(readLocalWorld(storage))launch({mode:'continue'});
  else view('home');
};
$('menu-new').onclick=()=>{view('new');$('menu-seed').value=String(randomSeed());};
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
  if(query.type==='continue')$('menu-continue').click();
  else if(query.type==='new'){
    $('menu-new').click();
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
