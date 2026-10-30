import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world.js';
import {createLandmarks} from '../src/landmarks.js';

function fixture(seed=321) {
  const assets=[], groups=[];
  class Geometry {constructor(...args){this.args=args;assets.push(this)}}
  class Material {constructor(opts={}){this.opts=opts;assets.push(this)}}
  class Texture {constructor(canvas){this.canvas=canvas;this.repeat={set(x,y){this.x=x;this.y=y}};assets.push(this)}}
  class Group {constructor(){this.children=[];this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z})}};this.rotation={x:0,y:0,z:0};this.scale={x:1,y:1,z:1,setScalar(n){this.x=this.y=this.z=n}};this.userData={}}
    add(node){this.children.push(node)}}
  class Mesh {constructor(geo,mat){this.geometry=geo;this.material=mat;this.userData={};
    this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z})}};
    this.scale={x:1,y:1,z:1,set(x,y,z){Object.assign(this,{x,y,z})},setScalar(v){this.x=this.y=this.z=v}};
    this.rotation={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z})}};}}
  const doc={createElement:()=>({
    width:0,height:0,getContext(){return {fillRect(){},strokeRect(){},fillText(){},
      beginPath(){},arc(){},ellipse(){},fill(){},
      createRadialGradient(){return {addColorStop(){}}},
      set fillStyle(v){},set strokeStyle(v){},
      set lineWidth(v){},set font(v){},set textAlign(v){},set textBaseline(v){}}}
  })};
  const sharedGeo=new Geometry('shared'),sharedMat=new Material();
  class PointLight {constructor(color,intensity,distance,decay){
    Object.assign(this,{color,intensity,distance,decay});
    this.position={set(){}};
    this.layers={enabled:[],enable(layer){this.enabled.push(layer)}};
    this.shadow={mapSize:{set(x,y){this.x=x;this.y=y}},camera:{},needsUpdate:false};
  }}
  const THREE={Mesh,Group,PlaneGeometry:Geometry,CylinderGeometry:Geometry,ConeGeometry:Geometry,
    MeshLambertMaterial:Material,PointLight,
    CanvasTexture:Texture,SRGBColorSpace:'srgb',DoubleSide:2};
  const ctx={THREE,seed,chunkSize:24,px:0,pz:0,radius:1,trees:new Map(),chunks:new Map(),
    felled:new Set(),treeDamage:new Map(),trunkGeo:sharedGeo,leafGeo:sharedGeo,
    birchLeafGeo:sharedGeo,flowerGeo:sharedGeo,mushroomGeo:sharedGeo,rockGeo:sharedGeo,
    grasses:{create(shape,palette){const mesh=new THREE.Mesh(sharedGeo,sharedMat);mesh.userData.grassShape=['meadow','lush','sedge','fan'][shape];mesh.userData.grassPalette=['forest','fresh','dry'][palette];return mesh;}},
    trunkMats:[sharedMat,sharedMat,sharedMat],leafMats:[sharedMat,sharedMat,sharedMat,sharedMat],
    birchLeafMats:[sharedMat,sharedMat,sharedMat],birchTrunkMat:sharedMat,rareLeafMat:sharedMat,
    rockMat:sharedMat,flowerMat:sharedMat,
    mushrooms:{create(index){const group=new THREE.Group();group.userData.mushroomSpecies=['fly_agaric','boletus','death_cap','milkcap'][index];group.add(new THREE.Mesh(sharedGeo,sharedMat));return group;}},
    flowers:{create(index){const mesh=new THREE.Mesh(sharedGeo,sharedMat);mesh.userData.flowerSpecies=['daisy','buttercup','pink_wildflower','blue_wildflower'][index];return mesh;}},
    logGeo:sharedGeo,logMat:sharedMat,
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
    const sign=special.filter(x=>['signpost','signboard'].includes(x.userData.landmark));
    assert.equal(special.filter(x=>x.userData.landmark==='campfire').length,cx===0&&cz===0?1:0);
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
  assert.equal(f.assets.length,16,'shared resources: 2 fixture, 5 geometries, 6 materials, 3 textures');
  const trail=f.ctx.chunks.get('0,0').children.find(m=>m.userData.landmark==='trail');
  assert.equal(trail.receiveShadow,true,'visible trail surface must receive tree shadows');
  assert.equal(trail.material.opts.map.repeat.x,3,'texture repeats cleanly over 24 m chunks');
  assert.equal(trail.material.opts.map.repeat.y,3.2/8,'texture scale stays consistent across width');
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

test('one decorative campfire at the trailhead reuses assets and never changes world rules',()=>{
  const f=fixture(101);
  f.world.build(0,0);
  f.world.build(1,0);
  f.world.build(0,1);
  const fires=[...f.ctx.chunks.values()].flatMap(g=>g.children).filter(x=>x.userData.landmark==='campfire');
  assert.equal(fires.length,1);
  const fire=fires[0];
  assert.deepEqual([fire.position.x,fire.position.y,fire.position.z],[5,0,5]);
  assert.equal(fire.children.length,15,'six rocks, three logs, two flames, one light and three sparks');
  const rock=fire.children.slice(0,6);
  const logs=fire.children.slice(6,9);
  assert.ok(rock.every(x=>x.geometry===f.ctx.rockGeo && x.material===f.ctx.rockMat));
  assert.ok(logs.every(x=>x.geometry===f.ctx.logGeo && x.material===f.ctx.logMat));
  assert.equal(fire.children.filter(x=>x.geometry).length,14);
  assert.equal(fire.children.filter(x=>x.intensity!==undefined).length,1,'one low-radius point light');
  const point=fire.children[11];
  assert.equal(point.castShadow,true,'fire point light has genuine depth-cube shadows');
  assert.deepEqual([point.shadow.mapSize.x,point.shadow.mapSize.y],[256,256]);
  assert.equal(point.shadow.camera.near,.2);
  assert.equal(point.shadow.camera.far,9);
  assert.equal(point.shadow.autoUpdate,false);
  assert.deepEqual(point.layers.enabled,[1,3]);
  const seed=f.ctx.seed,treeCount=f.ctx.trees.size,assetCount=f.assets.length;
  f.landmarks.tick(1000);
  assert.equal(f.ctx.seed,seed);
  assert.equal(f.ctx.trees.size,treeCount);
  assert.equal(f.ctx.felled.size,0);
  assert.equal(f.assets.length,assetCount,'animation creates no materials or geometry');
  f.ctx.chunks.delete('0,0');
  f.landmarks.tick(1300);
  assert.equal(f.assets.length,assetCount,'chunk unload releases the fire without disposing shared assets');
});

test('campfire flicker is bounded and reduced-motion stops all fire movement immediately',()=>{
  const old=globalThis.matchMedia;
  const reduced={matches:true};
  globalThis.matchMedia=()=>reduced;
  try{
    const f=fixture();
    f.world.build(0,0);
    const fire=f.ctx.chunks.get('0,0').children.find(x=>x.userData.landmark==='campfire');
    const flame=fire.children[9],inner=fire.children[10],light=fire.children[11];
    const sparks=fire.children.slice(12);
    f.landmarks.tick(2000);
    assert.equal(flame.scale.y,1);
    assert.equal(inner.scale.y,1);
    assert.equal(light.intensity,1.8);
    reduced.matches=false;
    f.landmarks.tick(2150);
    assert.ok(Math.abs(flame.scale.y-1)>.001);
    assert.ok(light.intensity>1.5&&light.intensity<2.1);
    const yBefore=flame.scale.y;
    light.shadow.needsUpdate=false;
    f.landmarks.tick(2200);
    assert.equal(light.shadow.needsUpdate,true,'point shadow refreshes near the player despite flame flicker throttle');
    assert.equal(flame.scale.y,yBefore,'fire updates are rate-limited');
    // Point-light shadow updates stop when the local avatar is far away.
    f.ctx.px=100;f.ctx.pz=100;
    light.shadow.needsUpdate=false;
    f.landmarks.tick(2201);
    assert.equal(light.shadow.needsUpdate,false);
    reduced.matches=true;
    f.landmarks.tick(2202);
    assert.equal(flame.scale.y,1);
    assert.equal(inner.scale.y,1);
    assert.equal(light.intensity,1.8);
    assert.deepEqual(sparks.map((s,i)=>s.position.y),[.95,1.08,1.21]);
  }finally{globalThis.matchMedia=old;}
});
