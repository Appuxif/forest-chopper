import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WorldLRU,WorldTaskScheduler,WORLD_PRIORITY,
} from '../src/world-task-scheduler.js';
import {
  forestChunkData,terrainGridData,grassTileData,
} from '../src/world-stream-data.js';
import {terrainHeight} from '../src/terrain.js';
import {generateGrassTile} from '../src/micro-grass.js';
import {PERFORMANCE_PRESETS,presetSettings} from '../src/performance-presets.js';

test('medium and low disable MSAA; high and ultra retain it',()=>{
  for(const preset of ['medium','low'])assert.equal(PERFORMANCE_PRESETS[preset].antialias,false);
  for(const preset of ['high','ultra'])assert.equal(PERFORMANCE_PRESETS[preset].antialias,true);
  const settings=presetSettings('medium');
  settings.antialias=true;
  assert.equal(PERFORMANCE_PRESETS.medium.antialias,false,'returned preset must be a copy');
});

test('LRU cache evicts least-recently accessed values, counts bytes, handles oversized data',()=>{
  const cache=new WorldLRU(12);
  cache.put('one',new Uint8Array(4),4);
  cache.put('two',new Uint8Array(6),6);
  assert.equal(cache.get('one').byteLength,4);
  cache.put('three',new Uint8Array(5),5);
  assert.equal(cache.get('two'),null,'second key was least recently used');
  assert.equal(cache.bytes,9);
  cache.put('huge',new Uint8Array(100),100);
  assert.equal(cache.size,2,'oversized values must not evict useful entries');
  cache.put('one',new Uint8Array(2),2);
  assert.equal(cache.bytes,7);
  cache.clear();
  assert.equal(cache.bytes,0);
  assert.equal(cache.size,0);
});

test('workerless scheduler processes one fallback per tick in priority order',()=>{
  const scheduler=new WorldTaskScheduler({workerUrl:null});
  const completed=[];
  for(const [key,priority] of [
    ['prefetch',WORLD_PRIORITY.prefetch],
    ['visible',WORLD_PRIORITY.visible],
    ['collision',WORLD_PRIORITY.collision],
  ]){
    scheduler.schedule({key,kind:'terrain',payload:{},
      priority,fallback:()=>key,apply:value=>completed.push(value)});
  }
  scheduler.tick();
  assert.deepEqual(completed,['collision']);
  scheduler.tick();
  assert.deepEqual(completed,['collision','visible']);
  scheduler.tick();
  assert.deepEqual(completed,['collision','visible','prefetch']);
  assert.equal(scheduler.pending,0);
  scheduler.dispose();
});

test('canceled, superseded and reset jobs must never apply stale worker results',()=>{
  const original=globalThis.Worker;
  class FakeWorker{
    static instances=[];
    constructor(){this.sent=[];this.terminated=false;FakeWorker.instances.push(this);}
    postMessage(message){this.sent.push(message);}
    terminate(){this.terminated=true;}
    reply(result){this.onmessage({data:{result}});}
  }
  globalThis.Worker=FakeWorker;
  try{
    const scheduler=new WorldTaskScheduler({
      workerUrl:'fake-worker.js',workers:1,applyPerTick:4,applyMs:0,
    });
    const worker=FakeWorker.instances[0];
    const applied=[];
    const task=(key,tag)=>({key,kind:'forest',payload:{tag},
      apply:value=>applied.push(value),fallback:()=>tag});
    scheduler.schedule(task('chunk','stale'));
    assert.equal(worker.sent.length,1);
    scheduler.schedule(task('chunk','fresh'));
    worker.reply('ignored old');
    assert.equal(worker.sent.length,2);
    scheduler.tick();
    assert.deepEqual(applied,[]);
    worker.reply('new chunk');
    scheduler.tick();
    assert.deepEqual(applied,['new chunk']);

    scheduler.schedule(task('cancel','canceled'));
    scheduler.cancel('cancel');
    worker.reply('ignored canceled');
    scheduler.tick();
    assert.deepEqual(applied,['new chunk']);

    scheduler.schedule(task('generation','stale reset'));
    scheduler.reset();
    worker.reply('ignored reset');
    scheduler.tick();
    assert.deepEqual(applied,['new chunk']);
    assert.equal(scheduler.pending,0);
    scheduler.dispose();
    assert.equal(worker.terminated,true);
  }finally{
    if(original===undefined)delete globalThis.Worker;
    else globalThis.Worker=original;
  }
});

test('worker payloads are typed arrays and terrain grid has exact shared seams',()=>{
  const seed=2048,size=96,segments=24;
  const left=terrainGridData({seed,cx:-1,cz:2,size,segments});
  const right=terrainGridData({seed,cx:0,cz:2,size,segments});
  assert.ok(left instanceof Float64Array);
  assert.equal(left.length,(segments+3)**2);
  const stride=segments+3;
  for(let row=0;row<=segments;row++){
    const end=left[(row+1)*stride+segments+1];
    const start=right[(row+1)*stride+1];
    assert.equal(end,start,'border vertices of neighboring terrain chunks must match');
  }
  for(const [cx,cz] of [[0,0],[42,-9]]){
    const records=forestChunkData({seed,cx,cz});
    assert.ok(records instanceof Float64Array);
    assert.equal(records.length%7,0);
    assert.ok(records.length<=8*7);
    for(let i=0;i<records.length;i+=7){
      assert.equal(records[i+1],terrainHeight(seed,records[i],records[i+2]));
      assert.ok(Number.isInteger(records[i+6]));
    }
  }
});

test('worker grass payload includes height, color and glade attributes per blade',()=>{
  const seed=54321,tx=2,tz=-2,size=12,density=10,tier='near';
  const original=generateGrassTile(seed,tx,tz,size,density,tier);
  const data=grassTileData({seed,tx,tz,size,density,tier});
  assert.ok(data instanceof Float32Array);
  assert.equal(data.length,original.length*9);
  for(let i=0;i<Math.min(original.length,5);i++){
    const item=original[i],j=i*9;
    assert.ok(Math.abs(data[j]-item.x)<.0001);
    assert.ok(Math.abs(data[j+2]-item.z)<.0001);
    assert.ok(Math.abs(data[j+1]-terrainHeight(seed,item.x,item.z))<.0001);
    assert.ok(Math.abs(data[j+7]-item.patchKind)<.0001);
  }
});
