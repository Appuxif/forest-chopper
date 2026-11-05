import {flatTerrain} from './helpers/flat-terrain.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineSave, parseOfflineSave, slotKey} from '../src/offline-save.js';
import {createCharacterOrientation} from '../src/character-orientation.js';
const OFFLINE_SAVE_KEY=slotKey(1);

function fixture(existing = null) {
  const items=new Map();
  if (existing) items.set(OFFLINE_SAVE_KEY, existing);
  const storage={
    getItem:key=>items.get(key)??null,
    setItem:(key,value)=>items.set(key,value),
    removeItem:key=>items.delete(key),
  };
  const elements=new Map();
  const $=id=>{if(!elements.has(id))elements.set(id,{textContent:''});return elements.get(id);};
  const added=[];
  const ctx={terrain:flatTerrain(),
    seed:678,wood:7,cuts:3,px:10,pz:-12,feetY:.58,verticalSpeed:0,onGround:true,yaw:.5,pitch:-.25,
    felled:new Set(['0,0:1']),treeDamage:new Map([['0,0:3',4]]),
    placed:[{x:2,z:3,height:0,orientation:1,mesh:{}}],
    dayCycle:{offlinePhase:.375,
      setOfflinePhase(value){this.offlinePhase=value;},
      resetOffline(){this.offlinePhase=0;}},
    crafting:{stored:[],snapshot(){return this.stored.map(x=>({...x}))},add(item){this.stored.push(item);return true},get items(){return new Map(this.stored.map((x,i)=>[i,x]))}},
    logRadius:.29,scene:{add:mesh=>added.push(mesh)},
    makeLog:()=>({
      position:{set(x,y,z){Object.assign(this,{x,y,z});}},
      rotation:{y:0,z:Math.PI/2,set(x,y,z){Object.assign(this,{x,y,z});}},
    }),$,
  };
  const save=createOfflineSave(ctx,{storage,now:()=>1000,setTimer:()=>1,clearTimer:()=>{}});
  return {ctx,storage,items,save,added,$};
}

test('offline save roundtrip restores seed, tree states, logs, wood and player position',()=>{
  const first=fixture();
  assert.equal(first.save.save(),true);
  const payload=first.storage.getItem(OFFLINE_SAVE_KEY);
  assert.equal(JSON.parse(payload).version,1);
  const next=fixture(payload);
  next.ctx.seed=111;next.ctx.felled.clear();next.ctx.treeDamage.clear();
  next.ctx.placed=[];next.ctx.wood=0;next.ctx.cuts=0;next.ctx.px=0;
  assert.equal(next.save.restore(),true);
  assert.equal(next.ctx.seed,678);
  assert.equal(next.ctx.dayCycle.offlinePhase,.375);
  assert.deepEqual([...next.ctx.felled],['0,0:1']);
  assert.deepEqual([...next.ctx.treeDamage],[['0,0:3',4]]);
  assert.equal(next.ctx.wood,7);
  assert.equal(next.ctx.cuts,3);
  assert.equal(next.ctx.px,10);
  assert.equal(next.ctx.feetY,.58);
  assert.equal(next.ctx.pz,-12);
  assert.equal(next.ctx.yaw,.5);
  assert.equal(next.ctx.placed.length,1);
  assert.equal(next.ctx.placed[0].orientation,1);
  assert.equal(next.ctx.placed[0].y,.29);
  assert.equal(next.added.length,1);
  assert.equal(next.$('wood').textContent,7);
  assert.equal(next.$('cut').textContent,3);
});

