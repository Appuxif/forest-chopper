import test from 'node:test';
import assert from 'node:assert/strict';
import {createDebugFps,FPS_HISTORY_LIMIT} from '../src/debug-fps.js';
import {readFileSync} from 'node:fs';
import {parseOfflineSave} from '../src/offline-save.js';

test('FPS collector samples actual rendered frames, frame times, draws and triangles each second',()=>{
 let time=0;
 const fps=createDebugFps({clock:()=>time});
 for(let i=0;i<140;i++){
  const now=i*1000/60;
  time=now;
  fps.frame(now,{drawCalls:12,triangles:34567,heapBytes:64*1024*1024});
 }
 const x=fps.samples;
 assert.equal(x.length,2);
 assert.ok(x[0].fps>=59&&x[0].fps<=62);
 assert.equal(x[0].phase,'idle');
 assert.equal(x[0].drawCalls,12);
 assert.equal(x[0].triangles,34567);
 assert.equal(x[0].heapMiB,64);
 assert.ok(x[0].frametimeP95Ms>16&&x[0].frametimeP95Ms<17);
 assert.equal(fps.stats().samples,2);
 assert.equal(fps.stats().meanDrawCalls,12);
});

test('sampler retains only 120 complete windows with phase filtering and resets',()=>{
 const fps=createDebugFps();
 assert.equal(FPS_HISTORY_LIMIT,120);
 for(let i=0;i<150;i++){
  fps.setPhase(i%2?'boxes':'baseline');
  fps.frame(i*2000);
  fps.frame(i*2000+1100,{drawCalls:2,triangles:6});
 }
 assert.equal(fps.samples.length,120);
 assert.equal(fps.stats({phase:'boxes'}).samples,60);
 assert.equal(fps.stats({phase:'baseline'}).samples,60);
 fps.stop();
 const before=fps.samples.length;
 fps.frame(999999);
 assert.equal(fps.samples.length,before);
 fps.reset();
 assert.deepEqual(fps.samples,[]);
});
test('500-box fixture is a regular version-1 offline save after TTL materialization',()=>{
 const path=new URL('../benchmarks/box-stress-500.json',import.meta.url);
 const raw=JSON.parse(readFileSync(path,'utf8'));
 assert.equal(raw.version,1);
 assert.equal(raw.boxes.length,500);
 assert.equal(new Set(raw.boxes.map(b=>b.id)).size,500);
 assert.equal(raw.boxes.every(b=>b.expires_at===0),true);
 assert.equal(parseOfflineSave(JSON.stringify(raw)).boxes.length,0);
 const asSave=JSON.stringify({...raw,boxes:raw.boxes.map(b=>({...b,
  expires_at:Date.now()/1000+3600}))});
 const restored=parseOfflineSave(asSave);
 assert.ok(restored);
 assert.equal(restored.boxes.length,500);
 assert.equal(restored.position.x,288);
 assert.equal(restored.seed,517013);
});

test('1000 and 1500-box fixtures retain the same seed and camera and fit offline save validation',()=>{
 const base=JSON.parse(readFileSync(new URL('../benchmarks/box-stress-500.json',import.meta.url),'utf8'));
 for(const count of [1000,1500,3000]){
   const candidate=JSON.parse(readFileSync(new URL('../benchmarks/box-stress-'+count+'.json',import.meta.url),'utf8'));
   assert.equal(candidate.seed,base.seed);
   assert.deepEqual(candidate.position,base.position);
   assert.equal(candidate.boxes.length,count);
   assert.equal(new Set(candidate.boxes.map(box=>box.id)).size,count);
   assert.ok(candidate.boxes.every(box=>box.expires_at===0&&box.item.id==='stone'&&box.item.count===1));
   const payload=JSON.stringify({...candidate,
     boxes:candidate.boxes.map(box=>({...box,expires_at:Date.now()/1000+3600}))});
   assert.equal(parseOfflineSave(payload)?.boxes.length,count);
 }
});
