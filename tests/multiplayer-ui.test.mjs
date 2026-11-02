import test from 'node:test';
import assert from 'node:assert/strict';
import {createMultiplayer} from '../src/multiplayer.js';

function fixture() {
  const previousWebSocket = globalThis.WebSocket;
  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) {this.url=url;this.readyState=1;this.sent=[];FakeWebSocket.instances.push(this);}
    static instances=[];
    send(data){this.sent.push(JSON.parse(data));}
    close(){this.readyState=3;}
    message(data){this.onmessage?.({data:JSON.stringify(data)});}
  }
  globalThis.WebSocket=FakeWebSocket;

  const elements = new Map(), notifications = [], pings=[];
  let clearedPings=0;
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const children=[];
    const result={
      value:'', textContent:'', style:{display:'none'}, checked:false,
      children, classList:{contains:()=>true,toggle() {},add(){}},
      setAttribute(){}, addEventListener(){}, blur(){},
      append(...nodes){children.push(...nodes)},
      replaceChildren(...nodes){children.splice(0,children.length,...nodes)},
      closest(){return {style:{display:''}}}, remove(){},
    };
    if(id==='netmode')result.value='direct';
    if(id==='neturl')result.value='ws://localhost:12345';
    if(id==='netname')result.value='Tester';
    elements.set(id,result);return result;
  }
  const docPrevious=globalThis.document;
  globalThis.document={
    createTextNode(text){return {textContent:text}},
    createElement(tag){
      if(tag==='canvas')return {width:0,height:0,getContext(){return {
        measureText: text => ({width:text.length*20}),roundRect(){},beginPath(){},
        fill(){},stroke(){},fillText(){},
      }}};
      return {textContent:'',className:'',children:[],append(...nodes){this.children.push(...nodes)}};
    },
  };
  class Group {
    constructor(){
      this.children=[];
      this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z})}};
    }
    add(node){this.children.push(node)}
    remove(node){this.children=this.children.filter(child=>child!==node)}
  }
  class Sprite extends Group {
    constructor(material){super();this.material=material;this.scale={set(){}};}
  }
  class Texture {dispose(){this.disposed=true}}
  class Material {constructor(args){Object.assign(this,args)}dispose(){this.disposed=true}}
  class Vector3 {constructor(x,y,z){Object.assign(this,{x,y,z})}}
  const scene={objects:new Set(),add(node){this.objects.add(node)},remove(node){this.objects.delete(node)}};
  const ctx={
    $:element, THREE:{Group,Sprite,CanvasTexture:Texture,SpriteMaterial:Material,Vector3,SRGBColorSpace:'srgb'},
    scene, socket:null, myId:null, avatars:new Map(), modelActors:new Set(),
    trees:new Map(), chunks:new Map(), falling:[],particles:[],placed:[],
    felled:new Set(),treeDamage:new Map(),seed:1,wood:0,cuts:0,px:0,pz:0,
    offlineSave:{suspended:false,suspend(){this.suspended=true}},
    settings:{setConnected(){},setLatency(){},close(){}},
    progress:{resetPosition() {},record(){}},
    tutorial:{complete(){}},
    notify:(...args)=>notifications.push(args),
    showMapPing:data=>{pings.push(data);return true},
    clearMapPings:()=>{clearedPings++;pings.length=0},
    crafting:{items:new Map(),add(item){this.items.set(item.id,item);return true},remove(id){return this.items.delete(id)},clear(){this.items.clear()}},
    emotes:{received:[],receive(d){this.received.push(d)},clear(){this.received.length=0}},
    communityGoal:{value:null,set(v){if(Number.isInteger(v)){this.value=v;return true}return false},clear(){this.value=null}},
    updateChunks(){},
    disposePreview(){},
    createAvatar:async()=>({group:new Group(),visual:new Group(),shadowMeshes:[],mixer:{stopAllAction(){}}}),
    makeLog:()=>({position:{set(){}},rotation:{y:0}}),
  };
  const multiplayer=createMultiplayer(ctx);
  return {
    ctx, multiplayer, notifications, pings, FakeWebSocket,
    get clearedPings(){return clearedPings;},
    restore(){globalThis.WebSocket=previousWebSocket;globalThis.document=docPrevious},
    get socket(){return FakeWebSocket.instances.at(-1)},
  };
}
test('join/leave notifications are deduplicated and avatars cleaned up',async()=>{
  const f=fixture();
  try{
    await f.ctx.$('connect').onclick();
    const ws=f.socket;
    assert.match(f.ctx.$('online').textContent,/Подключение/);
    ws.onopen();
    assert.equal(ws.sent[0].type,'hello');
    ws.message({type:'welcome',id:1,seed:21,felled:[],damage:{},logs:[],
      players:[{id:2,name:'Already here',x:1,z:0}],wood:0,cuts:0,chat:[]});
    assert.equal(f.ctx.avatars.size,1);
    assert.match(f.ctx.$('online').textContent,/2 игрока/);
    assert.equal(f.notifications.length,0,'welcome should not announce the whole room');
    ws.message({type:'join',player:{id:3,name:'New friend',x:2,z:1}});
    ws.message({type:'join',player:{id:3,name:'New friend',x:2,z:1}});
    assert.equal(f.ctx.avatars.size,2);
    assert.match(f.ctx.$('online').textContent,/3 игрока/);
    assert.equal(f.notifications.length,1);
    assert.match(f.notifications[0][0],/New friend присоединился/);
    ws.message({type:'leave',id:3});
    ws.message({type:'leave',id:3});
    assert.equal(f.ctx.avatars.size,1);
    assert.equal(f.notifications.length,2);
    assert.match(f.notifications[1][0],/New friend покинул/);
    f.ctx.$('disconnect').onclick();
    assert.equal(f.ctx.avatars.size,0);
    assert.equal(f.ctx.myId,null);
    assert.match(f.ctx.$('online').textContent,/Одиночная игра/);
  }finally{f.restore()}
});
test('replaced sockets cannot repopulate stale avatars or overwrite state',async()=>{
  const f=fixture();
  try{
    await f.ctx.$('connect').onclick();
    const old=f.socket;
    await f.ctx.$('connect').onclick();
    const fresh=f.socket;
    assert.notEqual(old,fresh);
    old.message({type:'welcome',id:99,seed:222,felled:[],damage:{},logs:[],players:[],chat:[]});
    assert.equal(f.ctx.myId,null);
    assert.equal(f.ctx.seed,1);
    fresh.message({type:'welcome',id:5,seed:55,felled:[],damage:{},logs:[],players:[],wood:0,cuts:0,chat:[]});
    assert.equal(f.ctx.myId,5);
    assert.equal(f.ctx.seed,55);
  }finally{f.restore()}
});

