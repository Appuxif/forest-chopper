import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFrameLimiter} from '../src/frame-limiter.js';

test('micrograss creation does not read crafting before initialization',()=>{
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const declaration=main.indexOf('let crafting=null;');
  const creation=main.indexOf('const microGrass=createMicroGrass(ctx);');
  assert.ok(declaration>=0 && declaration<creation,
    'crafting getter must be initialized before micro-grass first tick');
});

test('the game starts exactly one requestAnimationFrame chain',()=>{
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const player=readFileSync(new URL('../src/player.js',import.meta.url),'utf8');
  assert.equal((main.match(/requestAnimationFrame\(animate\)/g)??[]).length,1,
    'main.js must schedule the first frame only once');
  assert.equal((player.match(/requestAnimationFrame\(animate\)/g)??[]).length,1,
    'animate itself must schedule precisely one successor');
  assert.match(player,/if\(!limiter\.allow\(now,ctx\.settings\.maxFps\)\)return;/,
    'limiter should gate renderer, not the preceding physics and animation');
});

test('render limiter supports 30/60/144 FPS without doubling simulation',()=>{
  const samples=Array.from({length:144},(_,i)=>i*1000/144);
  for(const cap of [30,60,144]){
    const limiter=createFrameLimiter();
    const count=samples.filter(now=>limiter.allow(now,cap)).length;
    assert.ok(Math.abs(count-cap)<=1,`cap ${cap} accepted ${count} frames`);
  }
  const unlimited=createFrameLimiter();
  assert.ok(samples.every(now=>unlimited.allow(now,0)));
});
