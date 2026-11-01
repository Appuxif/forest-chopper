import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDiagnostics, formatDiagnostics,getGpuRendererName} from '../src/diagnostics.js';
import {sanitizeSettings} from '../src/settings.js';
import {createSettings} from '../src/settings.js';

test('collectDiagnostics is bounded to local counters and tolerates absent/invalid renderer info', () => {
  assert.deepEqual(collectDiagnostics({}), {
    draws:0, triangles:0, geometries:0, textures:0, chunks:0, trees:0, particles:0,
  });
  const data = collectDiagnostics({
    renderer:{info:{render:{calls:121.8,triangles:45678},memory:{geometries:17,textures:3}}},
    chunks:{size:49}, trees:{size:385}, particles:{length:7},
    socket:{url:'private.invalid'}, wood:9999,
  });
  assert.deepEqual(data,{draws:121,triangles:45678,geometries:17,textures:3,chunks:49,trees:385,particles:7});
  assert.equal(formatDiagnostics(data),'Draws 121 · Tri 45678 · Geom 17 · Tex 3\nChunks 49 · Trees 385 · FX 7');
  assert.equal(collectDiagnostics({renderer:{info:{render:{calls:-3,triangles:NaN}}}}).draws,0);
});

test('opt-in FPS overlay samples diagnostics once a second and never stores world metrics', () => {
  const nodes = new Map();
  function node(selector){
    if(!nodes.has(selector))nodes.set(selector,{
      value:'',checked:false,hidden:false,textContent:'',style:{},
      setAttribute(){},querySelector:node,
    });
    return nodes.get(selector);
  }
  const append=[];
  const doc={
    createElement:tag=>({
      tag,hidden:false,textContent:'',style:{},setAttribute(){},
      querySelector:node,
    }),
    head:{append(x){append.push(x)}},
    body:{append(...items){append.push(...items)}},
  };
  const storage={saved:[],getItem(){return JSON.stringify({mouseSensitivity:1.3,showFps:true})},
    setItem(k,v){this.saved.push([k,v])}};
  const settings=createSettings(doc,storage);
  const fps=append.find(x=>x.className==='fc-fps');
  assert.ok(fps);
  assert.equal(fps.hidden,false);
  const ctx={renderer:{info:{render:{calls:88,triangles:3300},memory:{geometries:28,textures:10}}},
    px:12.5,pz:-3.5,feetY:2,
    chunks:{size:25}, trees:{size:155}, particles:[]};
  settings.tick(1000,ctx);
  assert.doesNotMatch(fps.textContent,/Draws/);
  settings.tick(1500,ctx);
  assert.doesNotMatch(fps.textContent,/Draws/);
  settings.tick(2010,ctx);
  assert.match(fps.textContent,/Draws 88 · Tri 3300 · Geom 28 · Tex 10/);
  assert.match(fps.textContent,/Chunks 25 · Trees 155 · FX 0/);
  assert.match(fps.textContent,/X 12.5 · Y 2.0 · Z -3.5/);
  assert.equal(storage.saved.length,0,'renderer stats never persist');
  const toggle=nodes.get('#fc-show-fps');
  toggle.checked=false;
  toggle.onchange();
  assert.equal(fps.hidden,true);
  assert.deepEqual(Object.keys(JSON.parse(storage.saved.at(-1)[1])).sort(),Object.keys(sanitizeSettings(null)).sort());
  settings.tick(3100,ctx);
  assert.equal(settings.showFps,false);
});


test('GPU model prefers unmasked WebGL adapter, handles ANGLE and browser restrictions',()=>{
  const gpu={UNMASKED_RENDERER_WEBGL:37446};
  const make=(renderer,hidden=false)=>({
    getContext(){return {
      RENDERER:7937,
      getExtension:()=>hidden?null:gpu,
      getParameter:key=>key===37446?renderer:'WebKit WebGL',
    };},
  });
  assert.equal(getGpuRendererName(make(
    'ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (ADL GT2), OpenGL ES 3.2)')),
  'Mesa Intel(R) Iris(R) Xe Graphics (ADL GT2)');
  assert.equal(getGpuRendererName(make('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x2504), D3D11)')),
    'NVIDIA GeForce RTX 3060 Laptop GPU');
  assert.equal(getGpuRendererName(make('',true)),'скрыто браузером');
  assert.equal(getGpuRendererName({}), 'недоступно');
  assert.equal(getGpuRendererName({getContext(){throw Error('blocked')}}),'скрыто браузером');
});

