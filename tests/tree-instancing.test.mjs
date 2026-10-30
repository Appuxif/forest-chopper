import test from 'node:test';
import assert from 'node:assert/strict';
import {createTreeBatch,detachTreeForFall} from '../src/tree-instancing.js';
import {createWind} from '../src/wind.js';
import {createTreeWindShader} from '../src/tree-wind-shader.js';

class Color{
  constructor(hex=0xffffff){this.isColor=true;this.set(hex);}
  set(hex){this.hex=hex;return this;}
  clone(){return new Color(this.hex);}
}
class Material{
  constructor(hex,map=null){
    this.type='MeshLambertMaterial';this.color=new Color(hex);this.map=map;
    this.side=0;this.vertexColors=false;this.transparent=false;this.opacity=1;
    this.alphaTest=0;this.flatShading=false;this.depthWrite=true;this.wireframe=false;
  }
  clone(){return new Material(this.color.hex,this.map);}
}
let seq=0;
class Geometry{constructor(){this.uuid='geo-'+(++seq);}}
class Group{
  constructor(){
    this.position={x:0,y:0,z:0};
    this.rotation={x:0,y:0,z:0};
    this.children=[];this.userData={};
  }
  add(child){this.children.push(child);child.parent=this;}
  remove(child){this.children=this.children.filter(x=>x!==child);child.parent=null;}
  updateMatrixWorld(){
    for(const child of this.children)child.updateMatrixWorld?.();
  }
}
class Mesh extends Group{
  constructor(geometry,material){super();this.isMesh=true;this.geometry=geometry;this.material=material;this.visible=true;this.castShadow=false;}
  updateMatrixWorld(){
    this.matrixWorld={
      x:(this.parent?.position.x??0)+this.position.x,
      z:(this.parent?.position.z??0)+this.position.z,
      rotationX:this.rotation.x,rotationZ:this.rotation.z,
    };
  }
}
class Instances extends Mesh{
  constructor(geometry,material,capacity){
    super(geometry,material);this.capacity=capacity;this.count=capacity;
    this.matrices=[];this.colors=[];this.instanceMatrix={setUsage(){},needsUpdate:false};
    this.instanceColor=null;this.boundingSphere=null;
  }
  setMatrixAt(i,m){this.matrices[i]={...m};}
  setColorAt(i,color){this.colors[i]=color.hex;this.instanceColor={needsUpdate:false};}
  computeBoundingSphere(){this.boundsComputed=(this.boundsComputed??0)+1;}
  dispose(){this.disposed=true;}
}
const THREE={InstancedMesh:Instances,DynamicDrawUsage:35048};
function tree(x,z,geo,trunkMaterial,leafMaterial,leafGeo=geo,rare=false){
  const group=new Group();group.position.x=x;group.position.z=z;
  group.userData={species:leafGeo===geo?'conifer':'birch',h:10,scale:1,rare};
  group.add(new Mesh(geo,trunkMaterial));
  for(let i=0;i<4;i++){
    const m=new Mesh(leafGeo,leafMaterial);
    m.position.z=i*.2;m.position.y=i;
    group.add(m);
  }
  return group;
}