test('invalid or large saves do not mutate the current world',()=>{
  const base=fixture();
  assert.equal(base.save.restore(),false);
  const valid=JSON.parse(JSON.stringify({
    version:1,seed:678,wood:7,cuts:3,felled:['0,0:1'],damage:{'0,0:3':4},
    logs:[{x:2,z:3,height:0,orientation:1}],
    position:{x:10,z:12,yaw:0,pitch:0},
  }));
  assert.ok(parseOfflineSave(JSON.stringify(valid)));
  assert.equal(parseOfflineSave('broken json'),null);
  assert.equal(parseOfflineSave(' '.repeat(1_500_001)),null);
  assert.equal(parseOfflineSave(JSON.stringify({...valid,version:2})),null);
  assert.equal(parseOfflineSave(JSON.stringify({...valid,logs:[{x:NaN,z:3,height:0,orientation:1}]})),null);
  assert.equal(parseOfflineSave(JSON.stringify({...valid,felled:['../sensitive']})),null);
  assert.equal(parseOfflineSave(JSON.stringify({...valid,position:{x:Infinity,z:0,yaw:0,pitch:0}})),null);
  assert.ok(parseOfflineSave(JSON.stringify({...valid,position:{x:0,y:25,z:0,yaw:0,pitch:0}})),
    'high-altitude terrain and mountain saves are valid');
  assert.equal(parseOfflineSave(JSON.stringify({...valid,position:{x:0,y:250000,z:0,yaw:0,pitch:0}})),null);
  const invalid=fixture(JSON.stringify({...valid,damage:{'0,0:2':'invalid'}}));
  assert.equal(invalid.save.restore(),false);
  assert.equal(invalid.ctx.seed,678);
  assert.equal(invalid.ctx.placed.length,1);
});

test('joining multiplayer flushes the offline snapshot and suspends all further writes',()=>{
  const {ctx,save,storage}=fixture();
  save.suspend();
  assert.equal(save.suspended,true);
  const before=storage.getItem(OFFLINE_SAVE_KEY);
  ctx.wood=400;ctx.felled.clear();ctx.placed.length=0; // Simulated authoritative world replacement
  save.markDirty();
  assert.equal(save.save(),false);
  assert.equal(storage.getItem(OFFLINE_SAVE_KEY),before);
  save.reset();
  assert.equal(save.suspended,false);
  assert.equal(storage.getItem(OFFLINE_SAVE_KEY),null);
  assert.equal(save.save(),true);
  assert.equal(JSON.parse(storage.getItem(OFFLINE_SAVE_KEY)).wood,400);
});

test('saved bench recipe restores without changing old version 1 saves',()=>{
  const original=fixture();
  original.ctx.crafting.stored=[{kind:'bench',x:4,z:0,orientation:0}];
  assert.equal(original.save.save(),true);
  const saved=original.storage.getItem(OFFLINE_SAVE_KEY);
  assert.equal(JSON.parse(saved).version,1);
  assert.equal(parseOfflineSave(saved).furniture.length,1);
  const restored=fixture(saved);
  restored.ctx.crafting.stored=[];
  assert.equal(restored.save.restore(),true);
  assert.deepEqual(restored.ctx.crafting.snapshot().map(({kind,x,z,orientation})=>({kind,x,z,orientation})),
    [{kind:'bench',x:4,z:0,orientation:0}]);
  const older=JSON.parse(saved);delete older.furniture;
  assert.deepEqual(parseOfflineSave(JSON.stringify(older)).furniture,[]);
  assert.equal(parseOfflineSave(JSON.stringify({...older,furniture:[{kind:'bench',x:1.25,z:0,orientation:0}]})),null);
  assert.equal(parseOfflineSave(JSON.stringify({...older,furniture:Array.from({length:201},()=>({kind:'bench',x:1,z:0,orientation:0}))})),null);
});


test('boxes save their UTC expiry, reload until the 60-minute deadline, then stay gone',()=>{
  const original=fixture();
  const expiresAt=Date.now()/1000+3600;
  const dropped={id:10,x:5,z:-4,expires_at:expiresAt,item:{id:'stone',count:3}};
  original.ctx.groundBoxes={snapshot:()=>[dropped]};
  assert.equal(original.save.save(),true);
  const saved=original.storage.getItem(OFFLINE_SAVE_KEY);
  const parsed=parseOfflineSave(saved);
  assert.deepEqual(parsed.boxes,[dropped]);
  const older=JSON.parse(saved);
  older.boxes[0].expires_at=Date.now()/1000-1;
  assert.deepEqual(parseOfflineSave(JSON.stringify(older)).boxes,[]);
  older.boxes[0].expires_at=expiresAt;
  older.boxes[0].item={id:'stone',count:999};
  assert.equal(parseOfflineSave(JSON.stringify(older)),null);
  const restored=fixture(saved);
  let actual=[];
  restored.ctx.groundBoxes={set(list){actual=list;}};
  assert.equal(restored.save.restore(),true);
  assert.deepEqual(actual,[dropped]);
});

