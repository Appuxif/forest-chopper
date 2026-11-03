import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRenderable,createRenderProfiler,scanSceneGeometry} from '../src/render-profiler.js';

function mesh(parent,category=null,geometry=null,instances=1){
  const object={
    isMesh:true,isInstancedMesh:instances>1,count:instances,
    visible:true,parent,children:[],
    userData:category?{profileCategory:category}:{},
    geometry:geometry??{index:{count:12},drawRange:{start:0,count:Infinity}},
  };
  parent?.children?.push(object);
  return object;
}
function scene(){
  return {visible:true,children:[],userData:{}};
}
test('classifies tree batches, grass, decorations, water and nested props',()=>{
  const root=scene();
  const trees=mesh(root,'trees');
  assert.equal(classifyRenderable(trees),'trees');
  const grass=mesh(root);
  grass.userData.microGrass=true;
  assert.equal(classifyRenderable(grass),'grass');
  const decor={parent:root,userData:{decorType:'mushroom'},children:[]};
  assert.equal(classifyRenderable(mesh(decor)),'decor');
  const water=mesh(root);
  water.name='Lake 1,1';
  assert.equal(classifyRenderable(water),'water');
  const actor={parent:root,userData:{profileCategory:'players'},children:[]};
  assert.equal(classifyRenderable(mesh(actor)),'players');
  assert.equal(classifyRenderable({isSkinnedMesh:true,userData:{}}),'players');
});

test('inventory separates unique geometry from instanced potential triangles',()=>{
  const root=scene();
  const shared={index:{count:18},drawRange:{start:0,count:Infinity}};
  mesh(root,'trees',shared,10);
  mesh(root,'trees',shared,2);
  const hidden={visible:false,children:[],userData:{}};
  root.children.push(hidden);
  mesh(hidden,'trees',shared,20);
  const rows=scanSceneGeometry(root);
  const trees=rows.find(v=>v.category==='trees');
  assert.deepEqual(trees,{category:'trees',meshes:2,instances:12,
    trianglesPotential:72,uniqueGeometries:1});
});

test('inventory counts resident grass pages even if precise frustum culling hides them',()=>{
  const root=scene();
  const grass=mesh(root,'grass',null,30);
  grass.visible=false;
  grass.userData.microGrassFrustumHidden=true;
  const culled=mesh(root,'grass',null,20);
  culled.visible=false; // Explicit gameplay hide should still be excluded.
  const row=scanSceneGeometry(root).find(v=>v.category==='grass');
  assert.equal(row.instances,30);
  assert.equal(row.meshes,1);
});

test('collects real draw deltas and separate shadow updates, restores renderer on stop',()=>{
  let time=100;
  const info={render:{calls:0,triangles:0}};
  const direct=function(camera,scene,geometry,material,object){
    info.render.calls++;
    info.render.triangles+=object.triangles??6;
  };
  const renderer={info,renderBufferDirect:direct};
  const profiler=createRenderProfiler(renderer,{clock:()=>time});
  assert.equal(profiler.start(),true);
  const tree={userData:{profileCategory:'trees'},isInstancedMesh:true,count:20,triangles:120};
  const grass={userData:{microGrass:true},triangles:40};
  const light={uuid:'near',shadow:{mapSize:{x:2048,y:2048}}};
  profiler.beginFrame();
  renderer.renderBufferDirect(null,null,null,null,tree,null);
  renderer.renderBufferDirect(null,null,null,null,grass,null);
  profiler.beginShadow(light,'sunNear');
  time=101;
  renderer.renderBufferDirect(null,null,null,null,tree,null);
  time=102;
  profiler.endShadow();
  profiler.endFrame();
  let snap=profiler.snapshot();
  assert.equal(snap.frame.mainDraws,2);
  assert.equal(snap.frame.mainTriangles,160);
  assert.equal(snap.frame.shadowDraws,1);
  assert.equal(snap.frame.shadowTriangles,120);
  assert.equal(snap.frame.main.find(v=>v.category==='trees').instances,20);
  assert.equal(snap.frame.shadow.find(v=>v.category==='trees').drawCalls,1);
  assert.equal(snap.lights[0].lastCpuMs,2);
  assert.equal(snap.lights[0].refreshes,1);
  assert.deepEqual(snap.lights[0].resolution,[2048,2048]);
  profiler.beginFrame();
  renderer.renderBufferDirect(null,null,null,null,grass,null);
  profiler.endFrame();
  snap=profiler.snapshot();
  assert.equal(snap.frame.shadowDraws,0);
  assert.equal(snap.lights[0].lastDrawCalls,1);
  assert.equal(snap.shadowTotals.callsPerFrame,.5);
  assert.equal(profiler.stop(),true);
  assert.equal(renderer.renderBufferDirect,direct);
  assert.equal(renderer.__forestProfiler,undefined);
  assert.equal(profiler.start(),true);
  assert.equal(profiler.snapshot().lights.length,0);
  profiler.stop();
});

test('skips non-rendered items and updates only between beginFrame/endFrame',()=>{
  const info={render:{calls:0,triangles:0}};
  const original=function(){};
  const renderer={info,renderBufferDirect:original};
  const profiler=createRenderProfiler(renderer,{clock:()=>0});
  assert.equal(profiler.start(),true);
  profiler.beginFrame();
  renderer.renderBufferDirect(null,null,null,null,{userData:{profileCategory:'sky'}},null);
  profiler.endFrame();
  assert.equal(profiler.snapshot().frame.mainDraws,0);
  profiler.stop();
  assert.equal(profiler.enabled,false);
});
