import test from 'node:test';
import assert from 'node:assert/strict';
import {createCrafting,validBench,BENCH_COST,BENCH_REFUND} from '../src/crafting.js';

function setup(online=false){
  const created={geom:0,mat:0};
  class Geometry{constructor(){created.geom++}}
  class Material{constructor(){created.mat++}}
  class Obj {
    constructor(){this.children=[];this.rotation={x:0,y:0,z:0};this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z})}};}
    add(obj){this.children.push(obj)}
  }
  class Mesh extends Obj{constructor(geometry,material){super();Object.assign(this,{geometry,material})}}
  const buttons=[],scene={children:[],add(x){this.children.push(x)},remove(x){this.children=this.children.filter(c=>c!==x)}};
  const elements={buildbar:{append(...x){buttons.push(...x)}},wood:{textContent:0}};
  const doc={createElement(){return {style:{},type:'',textContent:'',onclick:null}}};
  const sent=[],notifications=[],marks=[];
  const ctx={THREE:{BoxGeometry:Geometry,MeshLambertMaterial:Material,Mesh,Group:Obj},
    scene,$:id=>elements[id],yaw:0,px:0,pz:0,orientation:0,wood:8,buildMode:true,
    isOnline:()=>online,sendNet:d=>sent.push(d),notify:(...a)=>notifications.push(a),
    offlineSave:{markDirty:()=>marks.push(1)},trees:new Map(),blocksPlayerAt:()=>false};
  return {ctx,scene,created,sent,notifications,marks,buttons,craft:createCrafting(ctx,doc)};
}
test('bench validates geometry, recipe and costs exactly three wood',()=>{
  assert.equal(BENCH_COST,3);assert.equal(BENCH_REFUND,2);
  assert.equal(validBench({kind:'bench',x:1.5,z:0,orientation:1}),true);
  assert.equal(validBench({kind:'bench',x:1.23,z:0,orientation:1}),false);
  assert.equal(validBench({kind:'tree',x:1,z:0,orientation:0}),false);
  const f=setup();
  assert.equal(f.buttons.length,2);
  f.craft.setMode(true);
  assert.equal(f.buttons[0].style.display,'block');
  assert.equal(f.craft.place(),true);
  assert.equal(f.ctx.wood,5);
  assert.equal(f.scene.children.length,1);
  assert.equal(f.scene.children[0].children.length,6);
  assert.equal(f.craft.place(),false,'must not double place in one spot');
  assert.equal(f.ctx.wood,5);
  assert.equal(f.craft.removeNear(),true);
  assert.equal(f.ctx.wood,7);
  assert.equal(f.craft.items.size,0);
  assert.equal(f.created.geom,2);
  assert.equal(f.created.mat,2);
  assert.equal(f.marks.length,2,'persist each confirmed local change');
});
test('online crafting only sends commands and never optimistically debits wood',()=>{
  const f=setup(true);
  assert.equal(f.craft.place(),true);
  assert.deepEqual(f.sent,[{type:'craft',recipe:'bench',x:0,z:-3.5,orientation:0}]);
  assert.equal(f.ctx.wood,8);
  assert.equal(f.craft.items.size,0);
  assert.equal(f.marks.length,0);
  f.craft.add({id:5,kind:'bench',x:0,z:-3.5,orientation:0});
  assert.equal(f.craft.removeNear(),true);
  assert.deepEqual(f.sent[1],{type:'remove_furniture',id:5});
  assert.equal(f.craft.items.size,1,'wait for authoritative delete');
  assert.equal(f.craft.remove(5),true);
  assert.equal(f.craft.items.size,0);
  assert.equal(f.craft.remove(5),false);
});
test('mode, insufficient wood, colliding tree/log and size cap are rejected',()=>{
  const f=setup();
  f.ctx.buildMode=false;assert.equal(f.craft.place(),false);
  f.ctx.buildMode=true;f.ctx.wood=2;assert.equal(f.craft.place(),false);
  f.ctx.wood=4;f.ctx.trees.set('tree',{position:{x:0,z:-3.5}});
  assert.equal(f.craft.place(),false);
  f.ctx.trees.clear();f.ctx.blocksPlayerAt=()=>true;assert.equal(f.craft.place(),false);
  f.ctx.blocksPlayerAt=()=>false;assert.equal(f.craft.place(),true);
  assert.equal(f.craft.snapshot().length,1);
  f.craft.clear();assert.equal(f.craft.items.size,0);
  f.craft.setMode(false);assert.equal(f.buttons[0].style.display,'none');
});

test('restoring old offline furniture IDs does not collide with newly crafted benches',()=>{
  const f=setup();
  assert.equal(f.craft.add({id:-1,kind:'bench',x:0,z:-7,orientation:0}),true);
  assert.equal(f.craft.place(),true);
  assert.deepEqual([...f.craft.items.keys()].sort((a,b)=>a-b),[-2,-1]);
});
