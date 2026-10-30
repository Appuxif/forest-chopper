import test from 'node:test';
import assert from 'node:assert/strict';
import {createProgress,parseProgress,PROGRESS_KEY} from '../src/progress.js';

function fixture(existing=null) {
  const store=new Map();
  if(existing)store.set(PROGRESS_KEY,existing);
  const storage={
    getItem:key=>store.get(key)??null,
    setItem:(key,value)=>store.set(key,value),
  };
  const element=tag=>({
    tag,children:[],attributes:{},className:'',textContent:'',dataset:{},hidden:false,
    append(...nodes){this.children.push(...nodes);},
    replaceChildren(...nodes){this.children=nodes;},
    setAttribute(key,val){this.attributes[key]=val;},
  });
  const doc={
    head:element('head'),body:element('body'),createElement:element,
    addEventListener() {},
  };
  const toasts=[];let flush=null;
  const progress=createProgress({
    doc,storage,notify:(...args)=>toasts.push(args),start:{x:0,z:0},
    setTimer:fn=>{flush=fn;return 1;},clearTimer:()=>{flush=null;},
  });
  return {progress,toasts,store,flush:()=>{if(flush){const fn=flush;flush=null;fn();}}};
}

test('achievements unlock once on actual tree and log events; persist without repeated toasts',()=>{
  const f=fixture();
  assert.equal(f.progress.record('untrusted-event'),false);
  assert.equal(f.progress.record('tree-fell'),true);
  assert.equal(f.progress.record('log-placed'),true);
  assert.equal(f.progress.stats.trees,1);
  assert.equal(f.progress.stats.logs,1);
  assert.deepEqual(f.progress.unlocked.sort(),['first-log','first-tree']);
  for(let i=0;i<4;i++)f.progress.record('tree-fell');
  assert.equal(f.progress.stats.trees,5);
  assert.equal(f.progress.unlocked.includes('five-trees'),true);
  assert.equal(f.toasts.length,4); // includes the first completed mini-objective
  f.flush();
  const snapshot=f.store.get(PROGRESS_KEY);
  assert.equal(JSON.parse(snapshot).trees,5);
  const after=fixture(snapshot);
  assert.equal(after.progress.stats.trees,5);
  assert.equal(after.progress.unlocked.includes('five-trees'),true);
  assert.equal(after.toasts.length,0,'reload must not repeat unlocked toasts');
});

test('four mini-objectives use the shared counters, skip and persist their relative baseline',()=>{
  const f=fixture();
  assert.equal(f.progress.objective.index,0);
  for(let i=0;i<3;i++)f.progress.record('tree-fell');
  assert.equal(f.progress.objective.index,1);
  assert.equal(f.progress.objective.progress,0);
  for(let i=0;i<5;i++)f.progress.record('log-placed');
  assert.equal(f.progress.objective.index,2);
  assert.equal(f.progress.objective.goal,100);
  assert.equal(f.progress.skipObjective(),true);
  assert.equal(f.progress.objective.index,3);
  for(let i=0;i<4;i++){
    f.progress.resetPosition(i*24,0);
    f.progress.trackPosition(i*24,0,33);
  }
  assert.deepEqual(f.progress.objective,{index:4,done:true});
  assert.equal(f.progress.skipObjective(),false);
  f.flush();
  const reloaded=fixture(f.store.get(PROGRESS_KEY));
  assert.deepEqual(reloaded.progress.objective,{index:4,done:true});
  assert.equal(reloaded.toasts.length,0);
});

test('movement excludes jumps/teleports, counts unique seed-scoped chunks',()=>{
  const f=fixture();
  const p=f.progress;
  p.trackPosition(0,0,17);
  p.trackPosition(3,0,17);
  assert.equal(p.stats.distance,3);
  p.trackPosition(100,0,17);
  assert.equal(p.stats.distance,3,'teleport should not add travelled distance');
  p.trackPosition(101,0,17);
  assert.equal(p.stats.distance,4);
  p.resetPosition(0,0);
  p.trackPosition(0,0,18);
  assert.equal(p.stats.chunks,3); // seed:17 chunk 0 and 4, seed:18 chunk 0
  for(let i=1;i<=8;i++) {
    p.resetPosition(i*24,0);
    p.trackPosition(i*24,0,18);
  }
  assert.equal(p.unlocked.includes('explore-10'),true);
  assert.equal(p.stats.distance,4);
});

test('parseProgress rejects corrupt values, unexpected versions, overlong storage',()=>{
  const valid={version:1,trees:2,logs:1,distance:3.5,visited:['42:0,0','42:0,0']};
  assert.deepEqual(parseProgress(JSON.stringify(valid)).visited,['42:0,0']);
  assert.equal(parseProgress('oops'),null);
  assert.equal(parseProgress(JSON.stringify({...valid,version:2})),null);
  assert.equal(parseProgress(JSON.stringify({...valid,distance:-1})),null);
  assert.equal(parseProgress(JSON.stringify({...valid,visited:['__proto__']})),null);
  assert.equal(parseProgress(' '.repeat(250000)),null);
});