test('collected seeded resources keep respawn deadlines across offline saves',()=>{
  const original=fixture();
  const now=Date.now()/1000;
  const deadline=now+300;
  const cooldowns={'-1,0:0':deadline,'2,-3:1':now+500};
  original.ctx.forestResources={snapshotCooldowns:()=>cooldowns};
  assert.equal(original.save.save(),true);
  const payload=original.storage.getItem(OFFLINE_SAVE_KEY);
  assert.deepEqual(parseOfflineSave(payload).resource_cooldowns,cooldowns);
  const restored=fixture(payload);
  let accepted=null;
  restored.ctx.forestResources={restoreCooldowns(value){accepted=value;return true;}};
  assert.equal(restored.save.restore(),true);
  assert.deepEqual(accepted,cooldowns);
  const stale=JSON.parse(payload);
  stale.resource_cooldowns['-1,0:0']=now-1;
  assert.deepEqual(parseOfflineSave(JSON.stringify(stale)).resource_cooldowns,
    {'2,-3:1':cooldowns['2,-3:1']});
  stale.resource_cooldowns['invalid-id']=now+10;
  assert.equal(parseOfflineSave(JSON.stringify(stale)),null);
  delete stale.resource_cooldowns['invalid-id'];
  stale.resource_cooldowns['-1,0:0']=now+50000;
  assert.equal(parseOfflineSave(JSON.stringify(stale)),null);
});

test('collected flowers and mushrooms use existing resource cooldowns in offline saves',()=>{
  const original=fixture();
  const now=Date.now()/1000;
  const deadlines={'d:0,0:17':now+200,'d:-1,2:4':now+580};
  original.ctx.forestResources={snapshotCooldowns:()=>deadlines};
  original.ctx.groundBoxes={snapshot:()=>[{
    id:6,x:2,z:-1,expires_at:now+3600,item:{id:'mushroom:milkcap',count:4},
  }]};
  assert.equal(original.save.save(),true);
  const payload=original.storage.getItem(OFFLINE_SAVE_KEY);
  const parsed=parseOfflineSave(payload);
  assert.deepEqual(parsed.resource_cooldowns,deadlines);
  assert.equal(parsed.boxes[0].item.id,'mushroom:milkcap');
  const restored=fixture(payload);
  let actual=null;
  restored.ctx.forestResources={restoreCooldowns(value){actual=value;return true;}};
  assert.equal(restored.save.restore(),true);
  assert.deepEqual(actual,deadlines);
  const malformed=JSON.parse(payload);
  malformed.resource_cooldowns['d:0,0:25']=now+100;
  assert.equal(parseOfflineSave(JSON.stringify(malformed)),null);
});

test('survival vitals roundtrip and legacy saves restore full health',()=>{
 const original=fixture();
 const vitals={health:2,hunger:1,hungerProgress:172};
 original.ctx.vitals={serialize(){return vitals;}};
 assert.equal(original.save.save(),true);
 const raw=original.storage.getItem(OFFLINE_SAVE_KEY);
 assert.deepEqual(parseOfflineSave(raw).vitals,vitals);
 const restored=fixture(raw);
 let actual=null;
 restored.ctx.vitals={restore(x){actual=x;return true;}};
 assert.equal(restored.save.restore(),true);
 assert.deepEqual(actual,vitals);
 const legacy=JSON.parse(raw);delete legacy.vitals;
 assert.equal(parseOfflineSave(JSON.stringify(legacy)).vitals,null);
 const invalid={...legacy,vitals:{health:6,hunger:3,hungerProgress:0}};
 assert.equal(parseOfflineSave(JSON.stringify(invalid)),null);
 invalid.vitals={health:4,hunger:1,hungerProgress:300};
 assert.equal(parseOfflineSave(JSON.stringify(invalid)),null);
});

test('old offline saves default to daytime and reject invalid clock phases',()=>{
  const f=fixture();
  f.save.save();
  const saved=JSON.parse(f.storage.getItem(OFFLINE_SAVE_KEY));
  assert.equal(saved.dayPhase,.375);
  delete saved.dayPhase;
  assert.equal(parseOfflineSave(JSON.stringify(saved)).dayPhase,0);
  const older=fixture(JSON.stringify(saved));
  assert.equal(older.save.restore(),true);
  assert.equal(older.ctx.dayCycle.offlinePhase,0);
  for(const phase of [-.01,1,Infinity,'0.5',null]){
    assert.equal(parseOfflineSave(JSON.stringify({...saved,dayPhase:phase})),null);
  }
});

