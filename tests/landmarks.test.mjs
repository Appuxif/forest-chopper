import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world.js';
import {createLandmarks} from '../src/landmarks.js';

function fixture(seed=321) {
  const assets=[], groups=[];
  class Geometry {constructor(...args){this.args=args;assets.push(this)}}
  class Material {constructor(opts={}){this.opts=opts;assets.push(this)}}
  class Texture {constructor(canvas){this.canvas=canvas;assets.push(this)}}
  class Group {constructor(){this.children=[];this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z})}};this.userData={}}
    add(node){this.children.push(node)}}
  class Mesh {constructor(geo,mat){this.geometry=geo;this.material=mat;this.userData={};
    this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z})}};
    this.scale={set(){},setScalar(){}};this.rotation={x:0,y:0,z:0};}}
  const doc={createElement:()=>({
    width:0,height:0,getContext(){return {fillRect(){},strokeRect(){},fillText(){},set fillStyle(v){},set strokeStyle(v){},
      set lineWidth(v){},set font(v){},set textAlign(v){},set textBaseline(v){}}}
  })};
  const sharedGeo=new Geometry('shared'),sharedMat=new Material();
  const THREE={Mesh,Group,PlaneGeometry:Geometry,CylinderGeometry:Geometry,MeshLambertMaterial:Material,
    CanvasTexture:Texture,SRGBColorSpace:'srgb',DoubleSide:2};
  const ctx={THREE,seed,chunkSize:24,px:0,pz:0,radius:1,trees:new Map(),chunks:new Map(),
    felled:new Set(),treeDamage:new Map(),trunkGeo:sharedGeo,leafGeo:sharedGeo,
    birchLeafGeo:sharedGeo,grassGeo:sharedGeo,flowerGeo:sharedGeo,mushroomGeo:sharedGeo,rockGeo:sharedGeo,
    trunkMats:[sharedMat,sharedMat,sharedMat],leafMats:[sharedMat,sharedMat,sharedMat,sharedMat],
    birchLeafMats:[sharedMat,sharedMat,sharedMat],birchTrunkMat:sharedMat,rareLeafMat:sharedMat,
    grassMat:sharedMat,rockMat:sharedMat,flowerMat:sharedMat,mushroomMat:sharedMat,
    scene:{add(group){groups.push(group)},remove(){}}
  };
  const world=createWorld(ctx);
  ctx.rand=world.rand;
  const landmarks=createLandmarks(ctx,doc);
  ctx.landmarks=landmarks;
  return {ctx,world,landmarks,assets,groups};
}
function generated(seed=321){
  const f=fixture(seed);
  for(let cx=-7;cx<=7;cx++) f.world.build(cx,0);
  for(let cx=-2;cx<=2;cx++) f.world.build(cx,1);
  const trail=[],posts=[],board=[];
  for(const [id,chunk] of f.ctx.chunks){
    const [cx,cz]=id.split(',').map(Number);
    const special=chunk.children.filter(obj=>obj.userData.landmark);
    const plants=chunk.children.filter(obj=>obj.userData.decorType);
    assert.equal(plants.length,25,'landmarks cannot replace or duplicate flora slots');
    assert.equal(special.filter(x=>x.userData.landmark==='trail').length,cz===0?1:0);
    const sign=special.filter(x=>x.userData.landmark!=='trail');
    assert.ok(sign.length===0||sign.length===2,'each sign has a post and board');
    assert.ok(!sign.length||cx%3===0&&cz===0);
    for(const mesh of special){
      if(mesh.userData.landmark==='trail')trail.push([cx,cz,mesh.position.x,mesh.position.y,mesh.position.z,mesh.geometry,mesh.material]);
      if(mesh.userData.landmark==='signpost')posts.push([cx,mesh.position.x,mesh.position.z,mesh.geometry,mesh.material]);
      if(mesh.userData.landmark==='signboard')board.push([cx,mesh.position.x,mesh.position.z,mesh.rotation.y,mesh.geometry,mesh.material]);
    }
  }
  return {...f,trail,posts,board};
}
test('continuous, seed-stable trail uses exactly one shared quad per z=0 chunk',()=>{
  const f=generated();
  assert.equal(f.trail.length,15);
  assert.ok(f.trail.every(([cx,cz,x,y,z])=>cz===0 && x===cx*24+12 && y===.025 && z===0));
  assert.equal(new Set(f.trail.map(x=>x[5])).size,1,'trail geometry is shared');
  assert.equal(new Set(f.trail.map(x=>x[6])).size,1,'trail material is shared');
  assert.equal(f.posts.length,f.board.length);
  assert.ok(f.posts.length>=3&&f.posts.length<=5,'signs are sparse, not one every chunk');
  const f2=generated();
  assert.deepEqual(f.posts.map(x=>x.slice(0,3)),f2.posts.map(x=>x.slice(0,3)),'seeded sign locations stay fixed');
  assert.deepEqual(f.board.map(x=>x.slice(0,4)),f2.board.map(x=>x.slice(0,4)));
  assert.equal(new Set(f.posts.map(x=>x[3])).size,1,'posts share geometry');
  assert.equal(new Set(f.board.map(x=>x[4])).size,1,'boards share geometry');
  assert.ok(new Set(f.board.map(x=>x[5])).size<=2,'only two globally shared sign textures/materials');
  assert.equal(f.assets.length,11,'two fixture resources plus 3 geometries, 4 materials and 2 textures');
});

test('signs face the trail, avoid seeded trunks and do not depend on fallen tree state',()=>{
  const f=fixture(567);
  for(const cx of [-6,-3,0,3,6]){
    const sign=f.landmarks.signPosition(cx,0);
    if(!sign)continue;
    const next=fixture(567);
    const again=next.landmarks.signPosition(cx,0);
    assert.deepEqual(sign,again);
    for(let i=0;i<8;i++){
      const tx=cx*24+f.world.rand(cx,0,i*3)*24,tz=f.world.rand(cx,0,i*3+1)*24;
      if(Math.hypot(tx,tz)<8)continue;
      assert.ok(Math.hypot(tx-sign.x,tz-sign.z)>=3);
    }
    const before={...sign};
    f.ctx.felled.add(cx+',0:0');
    assert.deepEqual(f.landmarks.signPosition(cx,0),before);
  }
  const first=generated(567);
  assert.ok(first.board.every(x=>x[3]===Math.PI),'all signboards face toward the trail');
  assert.ok(first.ctx.trees.size>0,'trees still generated at their original positions');
});
