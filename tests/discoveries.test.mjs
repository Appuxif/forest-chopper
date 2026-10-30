import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscoveries} from '../src/discoveries.js';
import {createProgress,parseProgress,PROGRESS_KEY} from '../src/progress.js';

function fixture(){
  const storage=new Map(),notifications=[];
  const elem=tag=>({tag,children:[],dataset:{},attributes:{},textContent:'',hidden:false,style:{},
    append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},
    setAttribute(k,v){this.attributes[k]=v}});
  const doc={createElement:elem,head:elem('head'),body:elem('body'),addEventListener() {}};
  let pending=null;
  const progress=createProgress({doc,storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    notify:(...args)=>notifications.push(args),setTimer:fn=>{pending=fn;return 1;}});
  const trees=new Map([['rare',{position:{x:2,z:1},userData:{id:'0,0:1',hp:8,rare:true,species:'birch'}}],
    ['normal',{position:{x:1,z:0},userData:{id:'0,0:2',hp:8,rare:false}}]]);
  const ctx={progress,notify:(...args)=>notifications.push(args),px:0,pz:0,seed:321,trees};
  const discoveries=createDiscoveries(ctx);
  return {ctx,discoveries,progress,notifications,storage,flush(){pending?.()}};
}
test('only genuine nearby rare tree triggers cosmetic discovery once; seed separates worlds',()=>{
  const f=fixture();
  f.ctx.px=10;f.discoveries.check(1000);
  assert.equal(f.progress.stats.discoveries,0);
  f.ctx.px=1;f.discoveries.check(1600);
  assert.equal(f.progress.stats.discoveries,1);
  assert.equal(f.progress.unlocked.includes('first-rare'),true);
  assert.ok(f.notifications.some(n=>n[0].includes('серебристое')));
  const count=f.notifications.length;
  f.discoveries.check(2000);
  assert.equal(f.notifications.length,count,'moving around the same tree must not unlock twice');
  f.ctx.seed=322;f.discoveries.check(3000);
  assert.equal(f.progress.stats.discoveries,2,'a distinct world seed counts separately');
  assert.equal(f.progress.stats.trees,0);
  assert.equal(f.progress.stats.logs,0);
  f.flush();
  const saved=JSON.parse(f.storage.get(PROGRESS_KEY));
  assert.equal(saved.discovered.length,2);
  assert.equal(saved.version,1);
});
test('legacy progress migrates and malformed discovered keys are rejected',()=>{
  const old={version:1,trees:2,logs:3,distance:12,visited:[],objective:{index:0,baseline:0}};
  assert.deepEqual(parseProgress(JSON.stringify(old)).discovered,[]);
  assert.equal(parseProgress(JSON.stringify({...old,discovered:['../secret']})),null);
  assert.deepEqual(parseProgress(JSON.stringify({...old,discovered:['321:0,0:1','321:0,0:1']})).discovered,['321:0,0:1']);
});