test('multiplayer started from menu suspends writes without overwriting the solo save',()=>{
  const original=fixture();
  original.save.save();
  const bytes=original.storage.getItem(OFFLINE_SAVE_KEY);
  const next=fixture(bytes);
  next.ctx.seed=999999;
  next.save.suspend({flush:false});
  assert.equal(next.save.suspended,true);
  assert.equal(next.save.save(),false);
  assert.equal(next.storage.getItem(OFFLINE_SAVE_KEY),bytes);
});

test('legacy permanent fallen logs migrate once to a saved one-hour TTL',()=>{
  const original=fixture();
  const legacy={id:22,x:3,z:6,kind:'fallen_logs',
    direction:.3,mask:0b101,expires_at:0,item:{id:'log',count:2}};
  original.ctx.groundBoxes={snapshot:()=>[legacy]};
  assert.equal(original.save.save(),true);
  const raw=original.storage.getItem(OFFLINE_SAVE_KEY);
  const preview=parseOfflineSave(raw);
  assert.equal(preview.migrateLegacyFallenLogs,true);
  assert.ok(preview.boxes[0].expires_at>Date.now()/1000+3595);
  const loaded=fixture(raw);
  let items=[];
  loaded.ctx.groundBoxes={
    set(boxes){items=boxes},
    snapshot(){return items},
  };
  assert.equal(loaded.save.restore(),true);
  assert.equal(items.length,1);
  assert.deepEqual(items[0].item,{id:'log',count:2});
  assert.equal(items[0].mask,0b101);
  const migratedRaw=loaded.storage.getItem(OFFLINE_SAVE_KEY);
  assert.notEqual(migratedRaw,raw,'migration is committed immediately');
  const deadline=items[0].expires_at;
  assert.equal(parseOfflineSave(migratedRaw).migrateLegacyFallenLogs,false);
  assert.equal(parseOfflineSave(migratedRaw).boxes[0].expires_at,deadline);
  const reloaded=fixture(migratedRaw);
  reloaded.ctx.groundBoxes={set(boxes){items=boxes;}};
  assert.equal(reloaded.save.restore(),true);
  assert.equal(items[0].expires_at,deadline,'reloading does not restart the countdown');
  const expired=JSON.parse(migratedRaw);
  expired.boxes[0].expires_at=Date.now()/1000-1;
  assert.deepEqual(parseOfflineSave(JSON.stringify(expired)).boxes,[]);
});

test('camp structures persist and older v1 offline saves default to no camp',()=>{
  const original=fixture();
  const list=[
    {id:-1,kind:'campfire',x:2,z:3,orientation:0,lit:true},
    {id:-2,kind:'table',x:8,z:3,orientation:1,lit:false},
  ];
  original.ctx.campStructures={snapshot(){return list}};
  assert.equal(original.save.save(),true);
  const raw=original.storage.getItem(OFFLINE_SAVE_KEY);
  assert.deepEqual(parseOfflineSave(raw).camp_structures,list);
  const loaded=fixture(raw);
  let restored;
  loaded.ctx.campStructures={set(next){restored=next}};
  assert.equal(loaded.save.restore(),true);
  assert.deepEqual(restored,list);
  const legacy=JSON.parse(raw);
  delete legacy.camp_structures;
  assert.deepEqual(parseOfflineSave(JSON.stringify(legacy)).camp_structures,[]);
  for(const bad of [
    [{...list[0],lit:'true'}],
    [{...list[0],kind:'unknown'}],
    [{...list[0],orientation:5}],
    Array.from({length:101},()=>list[0]),
  ])assert.equal(parseOfflineSave(JSON.stringify({...legacy,camp_structures:bad})),null);
});

