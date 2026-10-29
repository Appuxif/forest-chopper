import {createPeer, waitForPeer, bridgeGuest, peerSocket} from './peer-bridge.js';
// Extracted from the original single-file game. Shared game state is passed explicitly.
export function createMultiplayer(ctx) {
function isOnline(){return ctx.socket?.readyState===WebSocket.OPEN&&ctx.myId!==null}
function sendNet(data){if(isOnline())ctx.socket.send(JSON.stringify(data))}
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
ctx.$('chattoggle').onclick=()=>{ctx.$('chatpanel').classList.toggle('collapsed');ctx.$('chatunread').textContent='';};
ctx.$('chatform').onsubmit=e=>{e.preventDefault();if(sendChat(ctx.$('chatinput').value))ctx.$('chatinput').value='';};
function syncWood(w,c){ctx.wood=w;ctx.$('wood').textContent=ctx.wood;if(c!==undefined){ctx.cuts=c;ctx.$('cut').textContent=ctx.cuts}}
function clearWorld(){for(const t of ctx.trees.values())ctx.scene.remove(t);for(const g of ctx.chunks.values())ctx.scene.remove(g);for(const f of ctx.falling)ctx.scene.remove(f.tree);for(const p of ctx.particles)ctx.scene.remove(p.mesh);for(const p of ctx.placed)ctx.scene.remove(p.mesh);if(ctx.preview){ctx.scene.remove(ctx.preview);ctx.preview=null}ctx.trees.clear();ctx.chunks.clear();ctx.falling.length=0;ctx.particles.length=0;ctx.placed.length=0;ctx.felled.clear();ctx.treeDamage.clear()}
function addLog(data){if(ctx.placed.some(p=>p.id===data.id))return;const m=ctx.makeLog();m.position.set(data.x,data.y,data.z);if(data.orientation===1)m.rotation.y=Math.PI/2;ctx.scene.add(m);ctx.placed.push({...data,mesh:m})}
function treeHit(id,hp){ctx.treeDamage.set(id,hp);const t=ctx.trees.get(id);if(t){t.userData.hp=hp;t.userData.scar.visible=true;t.userData.scar.scale.y=1+(1-hp/t.userData.maxHp)*2.2;ctx.spawnChips(t)}}
function treeFell(id){ctx.felled.add(id);ctx.treeDamage.delete(id);const t=ctx.trees.get(id);if(t){ctx.trees.delete(id);ctx.falling.push({tree:t,elapsed:0,direction:Math.random()*Math.PI*2})}}
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
 if(!actor){const mesh=new ctx.THREE.Mesh(new ctx.THREE.CapsuleGeometry(.34,1.1,4,8),new ctx.THREE.MeshLambertMaterial({color:0x557d96}));mesh.position.y=1.0;group.add(mesh)}
 const tag=createNameTag(p.name);group.add(tag);
 group.position.set(p.x,p.y||0,p.z);ctx.scene.add(group);
 ctx.avatars.set(p.id,{group,actor,tag,name:p.name||'Игрок',goal:new ctx.THREE.Vector3(p.x,p.y||0,p.z),angle:p.yaw||0,jumping:!!p.jumping});}

function removeAvatar(id){const a=ctx.avatars.get(id);if(a){ctx.scene.remove(a.group);a.tag.material.map.dispose();a.tag.material.dispose();if(a.actor){a.actor.mixer.stopAllAction();ctx.modelActors.delete(a.actor)}ctx.avatars.delete(id)}}
let peer=null, guestConnection=null;
const bridges=new Set();
let generation=0;
function closeNet(){
 generation++;
 chatHistory.length=0;ctx.$('chatmessages').replaceChildren();ctx.$('chatunread').textContent='';
 for(const stop of bridges)stop();bridges.clear();
 if(guestConnection){guestConnection.close();guestConnection=null}
 if(peer){peer.destroy();peer=null}
 if(ctx.socket){const old=ctx.socket;ctx.socket=null;old.onclose=null;old.close()}
 ctx.myId=null;for(const id of [...ctx.avatars.keys()])removeAvatar(id);
 ctx.$('online').textContent='⚪ Одиночная игра';ctx.$('netstatus').textContent='Отключено. Локальный мир можно продолжить.';
 ctx.$('reset').disabled=false;
}
const status=text=>{ctx.$('netstatus').textContent=text};
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
ctx.$('nettoggle').onclick=()=>{ctx.$('network').style.display=ctx.$('network').style.display==='none'?'block':'none'};
ctx.$('disconnect').onclick=closeNet;
function connectSocket(ws) {
 ctx.socket=ws;
 ws.onopen=()=>{ws.send(JSON.stringify({type:'hello',name:ctx.$('netname').value}))};
 ws.onerror=()=>{status('Ошибка соединения. Проверьте сервер, адрес и сеть.')};
 ws.onclose=()=>{if(ctx.socket===ws){closeNet();status('Соединение потеряно. Переподключитесь.')}};
 ws.onmessage=e=>{let d;try{d=JSON.parse(e.data)}catch{return}switch(d.type){case 'chat':receiveChat(d);break;case 'welcome':for(const message of d.chat||[])receiveChat(message);ctx.myId=d.id;clearWorld();ctx.seed=d.seed;for(const id of d.felled)ctx.felled.add(id);for(const [id,hp] of Object.entries(d.damage||{}))ctx.treeDamage.set(id,hp);for(const log of d.logs)addLog(log);for(const p of d.players)addAvatar(p);ctx.px=ctx.pz=0;ctx.feetY=ctx.verticalSpeed=0;ctx.onGround=true;syncWood(d.wood,d.cuts);ctx.updateChunks();ctx.$('online').textContent='🟢 Онлайн · '+(d.players.length+1)+' игроков';ctx.$('netstatus').textContent='Подключено! Мир общий и сохраняется на сервере.';break;case 'join':addAvatar(d.player);ctx.$('online').textContent='🟢 Онлайн · '+(ctx.avatars.size+1)+' игроков';break;case 'leave':removeAvatar(d.id);ctx.$('online').textContent='🟢 Онлайн · '+(ctx.avatars.size+1)+' игроков';break;case 'move':{const a=ctx.avatars.get(d.id);if(a){a.goal.set(d.x,d.y||0,d.z);a.angle=d.yaw;a.jumping=!!d.jumping}break}case 'tree_hit':treeHit(d.tree,d.hp);for(const a of ctx.avatars.values()){if(Math.hypot(a.group.position.x-(ctx.trees.get(d.tree)?.position.x??9999),a.group.position.z-(ctx.trees.get(d.tree)?.position.z??9999))<5)ctx.actorChop(a.actor)}break;case 'tree_fell':treeFell(d.tree);if(d.by===ctx.myId){syncWood(d.wood,d.cuts);ctx.$('target').textContent='+5 🪵 Древесина'}break;case 'log_add':addLog(d.log);if(d.by===ctx.myId)syncWood(d.wood);break;case 'log_remove':{const i=ctx.placed.findIndex(p=>p.id===d.id);if(i>=0){ctx.scene.remove(ctx.placed[i].mesh);ctx.placed.splice(i,1)}if(d.by===ctx.myId)syncWood(d.wood);break}}};
}
ctx.$('connect').onclick=async()=>{
 closeNet();const token=generation;
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
 }catch(err){if(token===generation){closeNet();status('Подключение не удалось: '+err.message)}}
};

return {isOnline, sendNet, syncWood, clearWorld, addLog, treeHit, treeFell, addAvatar, removeAvatar, closeNet, sendChat, chatHistory};
}
