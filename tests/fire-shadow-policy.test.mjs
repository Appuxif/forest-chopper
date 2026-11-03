import test from 'node:test';
import assert from 'node:assert/strict';
import {fireShadowPolicy,applyFireShadowPolicy,selectFireShadowSources,FIRE_SHADOW_LIMIT,STARTER_FIRE_ID} from '../src/fire-shadow-policy.js';

test('point-light shadow maps update only during deep night',()=>{
 const config={settings:{fireShadows:true,performancePreset:'high'},
   selected:true,visible:true,distance:4,radius:30};
 for(const night of [0,.25,.8,.998]){
  assert.deepEqual(fireShadowPolicy({...config,night}),{castShadow:false,autoUpdate:false});
 }
 assert.deepEqual(fireShadowPolicy({...config,night:1}),{castShadow:true,autoUpdate:true});
 for(const settings of [{fireShadows:false},{performancePreset:'low'}]){
  assert.equal(fireShadowPolicy({...config,night:1,settings}).castShadow,false);
 }
 assert.deepEqual(fireShadowPolicy({...config,night:1,selected:false}),
   {castShadow:true,autoUpdate:false},
   'a non-selected lamp keeps its cached shadows instead of disabling them');
 assert.equal(fireShadowPolicy({...config,night:1,visible:false}).autoUpdate,false);
 assert.equal(fireShadowPolicy({...config,night:1,distance:40}).castShadow,false);
});
test('turning off fire shadows disables cubemap update without global renderer mutations',()=>{
 const light={castShadow:false,shadow:{needsUpdate:false,autoUpdate:false}};
 applyFireShadowPolicy(light,{castShadow:true,autoUpdate:true});
 assert.equal(light.castShadow,true);
 assert.equal(light.shadow.autoUpdate,true);
 assert.equal(light.shadow.needsUpdate,true);
 applyFireShadowPolicy(light,{castShadow:false,autoUpdate:false});
 assert.deepEqual(light,{castShadow:false,shadow:{needsUpdate:false,autoUpdate:false}});
});


test('two eligible nearest sources win across built and starter fires',()=>{
 assert.equal(FIRE_SHADOW_LIMIT,2);
 const candidates=[
  {id:44,distance:12,radius:30,visible:true},
  {id:STARTER_FIRE_ID,distance:3,radius:30,visible:true},
  {id:11,distance:1,radius:30,visible:true},
  {id:27,distance:2,radius:30,visible:false},
  {id:39,distance:33,radius:30,visible:true},
 ];
 assert.deepEqual([...selectFireShadowSources(candidates)],[11,STARTER_FIRE_ID]);
 assert.deepEqual([...selectFireShadowSources(candidates,3)],[11,STARTER_FIRE_ID,44]);
 assert.deepEqual([...selectFireShadowSources(candidates,0)],[]);
 assert.deepEqual([...selectFireShadowSources(candidates.filter(x=>x.id!==STARTER_FIRE_ID))],[11,44]);
});

test('shadow source cap 0–4 is bounded even when clients provide invalid input',()=>{
 const candidates=Array.from({length:5},(_,id)=>({id,distance:id+1,radius:30,visible:true}));
 for(let n=0;n<=4;n++)
  assert.deepEqual([...selectFireShadowSources(candidates,n)],Array.from({length:n},(_,id)=>id));
 assert.equal(selectFireShadowSources(candidates,100).size,4);
 assert.equal(selectFireShadowSources(candidates,-1).size,0);
 assert.equal(selectFireShadowSources(candidates,1.3).size,2);
});

test('split 100m static emitter can be selected far away while default selection stays 30m',()=>{
 const sources=[{id:9,visible:true,distance:70,radius:100}];
 assert.equal(selectFireShadowSources(sources,2).size,0);
 assert.deepEqual([...selectFireShadowSources(sources,2,100)],[9]);
 assert.equal(fireShadowPolicy({night:1,distance:70,radius:100}).castShadow,false);
 assert.equal(fireShadowPolicy({night:1,distance:70,radius:100,maxRange:100}).castShadow,true);
});

test('cached shadows remain enabled even when live refresh budget is zero',()=>{
 const sources=[
  {id:'a',distance:2,radius:6,visible:true},
  {id:'b',distance:4,radius:6,visible:true},
  {id:'c',distance:5,radius:6,visible:true},
  {id:'d',distance:25,radius:6,visible:true},
 ];
 assert.deepEqual([...selectFireShadowSources(sources,2,100)],['a','b']);
 assert.deepEqual([...selectFireShadowSources(sources,0,100)],[]);
 for(const distance of [2,4,5,25])
  assert.deepEqual(fireShadowPolicy({night:1,distance,radius:30,selected:false,maxRange:100}),
   {castShadow:true,autoUpdate:false});
 assert.equal(fireShadowPolicy({night:1,distance:33,radius:30,selected:false,maxRange:100}).castShadow,false);
});