test('legacy placed logs are invalidated without losing other saved world data',()=>{
 const source=fixture();
 source.save.save();
 const payload=JSON.parse(source.storage.getItem(OFFLINE_SAVE_KEY));
 payload.logs=[{x:1,z:2,level:2,orientation:0},{x:2,z:3,height:0,orientation:1}];
 const parsed=parseOfflineSave(JSON.stringify(payload));
 assert.equal(parsed.logs.length,1);
 assert.deepEqual(parsed.logs[0],{x:2,z:3,height:0,orientation:1});
 assert.equal(parsed.wood,source.ctx.wood);
 assert.deepEqual(parsed.felled,['0,0:1']);
 const target=fixture(JSON.stringify(payload));
 target.ctx.placed=[];
 assert.equal(target.save.restore(),true);
 assert.equal(target.ctx.placed.length,1);
 assert.equal(target.ctx.placed[0].height,0);
});

test('offline save preserves valid bed spawn and one-hour death marker',()=>{
 const original=fixture();
 const future=Date.now()/1000+300;
 original.ctx.campStructures={snapshot:()=>[{kind:'bed',id:-4,x:10,z:20,orientation:0,lit:false}]};
 original.ctx.deathSystem={snapshot:()=>({bedId:-4,marker:{x:7,z:8,expires_at:future}})};
 assert.equal(original.save.save(),true);
 const raw=original.storage.getItem(OFFLINE_SAVE_KEY);
 const parsed=parseOfflineSave(raw);
 assert.equal(parsed.death.bedId,-4);
 assert.equal(parsed.death.marker.expires_at,future);
 const expired={...JSON.parse(raw)};
 expired.death={bedId:-4,marker:{x:7,z:8,expires_at:Date.now()/1000-10}};
 assert.ok(parseOfflineSave(JSON.stringify(expired)),
  'expired marker must not invalidate the entire world save');
 assert.equal(parseOfflineSave(JSON.stringify({...expired,death:{bedId:-4,marker:{x:'invalid',z:8,expires_at:future}}})),null);
});

test('debug snapshot loads without overwriting the existing persisted solo game',()=>{
 const f=fixture();
 assert.equal(f.save.save(),true);
 const original=f.storage.getItem(OFFLINE_SAVE_KEY);
 const debug=JSON.parse(original);
 debug.seed=12345;
 debug.position={x:41,z:51,y:0,yaw:0,pitch:0};
 debug.logs=[];
 let cleared=0;
 f.ctx.clearWorld=()=>{cleared++;f.ctx.placed.length=0;};
 f.ctx.updateChunks=()=>{};
 f.save.suspend({flush:false});
 assert.equal(f.save.restoreSnapshot(JSON.stringify(debug),{replace:true}),true);
 assert.equal(cleared,1);
 assert.equal(f.ctx.seed,12345);
 assert.equal(f.ctx.px,41);
 assert.equal(f.ctx.pz,51);
 assert.equal(f.save.save(),false);
 assert.equal(f.storage.getItem(OFFLINE_SAVE_KEY),original,
   'the benchmark must not replace the ordinary world save');
 assert.equal(f.save.restoreSnapshot('malformed',{replace:true}),false);
 assert.equal(cleared,1,'an invalid fixture must not clear the active world');
});

test('10,000 drops round-trip through v1 offline save, 10,001 is rejected',()=>{
 const f=fixture();
 const expires=Date.now()/1000+3600;
 const boxes=Array.from({length:10000},(_,i)=>({
   id:i+1,x:5+(i%100)*.08,z:10+Math.floor(i/100)*.08,
   expires_at:expires,item:{id:'stone',count:1},
 }));
 f.ctx.groundBoxes={snapshot:()=>boxes};
 assert.equal(f.save.save(),true,'10k objects must fit within the allowed snapshot size');
 const raw=f.storage.getItem(OFFLINE_SAVE_KEY);
 assert.equal(parseOfflineSave(raw)?.boxes.length,10000);
 const invalid=JSON.parse(raw);
 invalid.boxes.push({id:10001,x:5,z:10,expires_at:expires,item:{id:'stone',count:1}});
 assert.equal(parseOfflineSave(JSON.stringify(invalid)),null,
   'validation must enforce the same limit as runtime');
 f.ctx.groundBoxes.snapshot=()=>invalid.boxes;
 assert.equal(f.save.save(),false,'saver must not write an oversized box count');
 assert.equal(f.storage.getItem(OFFLINE_SAVE_KEY),raw,
   'failed snapshot must not overwrite the previously valid save');
});