test('classic trees use shared instanced tints but preserve geometry, original material and five parts',()=>{
  const parent=new Group(),geo=new Geometry(),cone=new Geometry(),ico=new Geometry();
  const birchMap={uuid:'bark-texture'};
  const brown=new Material(0x65442e),brown2=new Material(0x795339);
  const pine=new Material(0x214c30),pine2=new Material(0x30683a);
  const rare=new Material(0xb1ced2);
  const birchBark=new Material(0xffffff,birchMap);
  const birchLeaves=new Material(0x6fa54b);
  const a=tree(3,5,geo,brown,pine,cone);
  const b=tree(8,5,geo,brown2,rare,cone,true);
  const c=tree(13,7,geo,birchBark,birchLeaves,ico);
  const parent2=new Group(),cache=new Map();
  const batch=createTreeBatch(THREE,parent,[a,b,c],cache);
  const reused=createTreeBatch(THREE,parent2,[tree(6,2,geo,brown2,pine2,cone)],cache);
  assert.equal(batch.meshes.length,4,'one draw per geometry/material style, not per foliage color');
  assert.equal(reused.meshes.length,2);
  assert.ok(batch.meshes.some(m=>reused.meshes.some(n=>n.material===m.material)),
    'white base material shared across chunk batches');
  assert.ok(batch.meshes.every(m=>m.castShadow));
  assert.ok(batch.meshes.every(m=>m.material.color.hex===0xffffff));
  const coniferTrunk=batch.meshes.find(m=>m.geometry===geo && m.count===2);
  const coniferFoliage=batch.meshes.find(m=>m.geometry===cone);
  const birchTrunk=batch.meshes.find(m=>m.material.map===birchMap);
  assert.deepEqual(coniferTrunk.colors,[brown.color.hex,brown2.color.hex]);
  assert.equal(coniferFoliage.count,8);
  assert.deepEqual(coniferFoliage.colors,[...Array(4).fill(pine.color.hex),...Array(4).fill(rare.color.hex)]);
  assert.equal(birchTrunk.count,1);
  assert.equal(coniferTrunk.matrices[1].x,8);
  assert.equal(a.children.length,5);
  assert.ok([a,b,c].every(t=>t.children.every(p=>!p.visible)));
  assert.equal(a.children[0].material,brown);
  assert.equal(c.children[0].material,birchBark);
  reused.dispose();batch.dispose();
  assert.equal(cache.size,4);
  assert.ok(batch.meshes.every(m=>m.disposed));
  assert.equal(parent.children.length,0);
  assert.ok([a,b,c].every(t=>t.userData.treeBatch===null));
});

test('wind matrix updates and removing a tree compact per-material instances; fall reveals original',()=>{
  const parent=new Group(),trunkGeo=new Geometry(),cone=new Geometry();
  const brown=new Material(0x795339),pine=new Material(0x214c30);
  const a=tree(5,0,trunkGeo,brown,pine,cone),b=tree(9,0,trunkGeo,brown,pine,cone);
  const batch=createTreeBatch(THREE,parent,[a,b]);
  const leafMesh=batch.meshes.find(m=>m.geometry===cone);
  a.children[1].rotation.z=.04;
  batch.updateTree(a);
  assert.equal(leafMesh.matrices[0].rotationZ,.04);
  assert.equal(leafMesh.instanceMatrix.needsUpdate,true);
  let invalidations=0;
  detachTreeForFall({atmosphere:{invalidateStaticShadows(){invalidations++;}}},a);
  assert.equal(invalidations,1);
  assert.equal(a.userData.treeBatch,null);
  assert.ok(a.children.every(m=>m.visible&&m.castShadow));
  assert.equal(leafMesh.count,4,'other tree keeps four foliage instances');
  assert.equal(leafMesh.matrices[0].x,9,'last tree moved to empty instance slot');
  assert.deepEqual(leafMesh.colors.slice(0,4),Array(4).fill(pine.color.hex));
  assert.equal(b.userData.treeBatch,batch);
  detachTreeForFall({atmosphere:{invalidateStaticShadows(){invalidations++;}}},a);
  assert.equal(invalidations,1,'a second fall message has no effect');
  batch.dispose();
  assert.equal(b.userData.treeBatch,null);
});

test('wind updates the hidden originals and their instanced matrices; disabling restores neutral pose',()=>{
  const parent=new Group(),geo=new Geometry(),cone=new Geometry();
  const leafMat=new Material(0x214c30),brown=new Material(0x65442e);
  const a=tree(5,4,geo,brown,leafMat,cone);
  const batch=createTreeBatch(THREE,parent,[a]);
  const foliage=batch.meshes.find(m=>m.geometry===cone);
  const ctx={trees:new Map([['a',a]]),px:5,pz:4,settings:{windEnabled:true}};
  const wind=createWind(ctx,{intervalMs:150,maxTrees:32,motionQuery:{matches:false}});
  wind.tick(1000);
  assert.ok(Math.abs(a.children[1].rotation.z)>0);
  assert.equal(foliage.matrices[0].rotationZ,a.children[1].rotation.z);
  ctx.settings.windEnabled=false;
  wind.tick(1200);
  assert.equal(a.children[1].rotation.z,0);
  assert.equal(foliage.matrices[0].rotationZ,0);
  assert.equal(wind.activeCount,0);
  batch.dispose();
});

