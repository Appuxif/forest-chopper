import test from 'node:test';
import assert from 'node:assert/strict';
import {createDecorBatch,DECOR_SOURCE_LAYER} from '../src/decor-instancing.js';
import {selectDecorShadowCasters} from '../src/decor-shadows.js';
import {createPlantInteraction} from '../src/plant-interaction.js';

class Node {
  constructor(x=0,z=0) {
    this.children=[];this.userData={};this.visible=true;
    this.position={x,y:0,z};this.rotation={x:0,y:0,z:0};
    this.matrixWorld={x,z,tilt:0};this.parent=null;
    this.layers={mask:1,set(n){this.mask=2**n;}};
  }
  add(child){this.children.push(child);child.parent=this;}
  remove(child){this.children.splice(this.children.indexOf(child),1);child.parent=null;}
  traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);}
  updateMatrixWorld(force){
    const p=this.parent?.matrixWorld??{x:0,z:0,tilt:0};
    this.matrixWorld={x:p.x+this.position.x,z:p.z+this.position.z,
      tilt:(p.tilt||0)+this.rotation.x+this.rotation.z};
    if(force)for(const child of this.children)child.updateMatrixWorld(true);
  }
}
class Mesh extends Node {
  constructor(geometry,material){
    super();this.isMesh=true;this.geometry=geometry;this.material=material;
    this.castShadow=false;this.receiveShadow=false;
  }
}
class InstancedMesh extends Mesh {
  constructor(geo,mat,capacity){
    super(geo,mat);this.count=capacity;this.capacity=capacity;
    this.isInstancedMesh=true;this.slots=[];
    this.instanceMatrix={needsUpdate:false};
  }
  setMatrixAt(index,matrix){this.slots[index]={...matrix};}
  getMatrixAt(index,scratch){Object.assign(scratch,this.slots[index]);}
  dispose(){this.disposed=true;}
}
const THREE={InstancedMesh,Matrix4:class {}};
const part=(parent,geo,mat)=>{
  const obj=new Mesh(geo,mat);parent.add(obj);return obj;
};

test('collecting one mushroom retains other instances; respawn reuses meshes',()=>{
  const chunk=new Node();
  chunk.userData.decorChunk={x:12,z:12,radius:17};
  const geo={},stem={},cap={};
  const a=new Node(2,4);a.userData.decorType='mushroom';
  const b=new Node(6,8);b.userData.decorType='mushroom';
  const c=new Node(10,13);c.userData.decorType='mushroom';
  for(const obj of [a,b,c]){
    chunk.add(obj);part(obj,geo,stem);part(obj,geo,cap);
  }
  const batch=createDecorBatch(THREE,chunk,[a,b,c]);
  assert.equal(batch.meshes.length,2);
  assert.ok(batch.meshes.every(mesh=>mesh.count===3));
  assert.ok([a,b,c].every(src=>src.children.every(obj=>
    obj.layers.mask===2**DECOR_SOURCE_LAYER)));
  const ids=()=>batch.meshes.map(mesh=>
    mesh.slots.slice(0,mesh.count).map(p=>p.x));
  assert.deepEqual(ids(),[[2,6,10],[2,6,10]]);
  b.visible=false;b.userData.collectedResource=true;
  assert.equal(batch.sync(b),true);
  assert.deepEqual(ids(),[[2,10],[2,10]]);
  assert.equal(a.position.x,2);assert.equal(c.position.x,10);
  assert.equal(batch.sync(b),false);
  b.userData.collectedResource=false;b.visible=true;
  assert.equal(batch.sync(b),true);
  assert.deepEqual(ids(),[[2,10,6],[2,10,6]]);
  assert.ok(batch.meshes.every(mesh=>mesh.instanceMatrix.needsUpdate));
  const meshes=[...batch.meshes];
  batch.dispose();
  assert.ok(meshes.every(mesh=>mesh.disposed&&!chunk.children.includes(mesh)));
  assert.ok([a,b,c].every(src=>src.children.every(obj=>obj.layers.mask===1)));
  assert.equal(b.userData.decorBatch,undefined);
});

test('flower bending updates GPU matrix; collected and restored flower changes count',()=>{
  const chunk=new Node();
  chunk.userData.decorChunk={x:12,z:12,radius:17};
  const flower=new Mesh({},{});flower.position.x=.6;
  flower.userData.decorType='flower';chunk.add(flower);
  const batch=createDecorBatch(THREE,chunk,[flower]);
  const ctx={px:0,pz:0,chunkSize:24,
    chunks:new Map([['0,0',chunk]]),avatars:new Map()};
  chunk.userData.reactivePlants=[flower];
  const interaction=createPlantInteraction(ctx);
  interaction.tick(1/60);
  assert.ok(batch.meshes[0].slots[0].tilt<0,'tilt updated in instance matrix');
  const mesh=batch.meshes[0];
  flower.userData.collectedResource=true;
  interaction.tick(1/60);
  assert.equal(mesh.count,0);
  flower.userData.collectedResource=false;
  interaction.tick(1/60);
  assert.equal(mesh.count,1);
  ctx.px=10;ctx.pz=10;
  for(let i=0;i<95;i++)interaction.tick(1/60);
  assert.equal(flower.rotation.x,0);assert.equal(flower.rotation.z,0);
  batch.dispose();
});

test('shadow selector uses batch bounds, not mesh origin, and skips empty batches',()=>{
  const chunk=new Node();
  const geo={},mat={};
  const flower=new Mesh(geo,mat);flower.position.x=25;
  flower.userData.decorType='flower';chunk.add(flower);
  const batch=createDecorBatch(THREE,chunk,[flower]);
  batch.meshes[0].userData.decorBatchBounds={x:25,z:0,radius:5};
  const chunks=new Map([['0,0',{userData:{shadowDecor:batch.meshes}}]]);
  assert.deepEqual(selectDecorShadowCasters(chunks,0,0,21,50),[batch.meshes[0]]);
  flower.visible=false;batch.sync(flower);
  assert.deepEqual(selectDecorShadowCasters(chunks,0,0,21,50),[]);
  batch.dispose();
});