test('slots preserve independent worlds and metadata across save and restore',()=>{
  const first=fixture();
  first.ctx.logsCollected=4;
  first.save.save();
  const one=first.storage.getItem(slotKey(1));
  const second=createOfflineSave(first.ctx,{storage:first.storage,slot:2});
  first.ctx.seed=321; first.ctx.logsCollected=9; second.save();
  assert.equal(first.storage.getItem(slotKey(1)),one);
  const saved=JSON.parse(first.storage.getItem(slotKey(2)));
  assert.equal(saved.seed,321);assert.equal(saved.logsCollected,9);
  assert.ok(saved.createdAt>0 && saved.savedAt>=saved.createdAt);
  first.ctx.logsCollected=0;first.ctx.seed=0;
  assert.equal(second.restore(),true);assert.equal(first.ctx.logsCollected,9);assert.equal(first.ctx.seed,321);
  second.reset();assert.equal(first.storage.getItem(slotKey(1)),one);
  assert.equal(first.storage.getItem(slotKey(2)),null);
});

test('preparing a replacement preserves the old world until the new snapshot is written',()=>{
 const f=fixture();f.save.save();const old=f.storage.getItem(slotKey(1));
 f.save.reset({preserve:true});assert.equal(f.storage.getItem(slotKey(1)),old);
 f.ctx.seed=987;f.save.save();assert.equal(JSON.parse(f.storage.getItem(slotKey(1))).seed,987);
});

test('hen state uses the selected world snapshot and malformed animal data is rejected',async()=>{
 const {createHenWorld}=await import('../src/hen-rules.js');
 const f=fixture();const hens=createHenWorld({seed:f.ctx.seed});
 const r=hens.tick(0,[{x:0,z:0}])[0];hens.hit(r.id);
 f.ctx.hens=hens;const state=f.save.snapshot();
 assert.ok(state.hens.corpses.length===1);
 const parsed=parseOfflineSave(JSON.stringify(state));assert.ok(parsed);
 assert.equal(parsed.hens.corpses[0].id,r.id);
 assert.equal(parseOfflineSave(JSON.stringify({...state,hens:{version:1,clock:Infinity}})),null);
 assert.equal(parseOfflineSave(JSON.stringify({...state,hens:{...state.hens,seed:98765}})),null);
});

test('new mob save envelope validates and reloads, retaining old hen saves as a read fallback',async()=>{
 const {createMobWorld}=await import('../src/mob-world.js');
 const f=fixture(),world=createMobWorld({seed:f.ctx.seed});
 const animal=world.tick(0,[{x:0,z:0}])[0];world.hit(animal.id,{id:'p',faction:'players',x:animal.x-1,z:animal.z});
 f.ctx.mobs=world;const state=f.save.snapshot();assert.equal(state.hens,undefined);assert.ok(state.mobs.populations.chicken);
 const parsed=parseOfflineSave(JSON.stringify(state));assert.ok(parsed);assert.ok(parsed.mobs.populations.chicken.corpses.some(r=>r.id===animal.id));
 const before=world.snapshot();assert.equal(f.save.restoreSnapshot(JSON.stringify(state),{replace:false}),true);
 assert.deepEqual(world.snapshot(),before);
 const bad=structuredClone(state);bad.mobs.populations.unknown=bad.mobs.populations.chicken;assert.equal(parseOfflineSave(JSON.stringify(bad)),null);
});

test('loading a pre-orientation save initializes legs and torso from saved camera yaw',()=>{
 const earlier=fixture();
 assert.equal(earlier.save.save(),true);
 const saved=earlier.storage.getItem(OFFLINE_SAVE_KEY);
 const current=fixture(saved);
 const pose=createCharacterOrientation({cameraYaw:-2.5,cameraPitch:.1});
 pose.legsYaw=1.3;pose.torsoYaw=2.4;
 Object.defineProperties(current.ctx,{
  yaw:{get(){return pose.cameraYaw},set(value){pose.cameraYaw=value}},
  pitch:{get(){return pose.cameraPitch},set(value){pose.cameraPitch=value}},
 });
 current.ctx.characterOrientation=pose;
 assert.equal(current.save.restore(),true);
 assert.equal(pose.cameraYaw,.5);
 assert.equal(pose.legsYaw,.5,'restored avatar must not rotate unexpectedly on first frame');
 assert.equal(pose.torsoYaw,.5);
 assert.equal(pose.cameraPitch,-.25);
});