test('falling tree unregisters root sway before fall animation starts',()=>{
  const parent=new Group(),geo=new Geometry(),cone=new Geometry();
  const brown=new Material(0x795339),pine=new Material(0x214c30);
  const treeGroup=tree(5,0,geo,brown,pine,cone);
  const batch=createTreeBatch(THREE,parent,[treeGroup]);
  const events=[];
  const ctx={wind:{forget(t){
    events.push('wind');
    assert.equal(t.userData.treeBatch,null);
    t.rotation.z=0;
  }},atmosphere:{invalidateStaticShadows(){events.push('shadows');}}};
  treeGroup.rotation.z=.01;
  detachTreeForFall(ctx,treeGroup);
  assert.equal(treeGroup.rotation.z,0);
  assert.deepEqual(events,['wind','shadows']);
  assert.equal(batch.meshes[0].count,0);
  detachTreeForFall(ctx,treeGroup);
  assert.deepEqual(events,['wind','shadows'],'repeat fall event does not reset rotation again');
  batch.dispose();
});

test('without GPU instancing support original tree stays rendered',()=>{
  const parent=new Group(),geo=new Geometry(),t=tree(4,5,geo,new Material(0xffffff),new Material(0x224422));
  assert.equal(createTreeBatch({},parent,[t]),null);
  assert.ok(t.children.every(p=>p.visible));
});


test('instanced procedural wood and foliage share GPU wind with shadow depth shaders',()=>{
  const parent=new Group(),woodGeo=new Geometry(),leafGeo=new Geometry();
  const wood=new Material(0x795339),leaves=new Material(0x245c36,{uuid:'atlas'});
  leaves.alphaTest=.4;
  const make=(x)=>{
    const tree=new Group();tree.position.x=x;tree.userData={spruceModel:true};
    tree.add(new Mesh(woodGeo,wood));
    tree.add(new Mesh(leafGeo,leaves));
    return tree;
  };
  let depthCreated=0;
  class Depth{
    constructor(opts){Object.assign(this,opts);this.userData={};depthCreated++;}
  }
  const graphics={...THREE,MeshDepthMaterial:Depth,RGBADepthPacking:3201};
  const wind=createTreeWindShader({motionQuery:{matches:false}});
  const cache=new Map();
  const batch1=createTreeBatch(graphics,parent,[make(1),make(2)],cache,wind);
  const batch2=createTreeBatch(graphics,new Group(),[make(4)],cache,wind);
  assert.equal(batch1.meshes.length,2);
  assert.equal(batch2.meshes.length,2);
  assert.equal(depthCreated,2,'depth materials are shared across chunks');
  for(const batch of [batch1,batch2])for(const mesh of batch.meshes){
    assert.equal(mesh.material.userData.fcWindHeight,6);
    assert.equal(mesh.customDepthMaterial.userData.fcWindHeight,6);
    assert.equal(typeof mesh.material.onBeforeCompile,'function');
    assert.equal(mesh.customDepthMaterial.alphaTest,mesh.material.alphaTest);
  }
  const leaf=batch1.meshes.find(m=>m.geometry===leafGeo);
  assert.equal(leaf.customDepthMaterial.map,leaves.map);
  const compiled={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>'};
  leaf.material.onBeforeCompile(compiled);
  assert.match(compiled.vertexShader,/transformed.z \+= fcOffset/);
  assert.equal(compiled.uniforms.fcWindTime,wind.uniforms.fcWindTime);
  const fixed=batch1.meshes.map(mesh=>mesh.matrices.map(m=>({...m})));
  wind.tick(1000,0,0);
  wind.tick(2000,1,1);
  assert.deepEqual(batch1.meshes.map(mesh=>mesh.matrices),fixed,
    'no CPU instance transforms update when GPU time changes');
  batch1.dispose();batch2.dispose();
});
