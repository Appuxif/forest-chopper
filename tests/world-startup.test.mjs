import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  WORLD_STARTUP_MIN_MS,WORLD_STARTUP_MAX_MS,WORLD_STARTUP_SETTLE_MS,
  sampleWorldStartup,createWorldStartupGate,
} from '../src/world-startup.js';

function world(){
  const chunks=new Map(),terrainChunks=new Map();
  const ctx={
    px:0,pz:0,chunkSize:24,radius:3,
    chunks,
    terrain:{chunkSize:96,chunks:terrainChunks},
    microGrass:{nearPending:5,nearDesired:30},
    distantForest:{chunkCount:0,desiredChunkCount:110},
    isOnline:()=>true,
  };
  const fill=()=>{
    for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)
      chunks.set(x+','+z,{});
    for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)
      terrainChunks.set(x+','+z,{});
    ctx.microGrass.nearPending=0;
    ctx.distantForest.chunkCount=24;
  };
  return {ctx,fill};
}
function gate(online=false,options={}){
  const node={removed:false,textContent:''};
  const loading={remove(){this.removed=true;},querySelector:()=>node};
  return {node,loading,instance:createWorldStartupGate({loading,online,...options})};
}
test('does not reveal the world before spawn terrain, trees, grass and distant forest arrive',()=>{
  const {ctx,fill}=world();
  const {instance,loading,node}=gate();
  assert.equal(instance.tick(0,ctx),false);
  assert.equal(node.textContent,'Генерируем рельеф…');
  assert.equal(instance.tick(300,ctx),false);
  fill();
  assert.equal(sampleWorldStartup(ctx).ready,true);
  assert.equal(instance.tick(500,ctx),false,'must settle after readiness');
  assert.equal(instance.tick(WORLD_STARTUP_MIN_MS,ctx),true);
  assert.equal(instance.reason,'ready');
  assert.equal(loading.removed,true);
  assert.equal(instance.tick(10000,ctx),true,'one-shot removal');
});
test('five-second deadline handles stalled, workerless or partial worlds',()=>{
  const {ctx}=world();
  const {instance,loading}=gate();
  assert.equal(instance.tick(10,ctx),false);
  assert.equal(instance.tick(5009,ctx),false);
  assert.equal(instance.tick(5010,ctx),true);
  assert.equal(instance.reason,'timeout');
  assert.equal(loading.removed,true);
});
test('server welcome must precede readiness in multiplayer and timeout reveals retry UI',()=>{
  const {ctx,fill}=world();
  fill();
  const panel={style:{display:'none'}};
  ctx.$=id=>id==='network'?panel:null;
  ctx.isOnline=()=>false;
  const {instance}=gate(true);
  assert.equal(sampleWorldStartup(ctx,{online:true}).ready,false);
  instance.tick(0,ctx);
  assert.equal(instance.tick(WORLD_STARTUP_MAX_MS,ctx),true);
  assert.equal(panel.style.display,'block');
});
test('online ready world reveals promptly after first rendered frames',()=>{
  const {ctx,fill}=world();fill();
  const {instance}=gate(true);
  assert.equal(instance.tick(100,ctx),false);
  assert.equal(instance.tick(100+WORLD_STARTUP_SETTLE_MS,ctx),false);
  assert.equal(instance.tick(100+WORLD_STARTUP_MIN_MS,ctx),true);
  assert.equal(instance.reason,'ready');
});
test('readiness follows current spawn position and does not trust chunks from another location',()=>{
  const {ctx,fill}=world();fill();
  assert.equal(sampleWorldStartup(ctx).ready,true);
  ctx.px=2400;
  assert.equal(sampleWorldStartup(ctx).ready,false);
});
test('empty distant forest and empty grass tiles are handled as valid completed work',()=>{
  const {ctx,fill}=world();fill();
  ctx.distantForest={chunkCount:0,desiredChunkCount:0};
  assert.equal(sampleWorldStartup(ctx).ready,true,
    'a world without any distant-tree candidates should not get stuck');
});


test('loading completion unlocks the HUD exactly once on ready world',()=>{
  const {ctx,fill}=world();
  const reasons=[];
  const {instance,loading}=gate(false,{onComplete:reason=>{
    assert.equal(loading.removed,true,'loading overlay must be gone when HUD is revealed');
    reasons.push(reason);
  }});
  assert.equal(instance.tick(0,ctx),false);
  assert.deepEqual(reasons,[],'do not reveal before the world is ready');
  fill();
  assert.equal(instance.tick(500,ctx),false);
  assert.deepEqual(reasons,[]);
  assert.equal(instance.tick(3000,ctx),true);
  assert.deepEqual(reasons,['ready']);
  assert.equal(instance.tick(6000,ctx),true);
  assert.deepEqual(reasons,['ready'],'never reveal more than once');
});

test('timeout also unlocks the HUD once instead of leaving it hidden forever',()=>{
  const {ctx}=world();
  const reasons=[];
  const {instance}=gate(false,{onComplete:reason=>reasons.push(reason)});
  assert.equal(instance.tick(0,ctx),false);
  assert.deepEqual(reasons,[]);
  assert.equal(instance.tick(WORLD_STARTUP_MAX_MS,ctx),true);
  assert.equal(instance.tick(WORLD_STARTUP_MAX_MS+1000,ctx),true);
  assert.deepEqual(reasons,['timeout']);
});

test('startup loading mask hides every HUD mount while allowing the loading screen',()=>{
  const css=readFileSync(new URL('../src/main-menu.css',import.meta.url),'utf8');
  const menu=readFileSync(new URL('../src/main-menu.js',import.meta.url),'utf8');
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(css,/body\.fc-world-loading #game > :not\(#load\)/,
    'hide game-mounted HUD and canvas, but not the loading screen');
  assert.match(css,/body\.fc-world-loading > :not\(#game\):not\(#mainmenu\)/,
    'hide dynamically created body-mounted HUD');
  assert.match(css,/opacity:0!important/);
  assert.match(css,/pointer-events:none!important/);
  assert.match(menu,/document\.body\.classList\.add\('fc-world-loading'\)/);
  assert.match(menu,/document\.body\.classList\.remove\('fc-world-loading'\)/,
    'startup failure must restore the main menu without a stale mask');
  assert.match(main,/onComplete:\(\)=>document\.body\.classList\.remove\('fc-world-loading'\)/);
});
