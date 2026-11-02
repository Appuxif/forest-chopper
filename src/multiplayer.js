import {logCenterY,applyLogRotation,validBuildLog} from './log-grid.js';
import {TREE_LOG_COUNT} from './ground-boxes.js';
import {createPeer, waitForPeer, bridgeGuest, peerSocket} from './peer-bridge.js';
// Extracted from the original single-file game. Shared game state is passed explicitly.
export function createMultiplayer(ctx) {
function isOnline(){return ctx.socket?.readyState===WebSocket.OPEN&&ctx.myId!==null}
function sendNet(data){if(isOnline())ctx.socket.send(JSON.stringify(data))}
let lastPingAt=0,pingCounter=0,pendingPing=null;
function updatePing(now){
 if(!isOnline())return;
 if(pendingPing&&now-pendingPing.at>12000){pendingPing=null;ctx.settings.setLatency(null)}
 if(pendingPing||now-lastPingAt<5000)return;
 lastPingAt=now;pendingPing={nonce:++pingCounter,at:now};
 sendNet({type:'ping',nonce:pendingPing.nonce});
}
let lastMapPingAt=-Infinity;
function sendMapPing(x,z){
 if(!isOnline() || !Number.isFinite(x) || !Number.isFinite(z) ||
    Math.hypot(x-ctx.px,z-ctx.pz)>55 ||
    performance.now()-lastMapPingAt<2100)return false;
 lastMapPingAt=performance.now();
 sendNet({type:'map_ping',x,z});
 return true;
}
let lastEmoteAt=-Infinity;
function sendEmote(kind){
 if(!isOnline() || !['wave','thumbs_up'].includes(kind) ||
    performance.now()-lastEmoteAt<1700)return false;
 lastEmoteAt=performance.now();
 sendNet({type:'emote',kind});
 return true;
}
const chatHistory=[];
function receiveChat(message) {
 if (!message || !Number.isInteger(message.id) || typeof message.text!=='string') return;
 if (chatHistory.some(x=>x.id===message.id)) return;
 chatHistory.push(message);if(chatHistory.length>120)chatHistory.shift();
 const log=ctx.$('chatmessages'),line=document.createElement('div');line.className='chatline';
 const name=document.createElement('span');name.className='chatname';name.textContent=(message.name||'Игрок')+': ';
 line.append(name,document.createTextNode(message.text));log.append(line);
 while(log.children.length>80)log.firstChild.remove();log.scrollTop=log.scrollHeight;
 if(ctx.$('chatpanel').classList.contains('collapsed'))ctx.$('chatunread').textContent='●';
}
function sendChat(text){
 if(typeof text!=='string'||!text.trim()||!isOnline())return false;
 sendNet({type:'chat',text:text.trim().slice(0,400)});return true;
}
ctx.$('chattoggle').onclick=()=>{const panel=ctx.$('chatpanel');panel.classList.toggle('collapsed');ctx.$('chatunread').textContent='';if(panel.classList.contains('collapsed'))ctx.$('chatinput').blur();};
ctx.$('chatinput').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();ctx.$('chatpanel').classList.add('collapsed');ctx.$('chatinput').blur();}});
ctx.$('chatform').onsubmit=e=>{e.preventDefault();if(sendChat(ctx.$('chatinput').value))ctx.$('chatinput').value='';};
function syncWood(w,c){ctx.wood=w;ctx.$('wood').textContent=ctx.wood;if(c!==undefined){ctx.cuts=c;ctx.$('cut').textContent=ctx.cuts}}
function clearWorld(){ctx.distantForest?.clear?.();ctx.waterSplashes?.clear?.();ctx.groundBoxes?.clear?.();ctx.forestResources?.clear?.();ctx.inventory?.clearWorld?.();ctx.highlight?.clear();ctx.wind?.clear();ctx.crafting?.clear();ctx.storages?.clear();ctx.campStructures?.clear();ctx.plantInteraction?.clear();ctx.rockColliders?.clear();for(const t of ctx.trees.values())ctx.scene.remove(t);for(const g of ctx.chunks.values()){g.userData.treeBatch?.dispose();for(const geo of g.userData.terrainGeometries??[])geo.dispose();ctx.scene.remove(g);}for(const f of ctx.falling)ctx.scene.remove(f.tree);for(const p of ctx.particles)ctx.scene.remove(p.mesh);for(const p of ctx.placed)ctx.scene.remove(p.mesh);ctx.disposePreview();ctx.trees.clear();ctx.chunks.clear();ctx.falling.length=0;ctx.particles.length=0;ctx.placed.length=0;ctx.felled.clear();ctx.treeDamage.clear();ctx.collisionWorld?.invalidate?.()}
function addLog(data){if(!validBuildLog(data)||ctx.placed.some(p=>p.id===data.id))return;const m=ctx.makeLog();m.position.set(data.x,Number.isFinite(data.y)?data.y:logCenterY(data,ctx.terrain.heightAt(data.x,data.z),ctx.logRadius),data.z);applyLogRotation(m,data.orientation);ctx.scene.add(m);ctx.placed.push({...data,y:m.position.y,mesh:m});ctx.collisionWorld?.invalidate?.();ctx.atmosphere?.invalidateStaticShadows?.()}
function treeHit(id,hp){ctx.treeDamage.set(id,hp);const t=ctx.trees.get(id);if(t){t.userData.hp=hp;ctx.spawnChips(t)}}
function treeFell(id,direction=null){ctx.felled.add(id);ctx.distantForest?.invalidateTree?.(id);ctx.treeDamage.delete(id);const t=ctx.trees.get(id);if(t){ctx.detachTreeForFall?.(t);ctx.trees.delete(id);ctx.collisionWorld?.invalidate?.();ctx.spawnChips(t);ctx.falling.push({tree:t,elapsed:0,direction:direction??Math.random()*Math.PI*2})}}
// Camera-facing player names, kept above the character even as it turns or moves.
function createNameTag(name) {
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
 const g=canvas.getContext('2d');
 const label=(String(name||'Игрок').trim()||'Игрок').slice(0,22);
 g.font='bold 46px sans-serif';
 const width=Math.min(492,Math.ceil(g.measureText(label).width)+44);
 const left=(512-width)/2;
 g.fillStyle='rgba(8,25,17,.78)';
 g.beginPath();g.roundRect(left,16,width,94,24);g.fill();
 g.strokeStyle='rgba(200,245,213,.65)';g.lineWidth=3;g.stroke();
 g.fillStyle='#ffffff';g.textAlign='center';g.textBaseline='middle';
 g.fillText(label,256,64,455);
 const texture=new ctx.THREE.CanvasTexture(canvas);
 texture.colorSpace=ctx.THREE.SRGBColorSpace;
 const material=new ctx.THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false});
 const tag=new ctx.THREE.Sprite(material);
 tag.position.set(0,2.75,0);tag.scale.set(2.5,.625,1);
 return tag;
}
function addAvatar(p){if(p.id===ctx.myId)return;
 if(ctx.avatars.has(p.id)){
  const avatar=ctx.avatars.get(p.id);
  if(p.name && avatar.name!==p.name){
   avatar.group.remove(avatar.tag);avatar.tag.material.map.dispose();avatar.tag.material.dispose();
   avatar.tag=createNameTag(p.name);avatar.group.add(avatar.tag);avatar.name=p.name;
  }
  return;
 }
 const actor=ctx.createLumberjack();const group=actor?actor.group:new ctx.THREE.Group();
 // Remote characters render on layer 1, separate from trees (0) and local (3).
 // All their skinned meshes stay visible in both first- and third-person views.
 if(actor?.visual)actor.visual.traverse(node=>{if(node.isMesh)node.layers.set(1);});
 const shadowMeshes=actor?.shadowMeshes ?? [];
 if(!actor){const mesh=new ctx.THREE.Mesh(new ctx.THREE.CapsuleGeometry(.34,1.1,4,8),new ctx.THREE.MeshLambertMaterial({color:0x557d96}));mesh.position.y=1.0;mesh.castShadow=true;mesh.layers.set(1);group.add(mesh);shadowMeshes.push(mesh)}
 // Cheap shadow-only capsule for distant characters: it follows the avatar
 // group, but layer 4 is never enabled on the main camera.
 let shadowProxy=null;
 if(ctx.THREE.Mesh && ctx.THREE.CapsuleGeometry && ctx.THREE.MeshBasicMaterial){
  shadowProxy=new ctx.THREE.Mesh(
   new ctx.THREE.CapsuleGeometry(.32,1.05,2,5),
   new ctx.THREE.MeshBasicMaterial({color:0x000000}));
  shadowProxy.position.y=1.0;
  shadowProxy.layers.set(4);
  shadowProxy.castShadow=true;
  group.add(shadowProxy);
 }
 if(p.axe_equipped===false){
   actor?.visual?.traverse?.(node=>{if(/^Axe (blade|handle)$/.test(node.name))node.visible=false;});
 }
 const tag=createNameTag(p.name);group.add(tag);
 group.position.set(p.x,p.y||0,p.z);ctx.scene.add(group);
 ctx.avatars.set(p.id,{group,actor,tag,shadowMeshes,shadowProxy,shadowLod:'off',name:p.name||'Игрок',goal:new ctx.THREE.Vector3(p.x,p.y||0,p.z),angle:p.yaw||0,jumping:!!p.jumping});ctx.playerList?.render();}