test('render FPS and physics rAF FPS are sampled independently',()=>{
  const elements=new Map(),appended=[];
  function node(selector){
    if(!elements.has(selector))elements.set(selector,{
      value:'',checked:false,hidden:false,textContent:'',style:{},
      setAttribute(){},querySelector:node,
    });
    return elements.get(selector);
  }
  const doc={
    createElement:tag=>({tag,hidden:false,className:'',textContent:'',style:{},
      setAttribute(){},querySelector:node}),
    head:{append(){}},
    body:{append(...nodes){appended.push(...nodes);}},
  };
  const writes=[];
  const settings=createSettings(doc,{
    getItem(){return JSON.stringify({showFps:true,maxFps:60});},
    setItem(k,v){writes.push([k,v]);},
  });
  const fps=appended.find(item=>item.className==='fc-fps');
  const ctx={
    renderer:{info:{render:{calls:4,triangles:900},memory:{geometries:2,textures:1}}},
    px:0,pz:0,feetY:0,chunks:new Map(),trees:new Map(),particles:[],
  };
  settings.tick(1000,ctx);
  settings.tickPhysics(1000);
  // A 120Hz display with a render-only cap of 60 FPS.
  for(let frame=1;frame<=120;frame++){
    const now=1000+frame*1000/120;
    settings.tickPhysics(now);
    if(frame%2===0)settings.tick(now,ctx);
  }
  assert.match(fps.textContent,/Render FPS 60 · Physics FPS 120/);
  assert.match(fps.textContent,/Draws 4/);
  assert.equal(writes.length,0,'FPS sampling never persists game metrics');
  // Physics counter keeps running even if the render branch is skipped.
  for(let frame=121;frame<=240;frame++)
    settings.tickPhysics(1000+frame*1000/120);
  assert.match(fps.textContent,/Physics FPS 120/);
  assert.match(fps.textContent,/Render FPS 60/);
  const toggle=elements.get('#fc-show-fps');
  toggle.checked=false;toggle.onchange();
  assert.equal(fps.hidden,true);
  toggle.checked=true;toggle.onchange();
  assert.match(fps.textContent,/Render FPS — · Physics FPS —/,
    're-enabling telemetry starts clean instead of showing stale rates');
  settings.tickPhysics(NaN);
  assert.match(fps.textContent,/Physics FPS —/,'invalid timestamps are ignored');
});

test('CPU Frame Time counts every rAF callback, GPU Frame Time reads asynchronous samples',()=>{
  const appended=[],nodes=new Map();
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{
      value:'',checked:false,textContent:'',style:{},setAttribute(){},querySelector:node,
    });
    return nodes.get(selector);
  };
  const doc={
    createElement:tag=>({tag,className:'',hidden:false,style:{},setAttribute(){},querySelector:node}),
    head:{append(){}},body:{append(...elements){appended.push(...elements);}},
  };
  const writes=[];
  const settings=createSettings(doc,{
    getItem(){return JSON.stringify({showFps:true});},
    setItem(key,value){writes.push([key,value]);},
  });
  const fps=appended.find(element=>element.className==='fc-fps');
  assert.match(fps.textContent,/CPU Frame Time — · GPU Frame Time —/);
  // Average includes cheap physics-only callbacks and heavier rendered frames.
  for(let i=0;i<=100;i++)
    settings.recordCpuFrame(i%2===0?8:2,1000+i*10);
  assert.match(fps.textContent,/CPU Frame Time 5\.0\d ms/);
  settings.setGpuFrameTime(8.9876,true);
  assert.match(fps.textContent,/GPU Frame Time 8.99 ms/);
  settings.setGpuFrameTime(null,true);
  assert.match(fps.textContent,/GPU Frame Time —/,'disjoint queries clear stale samples');
  settings.setGpuFrameTime(null,false);
  assert.match(fps.textContent,/GPU Frame Time н\/д/,'unsupported WebGL timers are identified');
  assert.equal(writes.length,0,'timings are diagnostic only');
  const toggle=nodes.get('#fc-show-fps');
  toggle.checked=false;toggle.onchange();
  toggle.checked=true;toggle.onchange();
  assert.match(fps.textContent,/CPU Frame Time — · GPU Frame Time —/,
    'turning diagnostics on restarts timing windows');
  settings.recordCpuFrame(NaN,2500);
  settings.recordCpuFrame(-2,2500);
  assert.match(fps.textContent,/CPU Frame Time —/);
});
