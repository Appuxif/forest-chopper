import {flatTerrain} from './helpers/flat-terrain.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInteractionHighlight} from '../src/interaction-highlight.js';

function fixture(){
  const resources={geometries:0,materials:0};
  class RingGeometry{constructor(){resources.geometries++}}
  class MeshBasicMaterial{constructor(){resources.materials++;this.color={hex:0,setHex(v){this.hex=v}}}}
  class Mesh{
    constructor(geometry,material){this.geometry=geometry;this.material=material;
      this.visible=true;this.rotation={x:0};
      this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z})}};
      this.scale={x:1,setScalar(v){this.x=v}};
    }
  }
  const scene={objects:[],add(x){this.objects.push(x)}};
  const ctx={terrain:flatTerrain(),THREE:{Mesh,RingGeometry,MeshBasicMaterial,DoubleSide:2},
    scene,buildMode:false,crafting:{items:new Map()},candidate:()=>({x:4,z:5})};
  const highlight=createInteractionHighlight(ctx);
  return {ctx,scene,resources,highlight};
}
test('one shared ring identifies raycast tree without touching the trunk',()=>{
  const f=fixture();
  const tree={position:{x:4,z:-3},userData:{id:'0,0:1',hp:5},
    children:[{material:{shared:true},scale:{x:1}}]};
  const before=JSON.stringify(tree);
  for(let i=0;i<200;i++)assert.equal(f.highlight.update(tree),true);
  assert.equal(f.highlight.mesh.visible,true);
  assert.equal(f.highlight.mesh.position.x,4);
  assert.equal(f.highlight.mesh.position.z,-3);
  assert.equal(JSON.stringify(tree),before);
  assert.equal(f.scene.objects.length,1);
  assert.deepEqual(f.resources,{geometries:1,materials:1});
  f.highlight.update(null);assert.equal(f.highlight.mesh.visible,false);
});
test('build mode selects nearest bench, not all furniture, and restores when leaving',()=>{
 const f=fixture();f.ctx.buildMode=true;
 f.ctx.crafting.items.set(12,{id:12,x:4.5,z:5});
 f.ctx.crafting.items.set(13,{id:13,x:200,z:200});
 assert.equal(f.highlight.update(null),true);
 assert.equal(f.highlight.mesh.scale.x,1.45);
 assert.equal(f.highlight.mesh.position.x,4.5);
 assert.equal(f.highlight.mesh.material.color.hex,0xf7d58f);
 f.ctx.crafting.items.clear();
 assert.equal(f.highlight.update(null),false);
 f.ctx.buildMode=false;f.highlight.clear();
 assert.equal(f.highlight.mesh.visible,false);
});


test('tree and bench highlight rings follow local terrain elevation instead of Y=0',()=>{
  const f=fixture();
  f.ctx.terrain.heightAt=(x,z)=>x*.2+z*.1;
  const tree={position:{x:20,y:5,z:10},userData:{hp:3}};
  f.highlight.update(tree);
  assert.ok(Math.abs(f.highlight.mesh.position.y-5.065)<1e-9);
  f.ctx.buildMode=true;
  f.ctx.candidate=()=>({x:20,z:10});
  f.ctx.crafting.items.set(1,{id:1,x:20,z:10});
  f.highlight.update(null);
  assert.ok(Math.abs(f.highlight.mesh.position.y-5.065)<1e-9);
});