test('map markers are acknowledged by server, never optimistic, and cleared on disconnect',async()=>{
  const f=fixture();
  try{
    await f.ctx.$('connect').onclick();
    const ws=f.socket;
    ws.message({type:'welcome',id:1,seed:21,felled:[],damage:{},logs:[],players:[],wood:0,cuts:0,chat:[]});
    assert.equal(f.pings.length,0);
    assert.equal(f.multiplayer.sendMapPing(12.3,-4.4),true);
    assert.deepEqual(ws.sent.at(-1),{type:'map_ping',x:12.3,z:-4.4});
    assert.equal(f.pings.length,0,'client must wait for a confirmed server marker');
    assert.equal(f.multiplayer.sendMapPing(13,0),false,'client rate limit');
    assert.equal(f.multiplayer.sendMapPing(100,0),false,'out-of-range coordinates are rejected');
    ws.message({type:'map_ping',by:1,name:'Tester',x:12.3,z:-4.4});
    assert.equal(f.pings.length,1);
    assert.equal(f.notifications.length,0,'own marker does not spam toasts');
    ws.message({type:'map_ping',by:2,name:'Bob',x:9,z:-2});
    assert.equal(f.pings.length,2);
    assert.match(f.notifications[0][0],/Bob отметил точку/);
    f.ctx.$('disconnect').onclick();
    assert.equal(f.pings.length,0);
    assert.ok(f.clearedPings>=1);
    ws.message({type:'map_ping',by:3,name:'OldRoom',x:0,z:0});
    assert.equal(f.pings.length,0,'stale room messages must not reappear');
  }finally{f.restore()}
});