function removeAvatar(id){const a=ctx.avatars.get(id);if(a){ctx.scene.remove(a.group);a.tag.material.map.dispose();a.tag.material.dispose();if(a.shadowProxy){a.group.remove(a.shadowProxy);a.shadowProxy.geometry.dispose();a.shadowProxy.material.dispose()}if(a.actor){a.actor.mixer.stopAllAction();ctx.modelActors.delete(a.actor)}else{for(const child of a.group.children){if(child.geometry)child.geometry.dispose();if(child.material&&child!==a.tag)child.material.dispose()}}ctx.avatars.delete(id);ctx.playerList?.render()}}
let peer=null, guestConnection=null;
const bridges=new Set();
let generation=0;
function closeNet(){
 generation++;
 pendingPing=null;lastPingAt=0;lastMapPingAt=-Infinity;ctx.settings.setConnected(false);
 ctx.clearMapPings?.();ctx.communityGoal?.clear();ctx.emotes?.clear();lastEmoteAt=-Infinity;
 chatHistory.length=0;ctx.$('chatmessages').replaceChildren();ctx.$('chatunread').textContent='';
 for(const stop of bridges)stop();bridges.clear();
 if(guestConnection){guestConnection.close();guestConnection=null}
 if(peer){peer.destroy();peer=null}
 if(ctx.socket){const old=ctx.socket;ctx.socket=null;old.onclose=old.onopen=old.onmessage=old.onerror=null;old.close()}
 ctx.dayCycle?.leaveServer?.();
 ctx.myId=null;for(const id of [...ctx.avatars.keys()])removeAvatar(id);ctx.playerList?.render();ctx.playerList?.close();
 ctx.$('online').textContent='⚪ Одиночная игра';ctx.$('netstatus').textContent=ctx.offlineSave.suspended
  ? 'Отключено. Копия сетевого мира не сохраняется локально. Для новой одиночной игры нажмите «Новый лес».'
  : 'Отключено. Локальный мир можно продолжить.';
 ctx.$('reset').disabled=false;
}
const status=text=>{ctx.$('netstatus').textContent=text};
function updateOnlineCount(){
 const count=ctx.avatars.size+1;
 const word=count%10===1&&count%100!==11?'игрок':
  count%10>=2&&count%10<=4&&(count%100<12||count%100>14)?'игрока':'игроков';
 ctx.$('online').textContent=`🟢 Онлайн · ${count} ${word}`;
}
const url=()=>{let u=ctx.$('neturl').value.trim();if(u.startsWith('https://'))u='wss://'+u.slice(8);else if(u.startsWith('http://'))u='ws://'+u.slice(7);if(!/^wss?:\/\//.test(u))u='ws://'+u;return u};
const peerConfig=()=>({custom:ctx.$('peercustom').checked,host:ctx.$('peerhost').value.trim(),port:Number(ctx.$('peerport').value),path:ctx.$('peerpath').value.trim(),secure:ctx.$('peersecure').checked});
const mode=ctx.$('netmode'),room=ctx.$('peerroom');
ctx.$('peercustom').onchange=()=>{ctx.$('peersettings').style.display=ctx.$('peercustom').checked?'block':'none'};
mode.onchange=()=>{
 const isGuest=mode.value==='guest';
 ctx.$('neturl').closest('label').style.display=isGuest?'none':'';
 room.closest('label').style.display=mode.value==='direct'?'none':'';
 room.placeholder=isGuest?'Вставьте ID комнаты':'ID создаётся автоматически';
 room.readOnly=!isGuest;
 ctx.$('connect').textContent=mode.value==='host'?'Создать комнату':isGuest?'Присоединиться':'Подключиться';
};mode.onchange();
ctx.$('nettoggle').onclick=()=>{ctx.settings.close();ctx.$('network').style.display=ctx.$('network').style.display==='none'?'block':'none'};
ctx.$('disconnect').onclick=closeNet;
function connectSocket(ws) {
 ctx.socket=ws;
 ctx.$('online').textContent='🟡 Подключение…';
 ws.onopen=()=>{if(ctx.socket===ws)ws.send(JSON.stringify({type:'hello',name:ctx.$('netname').value,resources:true}))};
 ws.onerror=()=>{if(ctx.socket===ws)status('Ошибка соединения. Проверьте сервер, адрес и сеть.')};
 ws.onclose=()=>{if(ctx.socket===ws){const wasConnected=ctx.myId!==null;closeNet();status('Соединение потеряно. Переподключитесь: сетевой мир не сохраняется локально.');if(wasConnected)ctx.notify('Соединение потеряно', 'warning', 'connection-lost')}};
 ws.onmessage=e=>{if(ctx.socket!==ws)return;let d;try{d=JSON.parse(e.data)}catch{return}switch(d.type){case 'vitals_state':ctx.vitals?.acceptServer?.(d.vitals);break;case 'fall_impact':ctx.applyFallImpact?.({height:d.height,damage:d.damage,speed:Math.sqrt(2*(ctx.GRAVITY??19)*d.height)},{authoritative:true});break;
 case 'player_respawn':ctx.deathSystem?.receive?.(d);break;
 case 'spawn_bed_set':ctx.deathSystem?.acceptBed?.(d.id);break;
 case 'time_sync':ctx.dayCycle?.syncServerPhase?.(d.day_phase,performance.now());break;
 case 'inventory_state':
   if(ctx.inventory?.acceptServer?.(d.inventory,d.wood))ctx.wood=d.wood;
   break;
 case 'resources_state':ctx.forestResources?.set?.(d.resources);break;
 case 'resource_remove':ctx.forestResources?.remove?.(d.id);break;
 case 'box_add':ctx.groundBoxes?.add?.(d.box);break;
 case 'box_remove':ctx.groundBoxes?.remove?.(d.id);break;
 case 'action_denied':ctx.notify?.(String(d.reason||'Действие отклонено'),'warning','inventory-denied');break;
 case 'pong':if(pendingPing&&d.nonce===pendingPing.nonce){const rtt=Math.max(0,performance.now()-pendingPing.at);pendingPing=null;ctx.settings.setLatency(rtt)}break;case 'chat':receiveChat(d);break;case 'emote':ctx.emotes?.receive(d);break;case 'equipment':{const actor=ctx.avatars.get(d.by)?.actor;
   actor?.visual?.traverse?.(node=>{if(/^Axe (blade|handle)$/.test(node.name))node.visible=d.axe_equipped===true;});
   break;}case 'map_ping':if(ctx.showMapPing?.(d) && d.by!==ctx.myId)ctx.notify('📍 '+String(d.name||'Игрок').slice(0,22)+' отметил точку','info','map-ping-'+d.by);break;case 'welcome':for(const message of d.chat||[])receiveChat(message);ctx.myId=d.id;ctx.offlineSave.suspend();ctx.dayCycle?.syncServerPhase?.(d.day_phase,performance.now());clearWorld();ctx.deathSystem?.restore?.(null);ctx.seed=d.seed;for(const id of d.felled)ctx.felled.add(id);for(const [id,hp] of Object.entries(d.damage||{}))ctx.treeDamage.set(id,hp);for(const log of d.logs)addLog(log);for(const furniture of d.furniture||[])ctx.crafting?.add(furniture);ctx.campStructures?.set?.(d.camp_structures);ctx.storages?.set(d.storages??[]);for(const p of d.players)addAvatar(p);ctx.px=ctx.pz=0;ctx.progress.resetPosition(0,0);ctx.feetY=ctx.verticalSpeed=0;ctx.onGround=true;ctx.vitals?.acceptServer?.(d.vitals);ctx.inventory?.acceptServer?.(d.inventory,d.wood);syncWood(d.wood,d.cuts);ctx.groundBoxes?.set?.(d.boxes);ctx.forestResources?.set?.(d.resources);ctx.settings.setConnected(true);ctx.communityGoal?.set(d.community_cuts,{initial:true});ctx.updateChunks();updateOnlineCount();ctx.playerList?.render();ctx.$('netstatus').textContent='Подключено! Мир общий и сохраняется на сервере.';break;case 'join':{const fresh=ctx.myId!==null && d.player?.id!==ctx.myId && !ctx.avatars.has(d.player?.id);addAvatar(d.player);updateOnlineCount();ctx.playerList?.render();if(fresh)ctx.notify(`${String(d.player?.name||'Игрок').slice(0,22)} присоединился к игре`,'info',`player-join-${d.player.id}`);break}case 'leave':{const avatar=ctx.avatars.get(d.id);removeAvatar(d.id);updateOnlineCount();ctx.playerList?.render();if(avatar && ctx.myId!==null)ctx.notify(`${avatar.name} покинул игру`,'info',`player-leave-${d.id}`);break}case 'move':{const a=ctx.avatars.get(d.id);if(a){a.goal.set(d.x,d.y||0,d.z);a.angle=d.yaw;a.jumping=!!d.jumping}break}case 'tree_hit':treeHit(d.tree,d.hp);for(const a of ctx.avatars.values()){if(Math.hypot(a.group.position.x-(ctx.trees.get(d.tree)?.position.x??9999),a.group.position.z-(ctx.trees.get(d.tree)?.position.z??9999))<5)ctx.actorChop(a.actor)}break;case 'tree_fell':treeFell(d.tree,d.direction);ctx.communityGoal?.set(d.community_cuts);if(d.by===ctx.myId){syncWood(d.wood,d.cuts);ctx.$('target').textContent='🪵 '+TREE_LOG_COUNT+' бревна на земле';ctx.notify('🪵 '+TREE_LOG_COUNT+' бревна на земле — подбери их (E)','success','tree-reward');ctx.tutorial.complete('tree-fell');ctx.progress.record('tree-fell')}break;case 'camp_add':ctx.campStructures?.add?.(d.structure);break;case 'camp_update':ctx.campStructures?.add?.(d.structure);break;case 'camp_remove':ctx.campStructures?.remove?.(d.id);break;case 'storage_update':ctx.storages?.add(d.storage);break;case 'storage_remove':ctx.storages?.remove(d.id);break;case 'furniture_add':ctx.crafting?.add(d.item);if(d.by===ctx.myId){syncWood(d.wood);ctx.notify('🪑 Скамейка готова · −3 🪵','success','bench-add')}break;case 'furniture_remove':ctx.crafting?.remove(d.id);if(d.by===ctx.myId){syncWood(d.wood);ctx.notify('🪑 Скамейка убрана · +2 🪵','success','bench-remove')}break;case 'log_add':addLog(d.log);if(d.by===ctx.myId){syncWood(d.wood);ctx.notify('Бревно установлено · −1 🪵','success','log-placed');ctx.tutorial.complete('log-placed');ctx.progress.record('log-placed')}break;case 'log_remove':{const i=ctx.placed.findIndex(p=>p.id===d.id);if(i>=0){ctx.scene.remove(ctx.placed[i].mesh);ctx.placed.splice(i,1);ctx.collisionWorld?.invalidate?.();ctx.atmosphere?.invalidateStaticShadows?.()}if(d.by===ctx.myId){syncWood(d.wood);ctx.notify('Бревно убрано · +1 🪵','success','log-removed')}break}}};
}
ctx.$('connect').onclick=async()=>{
 closeNet();const token=generation;
 ctx.$('online').textContent='🟡 Подключение…';
 try {
  if(mode.value==='direct') {
    status('Подключаемся к WebSocket...');
    connectSocket(new WebSocket(url()));return;
  }
  status('Соединяемся с PeerServer...');
  const candidate=await createPeer(peerConfig());
  if(token!==generation){candidate.destroy();return}
  peer=candidate;
  peer.on('error',err=>{if(token===generation)status('PeerJS: '+(err.message||err.type))});
  const localId=await waitForPeer(peer);
  if(token!==generation)return;
  if(mode.value==='host') {
    peer.on('connection',conn=>{
      if(token!==generation){conn.close();return}
      conn.on('open',()=>{
        if(token!==generation){conn.close();return}
        const stop=bridgeGuest(conn,url(),status);
        bridges.add(stop);
        conn.on('close',()=>bridges.delete(stop));
      });
    });
    room.value=localId;
    status('Комната '+localId+' готова. Можно отправить ID друзьям.');
    connectSocket(new WebSocket(url()));
  } else {
    const hostId=room.value.trim();
    if(!hostId)throw Error('Укажите ID комнаты');
    status('Подключаемся к комнате '+hostId+'...');
    guestConnection=peer.connect(hostId,{reliable:true,serialization:'json'});
    connectSocket(peerSocket(guestConnection));
  }
 }catch(err){if(token===generation){closeNet();status('Подключение не удалось: '+err.message);ctx.notify('Не удалось подключиться','warning','connection-error')}}
};

return {isOnline, sendNet, updatePing, syncWood, clearWorld, addLog, treeHit, treeFell, addAvatar, removeAvatar, closeNet, sendChat, sendMapPing, sendEmote, chatHistory};
}
