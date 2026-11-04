import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SEED,parseSeed,parseLaunchQuery,normalizeServerAddress,serverStatusAddress,
  parseServerStatus,formatWorldAge,recentServers,rememberServer,
  readLocalWorld,listSavedSlots,formatSavedWorld,favoriteServers,toggleFavoriteServer,
} from '../src/main-menu-state.js';
import {slotKey} from '../src/offline-save.js';
const OFFLINE_SAVE_KEY=slotKey(1);
import {
  PROGRESS_KEY,LIFETIME_ACHIEVEMENTS_KEY,
  lifetimeAchievements,resetWorldProgress,
} from '../src/progress.js';

function memory(){
  const items=new Map();
  return {getItem:key=>items.get(key)??null,
    setItem:(key,value)=>items.set(key,value),
    removeItem:key=>items.delete(key),items};
}
test('new world seed accepts only valid integer 0..999998',()=>{
  assert.equal(parseSeed('0'),0);
  assert.equal(parseSeed('24680'),24680);
  assert.equal(parseSeed(String(MAX_SEED)),MAX_SEED);
  for(const value of ['-1','1.2','1e4','Infinity','NaN','','999999','  ',null,'1foo'])
    assert.equal(parseSeed(value),null,String(value));
});
test('menu detects valid offline save but never mutates it during a read',()=>{
  const storage=memory();
  assert.equal(readLocalWorld(storage),null);
  storage.setItem(OFFLINE_SAVE_KEY,JSON.stringify({
    version:1,seed:24680,wood:10,cuts:3,felled:[],damage:{},logs:[],
    position:{x:0,z:0,yaw:0,pitch:0},
  }));
  const original=storage.getItem(OFFLINE_SAVE_KEY);
  const value=readLocalWorld(storage);
  assert.equal(value.seed,24680);
  assert.ok(formatSavedWorld(value).includes('Seed 24680'));
  assert.equal(storage.getItem(OFFLINE_SAVE_KEY),original);
  storage.setItem(OFFLINE_SAVE_KEY,'{"broken":true}');
  assert.equal(readLocalWorld(storage),null);
});
test('network address validation, status URL and recent history are bounded',()=>{
  assert.equal(normalizeServerAddress(' ws://localhost:8765 '),'ws://localhost:8765/');
  assert.equal(normalizeServerAddress('ws://example.test:9000/game'),
    'ws://example.test:9000/game');
  assert.equal(serverStatusAddress('wss://forest.example.org:443/game?q=5'),
    'wss://forest.example.org/status');
  for(const bad of ['http://x.test','ftp://x.test','ws://u:p@host.test/',
    'wss://host.test/#abc',''])assert.equal(normalizeServerAddress(bad),null);
  const store=memory();
  for(let i=0;i<12;i++)rememberServer(store,'ws://example'+i+'.test');
  assert.equal(recentServers(store).length,6);
  const prior=recentServers(store);
  rememberServer(store,prior[3]);
  assert.equal(recentServers(store)[0],prior[3]);
  assert.equal(new Set(recentServers(store)).size,6);
});
test('server status rejects incompatible or malformed payloads',()=>{
  const valid={type:'server_status',name:'Forest Chopper Server',
    online:3,max_players:32,world_seed:67890,world_created_at:Date.now()/1000-3601,
    day_phase:.43,protocol_version:1};
  const parsed=parseServerStatus(valid);
  assert.deepEqual([parsed.online,parsed.maxPlayers,parsed.seed],[3,32,67890]);
  assert.equal(formatWorldAge(3601),'1 ч 0 мин');
  assert.equal(formatWorldAge(25*3600),'1 д 1 ч');
  for(const mutation of [{type:'welcome'},{protocol_version:2},{online:-1},
    {world_seed:-1},{world_created_at:0},{day_phase:1},{name:'x'.repeat(81)}])
    assert.equal(parseServerStatus({...valid,...mutation}),null);
});
test('new game resets world progress but keeps earned lifetime achievements',()=>{
  const store=memory();
  store.setItem(PROGRESS_KEY,JSON.stringify({
    version:1,trees:26,logs:2,distance:102,visited:['1:0,0','1:0,1'],
    discovered:[],objective:{index:0,baseline:0},
  }));
  store.setItem(OFFLINE_SAVE_KEY,'existing-solo-save');
  store.setItem('forest-chopper:settings:v1','saved-settings');
  assert.ok(lifetimeAchievements(store).includes('twenty-trees'));
  const earned=resetWorldProgress(store);
  assert.ok(earned.includes('five-trees'));
  assert.equal(store.getItem(PROGRESS_KEY),null);
  assert.equal(store.getItem(OFFLINE_SAVE_KEY),'existing-solo-save');
  assert.equal(store.getItem('forest-chopper:settings:v1'),'saved-settings');
  assert.deepEqual(lifetimeAchievements(store),earned);
  assert.deepEqual(JSON.parse(store.getItem(LIFETIME_ACHIEVEMENTS_KEY)),earned);
});

test('starred servers remain available after recent history eviction',()=>{
  const store=memory();
  toggleFavoriteServer(store,'ws://important.example.test');
  for(let i=0;i<10;i++)rememberServer(store,'ws://server'+i+'.test');
  assert.equal(recentServers(store).includes('ws://important.example.test/'),false);
  assert.ok(favoriteServers(store).includes('ws://important.example.test/'));
  toggleFavoriteServer(store,'ws://important.example.test');
  assert.deepEqual(favoriteServers(store),[]);
});

test('URL shortcuts parse valid new/continue/multiplayer inputs and preserve encoded servers',()=>{
  assert.deepEqual(parseLaunchQuery('?type=new&seed=123&force=true&performance=low&name=woodpecker&diag=true'),{
    type:'new',seedProvided:true,seed:123,force:true,performance:'low',diag:true,
    name:'woodpecker',server:null,
  });
  assert.equal(parseLaunchQuery('?type=new').seedProvided,false);
  assert.equal(parseLaunchQuery('?type=continue&diag=false').diag,false);
  assert.equal(parseLaunchQuery('?type=multiplayer&server=ws%3A%2F%2Flocalhost%3A8765').server,
    'ws://localhost:8765');
  const bad=parseLaunchQuery('?type=bogus&seed=999999&force=1&performance=ultra&diag=yes');
  assert.equal(bad.type,null);
  assert.equal(bad.seedProvided,true);
  assert.equal(bad.seed,null);
  assert.equal(bad.force,false);
  assert.equal(bad.performance,null);
  assert.equal(bad.diag,null);
  assert.equal(parseLaunchQuery('?name='+encodeURIComponent('Z'.repeat(50))).name.length,22);
});


test('save list always contains ten ordered slots and preserves occupied metadata',()=>{
 const storage=memory();
 storage.setItem(slotKey(3),JSON.stringify({version:1,seed:42,wood:0,cuts:5,logsCollected:7,createdAt:100,savedAt:200,felled:[],damage:{},logs:[],position:{x:1,y:2,z:3,yaw:0,pitch:0}}));
 storage.setItem(slotKey(8),'broken');
 const slots=listSavedSlots(storage);
 assert.deepEqual(slots.map(item=>item.slot),[1,2,3,4,5,6,7,8,9,10]);
 assert.equal(slots.filter(item=>item.save).length,1);
 assert.equal(slots[2].save.seed,42);assert.equal(slots[2].save.logsCollected,7);
 assert.deepEqual(slots[2].metadata,{createdAt:100,savedAt:200});
 assert.equal(slots[7].save,null);
 assert.equal(listSavedSlots({getItem(){throw Error('blocked');}}).length,10);
});
