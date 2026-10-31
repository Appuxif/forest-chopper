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