test('emote outbound requests are whitelisted and received only after server ack',async()=>{
 const f=fixture();
 try{
  await f.ctx.$('connect').onclick();
  const ws=f.socket;
  ws.message({type:'welcome',id:1,seed:21,felled:[],damage:{},logs:[],players:[],wood:0,cuts:0,chat:[]});
  assert.equal(f.multiplayer.sendEmote('wave'),true);
  assert.deepEqual(ws.sent.at(-1),{type:'emote',kind:'wave'});
  assert.equal(f.ctx.emotes.received.length,0);
  assert.equal(f.multiplayer.sendEmote('thumbs_up'),false,'anti spam');
  assert.equal(f.multiplayer.sendEmote('bogus'),false);
  ws.message({type:'emote',by:1,kind:'wave'});
  assert.equal(f.ctx.emotes.received.length,1);
  f.ctx.$('disconnect').onclick();
  assert.equal(f.ctx.emotes.received.length,0);
 }finally{f.restore()}
});

test('authoritative bench add/remove events change wood only after server acknowledgment',async()=>{
 const f=fixture();
 try{
  await f.ctx.$('connect').onclick();
  const ws=f.socket;
  ws.message({type:'welcome',id:1,seed:21,felled:[],damage:{},logs:[],furniture:[],
    players:[],wood:5,cuts:0,chat:[]});
  assert.equal(f.ctx.wood,5);
  const item={id:3,kind:'bench',x:4,z:0,orientation:0};
  ws.message({type:'furniture_add',item,by:1,wood:2});
  assert.equal(f.ctx.wood,2);
  assert.equal(f.ctx.crafting.items.size,1);
  ws.message({type:'furniture_remove',id:3,by:1,wood:4});
  assert.equal(f.ctx.wood,4);
  assert.equal(f.ctx.crafting.items.size,0);
  f.ctx.crafting.add(item);
  f.ctx.$('disconnect').onclick();
  // As for logs, disconnected multiplayer scenery may remain visible, but offline save is suspended.
  assert.equal(f.ctx.crafting.items.size,1);
  assert.equal(f.ctx.offlineSave.suspended,true);
 }finally{f.restore()}
});

test('shared team progress comes solely from server welcome/confirmed felled events',async()=>{
 const f=fixture();
 try{
  await f.ctx.$('connect').onclick();
  const ws=f.socket;
  assert.equal(f.ctx.communityGoal.value,null);
  ws.message({type:'welcome',id:1,seed:21,felled:[],damage:{},logs:[],furniture:[],
    community_cuts:18,players:[],wood:0,cuts:0,chat:[]});
  assert.equal(f.ctx.communityGoal.value,18);
  ws.message({type:'tree_hit',tree:'0,0:1',hp:3});
  assert.equal(f.ctx.communityGoal.value,18);
  ws.message({type:'tree_fell',tree:'0,0:1',by:2,wood:5,cuts:1,community_cuts:19});
  assert.equal(f.ctx.communityGoal.value,19);
  ws.message({type:'tree_fell',tree:'0,0:2',by:2,wood:10,cuts:2,community_cuts:20});
  assert.equal(f.ctx.communityGoal.value,20);
  f.ctx.$('disconnect').onclick();
  assert.equal(f.ctx.communityGoal.value,null);
 }finally{f.restore()}
});

test('server damage event with author skips duplicate local chips, but remote hits still spawn chips',async()=>{
 const f=fixture(),chips=[],ack=[];
 try{
  f.ctx.spawnChips=tree=>chips.push(tree.userData.id);
  f.ctx.acknowledgeLocalChop=(treeId,by)=>{ack.push([treeId,by]);return by===f.ctx.myId;};
  const tree={userData:{id:'0,0:1',hp:4},position:{x:1,z:0}};
  f.ctx.trees.set(tree.userData.id,tree);
  await f.ctx.$('connect').onclick();
  f.socket.message({type:'welcome',id:1,seed:21,felled:[],damage:{},logs:[],players:[],wood:0,cuts:0,chat:[]});
  f.ctx.trees.set(tree.userData.id,tree);
  f.socket.message({type:'tree_hit',tree:'0,0:1',hp:3,by:1});
  assert.deepEqual(chips,[],'predicted chips already shown at player impact frame');
  assert.equal(tree.userData.hp,3);
  f.socket.message({type:'tree_hit',tree:'0,0:1',hp:2,by:2});
  assert.deepEqual(chips,['0,0:1'],'another player hit still creates visible chips');
  assert.deepEqual(ack,[['0,0:1',1],['0,0:1',2]]);
 }finally{f.restore();}
});
