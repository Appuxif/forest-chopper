import {flatTerrain} from './helpers/flat-terrain.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {gladesForTile,gladeAtPoint,gladeDensity,GLADE_CELL} from '../src/grass-glades.js';
import {GRASS_CLUSTER_DEFAULTS} from '../src/grass-clustering.js';
import {generateGrassTile,createMicroGrass,effectiveGrassRadius,
  grassDistanceDensity,MICRO_GRASS_NIGHT_RADIUS} from '../src/micro-grass.js';

function fixture({radius=12,density=2}={}) {
  const sceneItems=new Set(),geometries=new Set(),materials=new Set(),meshes=new Set();
  class Attribute {
    constructor(array,itemSize) {this.array=array;this.itemSize=itemSize;this.count=array.length/itemSize;}
    setXY(i,x,y) {this.array[i*2]=x;this.array[i*2+1]=y;}
    clone() {return new this.constructor(this.array.slice(),this.itemSize);}
  }
  class Geometry {
    constructor() {this.attributes={};this.disposed=0;geometries.add(this);}
    setAttribute(key,attr){this.attributes[key]=attr;}
    setIndex(indices){this.indices=indices;}
    getAttribute(key){return this.attributes[key];}
    computeVertexNormals(){}
    clone(){
      const copy=new Geometry();
      for(const [key,attr] of Object.entries(this.attributes))copy.setAttribute(key,attr.clone());
      if(this.indices)copy.indices=this.indices.slice();
      return copy;
    }
    dispose(){this.disposed++;}
  }
  class Material {
    constructor(options){this.options=options;this.userData={};this.disposed=0;materials.add(this);}
    dispose(){this.disposed++;}
  }
  class Vector2 {
    constructor(x=0,y=0){this.set(x,y);}
    set(x,y){this.x=x;this.y=y;return this;}
  }
  class Vector4 {
    constructor(x=0,y=0,z=0,w=0){this.set(x,y,z,w);}
    set(x,y,z,w){this.x=x;this.y=y;this.z=z;this.w=w;return this;}
  }
  class Vector3 {
    constructor(x=0,y=0,z=0){this.set(x,y,z);}
    set(x,y,z){Object.assign(this,{x,y,z});return this;}
  }
  class Box3 {
    constructor(min,max){this.min=min;this.max=max;}
  }
  class Matrix4 {
    multiplyMatrices(){return this;}
  }
  class Frustum {
    setFromProjectionMatrix(){return this;}
    intersectsBox(box){return box.min.x<ctx.cullX;}
  }
  class Object3D {
    constructor(){
      this.position={x:0,y:0,z:0,set:(x,y,z)=>Object.assign(this.position,{x,y,z})};
      this.rotation={x:0,y:0,z:0,set:(x,y,z)=>Object.assign(this.rotation,{x,y,z})};
      this.scale={x:1,y:1,z:1,
        set:(x,y,z)=>Object.assign(this.scale,{x,y,z}),
        setScalar:(n)=>Object.assign(this.scale,{x:n,y:n,z:n})};
      this.matrix=null;
    }
    updateMatrix(){this.matrix={position:{...this.position},rotation:{...this.rotation},scale:{...this.scale}};}
  }
  class Color {
    setHSL(h,s,l){this.h=h;this.s=s;this.l=l;return this;}
  }
  class InstancedMesh {
    constructor(geometry,material,capacity){
      this.geometry=geometry;this.material=material;this.count=capacity;
      this.instanceMatrix={count:capacity,needsUpdate:false};
      this.instanceColor={needsUpdate:false};
      this.userData={};this.matrices=new Map();this.disposed=0;
      meshes.add(this);
    }
    setMatrixAt(i,matrix){this.matrices.set(i,matrix);}
    setColorAt(){}
    computeBoundingSphere(){this.boundingSphere={radius:12};}
    dispose(){this.disposed++;}
  }
  const THREE={
    BufferGeometry:Geometry,Float32BufferAttribute:Attribute,
    InstancedBufferAttribute:Attribute,MeshLambertMaterial:Material,
    Vector2,Vector3,Vector4,Box3,Matrix4,Frustum,Object3D,Color,InstancedMesh,DoubleSide:2,
  };
  const ctx={THREE,terrain:flatTerrain(),scene:{add(mesh){sceneItems.add(mesh);},remove(mesh){sceneItems.delete(mesh);}},
    px:5,pz:6,seed:7812,avatars:new Map(),cullX:Infinity,
    camera:{projectionMatrix:{},matrixWorldInverse:{},updateMatrixWorld(){this.updated=(this.updated??0)+1;}},settings:{
      grassDensity:density,grassDistance:radius,grassMinSize:2.5,grassMaxSize:5.5,
      grassWidth:1,grassTurnMin:-30,grassTurnMax:30,
    },
  };
  return {THREE,ctx,sceneItems,geometries,materials,meshes};
}

test('four glade profiles are deterministic, 50% larger and smoothly blend at boundaries',()=>{
  const seed=91231;
  const glades=gladesForTile(seed,-GLADE_CELL,-GLADE_CELL,GLADE_CELL*3);
  assert.ok(glades.length>=9);
  assert.deepEqual(glades,gladesForTile(seed,-GLADE_CELL,-GLADE_CELL,GLADE_CELL*3));
  assert.deepEqual(new Set(glades.map(g=>g.kind)),new Set([1,2,3,4]));
  for(const g of glades){
    const core=gladeAtPoint(g.x,g.z,[g],{});
    assert.equal(core.kind,g.kind);
    assert.equal(core.weight,1);
    // Sample along the glade's rotated local X axis (not global X).
    const sample=d=>gladeAtPoint(g.x+g.cos*g.rx*d,g.z+g.sin*g.rx*d,[g],{});
    const inner=sample(.66);
    const shoulder=sample(.95);
    const outside=sample(1.4);
    assert.ok(inner.weight>shoulder.weight && shoulder.weight>outside.weight,
      'gradual density/height transition from glade core');
    assert.equal(outside.weight,0);
    assert.ok(g.rx>=6.3*1.5*.82 && g.rz>=6.3*1.5*.82);
  }
  assert.equal(gladeDensity(1),0);
  assert.equal(gladeDensity(2),46);
  assert.equal(gladeDensity(3),42);
  assert.equal(gladeDensity(4),2);
  assert.equal(gladeDensity(0),null);
});

test('micro grass generation uses deterministic samples and glade-specific profiles',()=>{
  const a=generateGrassTile(51,0,0,12,25,'near');
  const b=generateGrassTile(51,0,0,12,25,'near');
  assert.deepEqual(a,b);
  assert.ok(a.length>0);
  assert.ok(a.every(s=>Number.isFinite(s.x)&&Number.isFinite(s.z)&&s.patchWeight>=0&&s.patchWeight<=1));
  assert.ok(a.every(s=>Math.abs(s.z)>=1.75),'the cleared trail remains open');
  assert.ok(a.every(s=>s.patchKind>=0&&s.patchKind<=4));
  const far=generateGrassTile(51,0,0,12,25,'far');
  assert.ok(Math.abs(far.length-a.length)/a.length<.16,
    'both LODs should have similar grass coverage; far uses fewer vertices');
});

test('shader bending is near-only, uses uniform actor slots and keeps roots planted',()=>{
  const {ctx,sceneItems,materials}=fixture();
  const grass=createMicroGrass(ctx);
  const near=[...sceneItems].find(mesh=>mesh.userData.grassTier==='near');
  assert.ok(near);
  const nearMaterial=near.material;
  const nearShader={uniforms:{},vertexShader:'#include <common>\nvoid main() {\n#include <begin_vertex>\n}'};
  nearMaterial.onBeforeCompile(nearShader);
  assert.ok(nearShader.vertexShader.includes('fcGrassActors[6]'));
  assert.ok(nearShader.vertexShader.includes('fcPush = fcDelta'));
  assert.ok(nearShader.vertexShader.includes('smoothstep(0.018,0.19,position.y)'));
  assert.ok(nearShader.vertexShader.includes('instanceMatrix[3].xz - fcActor.xy'));
  assert.ok(nearShader.vertexShader.includes('fcGrassProfile'));
  assert.equal(nearShader.uniforms.fcGrassActors.value.length,6);
  assert.equal(nearShader.uniforms.fcGrassActors.value[0].x,ctx.px);
  assert.equal(nearShader.uniforms.fcGrassActors.value[0].y,ctx.pz);
  assert.equal(nearShader.uniforms.fcGrassActors.value[0].z,1.05);
  assert.equal(materials.size,2,'two shared LOD materials');
  grass.dispose();
  assert.ok([...sceneItems].length===0);
});

test('movement updates interaction uniform without regenerating tiles; remote actors are bounded',()=>{
  const {ctx,sceneItems,meshes,materials,geometries}=fixture();
  const grass=createMicroGrass(ctx);
  const generated=grass.generatedTiles;
  const first=grass.mesh;
  const actors=first.material.userData.grassUniforms.fcGrassActors.value;
  const guest=(x,z)=>({group:{position:{x,z}}});
  ctx.avatars.set(1,guest(7,6));
  ctx.avatars.set(2,guest(8,6));
  ctx.avatars.set(3,guest(5,8));
  ctx.avatars.set(4,guest(9,6));
  ctx.avatars.set(5,guest(100,100));
  ctx.px+=.6;
  assert.equal(grass.tick(),false,'sub-tile movement should not rebuild mesh data');
  assert.equal(grass.generatedTiles,generated);
  assert.equal(grass.mesh,first);
  assert.equal(actors[0].x,ctx.px);
  assert.equal(actors[0].y,ctx.pz);
  assert.ok(actors[1].w>0,'recently disturbed trail is retained');
  assert.ok(actors.slice(3).every(a=>a.w===1),'three nearby remotes fill slots');
  assert.ok(actors.slice(3).every(a=>a.x<20),'far remote is excluded');
  ctx.avatars.clear();
  grass.tick();
  assert.ok(actors.slice(3).every(a=>a.w===0),'remote slots clear on disconnect');
  grass.dispose();
  assert.equal(sceneItems.size,0);
  assert.ok([...meshes].every(m=>m.disposed===1),'all owned instance buffers disposed once');
  assert.ok([...geometries].every(g=>g.disposed===1),'shared and per-page geometries disposed once');
  assert.ok([...materials].every(m=>m.disposed===1),'shared materials disposed once');
});

test('far LOD keeps a separate shared shader without actor collision work',()=>{
  const {ctx,sceneItems}=fixture({radius:30,density:3});
  const grass=createMicroGrass(ctx);
  const far=[...sceneItems].find(mesh=>mesh.userData.grassTier==='far');
  assert.ok(far,'radius over 24m enables far LOD');
  const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>'};
  far.material.onBeforeCompile(shader);
  assert.doesNotMatch(shader.vertexShader,/fcGrassActors|fcPush/);
  assert.equal(shader.uniforms.fcGrassActors,undefined);
  grass.dispose();
});

test('footprints fade out after 450ms and grass size/width/angle uniforms update live',()=>{
  const originalNow=performance.now;
  let time=100;
  performance.now=()=>time;
  try {
    const {ctx}=fixture();
    const grass=createMicroGrass(ctx);
    const uniforms=grass.mesh.material.userData.grassUniforms;
    assert.equal(uniforms.fcGrassActors.value[1].w,0);
    ctx.px+=.7;
    time+=100;
    assert.equal(grass.tick(),false);
    assert.ok(uniforms.fcGrassActors.value[1].w>0);
    ctx.settings.grassMinSize=3;
    ctx.settings.grassMaxSize=6;
    ctx.settings.grassWidth=2;
    ctx.settings.grassTurnMin=-60;
    ctx.settings.grassTurnMax=15;
    grass.tick();
    assert.equal(uniforms.fcGrassSizeRange.value.x,3);
    assert.equal(uniforms.fcGrassSizeRange.value.y,6);
    assert.equal(uniforms.fcGrassWidth.value,2);
    assert.ok(Math.abs(uniforms.fcGrassTurnRange.value.x+Math.PI/3)<1e-10);
    assert.ok(Math.abs(uniforms.fcGrassTurnRange.value.y-Math.PI/12)<1e-10);
    time+=451;
    grass.tick();
    assert.equal(uniforms.fcGrassActors.value[1].w,0);
    assert.equal(uniforms.fcGrassActors.value[2].w,0);
    grass.dispose();
  } finally {performance.now=originalNow;}
});

test('repeated tile streaming keeps page cache bounded without leaking GPU resources',()=>{
  const {ctx,sceneItems,meshes,geometries,materials}=fixture({radius:12,density:3});
  const grass=createMicroGrass(ctx);
  for(let i=1;i<=24;i++){
    ctx.px=i*13;
    ctx.pz=6+i*7;
    assert.equal(grass.tick(),true,'moving across a tile grid streams new pages');
    assert.ok(sceneItems.size<=20,'near visible tiles remain bounded');
    assert.ok(grass.tiles<=20);
  }
  const live=[...meshes].filter(m=>m.disposed===0);
  assert.ok(live.length<=grass.tiles+8,'old instances returned to a small shared pool');
  assert.equal(materials.size,2,'never allocates materials while streaming');
  grass.dispose();
  assert.ok([...meshes].every(m=>m.disposed===1),'all paged meshes are cleaned up');
  assert.ok([...geometries].every(g=>g.disposed===1),'no GPU geometry leak after streaming');
});

test('campfire, sign, bench and placed logs clear grass through shared shader uniforms',()=>{
  const {ctx,sceneItems}=fixture({radius:30,density:3});
  ctx.chunks=new Map([['0,0',{userData:{grassClearings:[
    {x:5,z:5,radius:1.65},{x:12,z:4.8,radius:.85},
  ]}}]]);
  ctx.crafting={items:new Map([[1,{x:7,z:8,orientation:0}]])};
  ctx.placed=[{x:9,z:9,level:0},{x:15,z:15,level:1}];
  const grass=createMicroGrass(ctx);
  const near=[...sceneItems].find(mesh=>mesh.userData.grassTier==='near');
  const far=[...sceneItems].find(mesh=>mesh.userData.grassTier==='far');
  for(const mesh of [near,far]){
    const u=mesh.material.userData.grassUniforms.fcGrassClearings.value;
    assert.equal(u.filter(slot=>slot.w===1).length,4);
    assert.ok(u.some(slot=>slot.x===5 && slot.y===5 && slot.z===1.65));
    assert.ok(u.some(slot=>slot.x===7 && slot.y===8 && slot.z===1.55));
    const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>'};
    mesh.material.onBeforeCompile(shader);
    assert.match(shader.vertexShader,/uniform vec4 fcGrassClearings\[24\]/);
    assert.match(shader.vertexShader,/fcVisibility=0\.0/);
  }
  ctx.crafting.items.clear();ctx.placed=[];
  grass.tick();
  assert.equal(near.material.userData.grassUniforms.fcGrassClearings.value
    .filter(slot=>slot.w===1).length,2,'grass restores after removing a bench or log');
  grass.dispose();
});


test('night micro-grass is capped at 30 m independently of daytime grass range',()=>{
 assert.equal(MICRO_GRASS_NIGHT_RADIUS,30);
 for(const day of [12,25,30,50,70,100]){
  assert.equal(effectiveGrassRadius(day,0),day);
  assert.equal(effectiveGrassRadius(day,1),Math.min(day,30));
 }
 assert.equal(effectiveGrassRadius(70,.5),50);
 assert.equal(effectiveGrassRadius(70,0.1),66);
 assert.equal(effectiveGrassRadius(70,-1),70);
 assert.equal(effectiveGrassRadius(70,10),30);
});

test('night mode actually unloads distant grass pages and restores them at dawn',()=>{
 const {ctx,sceneItems}=fixture({radius:70,density:2});
 ctx.terrain.nightBlend=0;
 const grass=createMicroGrass(ctx);
 assert.equal(grass.visibleRadius,70);
 const dayPages=grass.tiles,dayDraws=sceneItems.size,generated=grass.generatedTiles;
 assert.ok(dayPages>0);
 ctx.terrain.nightBlend=1;
 assert.equal(grass.tick(),true);
 assert.equal(grass.visibleRadius,30);
 assert.ok(grass.tiles<dayPages,'night reduces actual GPU grass mesh count');
 assert.ok(sceneItems.size<dayDraws,'night removes distant grass draw calls');
 assert.equal(grass.generatedTiles,generated,'night reuses near pages rather than regenerating tiles');
 const nightPages=grass.tiles;
 ctx.terrain.nightBlend=.5;
 assert.equal(grass.tick(),true);
 assert.equal(grass.visibleRadius,50);
 assert.ok(grass.tiles>nightPages,'dusk progressively loads distant tiles');
 ctx.terrain.nightBlend=0;
 assert.equal(grass.tick(),true);
 assert.equal(grass.visibleRadius,70);
 assert.equal(grass.tiles,dayPages,'dawn restores the daytime distance');
 assert.ok(grass.cacheHits>0,'dawn reuses cached grass samples after night culling');
 assert.ok(grass.generatedTiles>=generated,'reloaded GPU pages recreate instances as needed');
 grass.dispose();
 assert.equal(sceneItems.size,0);
});

test('night grass cap never increases an already shorter daytime setting',()=>{
 const {ctx}=fixture({radius:20,density:2});
 const grass=createMicroGrass(ctx);
 const tiles=grass.tiles;
 ctx.terrain.nightBlend=1;
 assert.equal(grass.tick(),false);
 assert.equal(grass.visibleRadius,20);
 assert.equal(grass.tiles,tiles);
 grass.dispose();
});


test('distant density falls smoothly with distance but nearby density stays intact',()=>{
  assert.equal(grassDistanceDensity(0,50),1);
  assert.equal(grassDistanceDensity(26,50),1);
  assert.equal(grassDistanceDensity(50,50),.38);
  assert.equal(grassDistanceDensity(12,24),1);
  assert.ok(grassDistanceDensity(32,50)>grassDistanceDensity(40,50));
  assert.ok(grassDistanceDensity(40,50)>grassDistanceDensity(47,50));
  assert.equal(grassDistanceDensity(500,50),.38);
});

test('renderer culls whole grass tiles by tighter AABBs and draws fewer far instances',()=>{
  const {ctx,sceneItems,meshes}=fixture({radius:65,density:5});
  const grass=createMicroGrass(ctx);
  const near=[...sceneItems].filter(mesh=>mesh.userData.grassTier==='near');
  const far=[...sceneItems].filter(mesh=>mesh.userData.grassTier==='far');
  assert.ok(near.length>0&&far.length>0);
  const fullCount=new Map([...sceneItems].map(mesh=>[mesh,mesh.count]));
  const generated=grass.generatedTiles;
  // Simulate instance buffers already uploaded; changing draw counts must
  // never re-upload the entire page.
  for(const mesh of sceneItems)mesh.instanceMatrix.needsUpdate=false;
  grass.updateVisibility();
  assert.ok(far.some(mesh=>mesh.count<fullCount.get(mesh)),
    'far geometry really submits fewer instances, not invisible vertices');
  assert.ok(near.every(mesh=>mesh.count<=fullCount.get(mesh)),
    'near tile selection respects conservative per-blade culling');
  const reduced=far.filter(mesh=>mesh.count<fullCount.get(mesh));
  for(const mesh of reduced)assert.equal(mesh.instanceMatrix.needsUpdate,false,
    'density changes never upload new matrices');
  ctx.cullX=0;
  grass.updateVisibility();
  assert.ok([...sceneItems].some(mesh=>!mesh.visible&&mesh.userData.microGrassFrustumHidden),
    'tiles outside the axis-aligned frustum are entirely excluded');
  assert.ok([...sceneItems].some(mesh=>mesh.visible));
  ctx.cullX=Infinity;
  grass.updateVisibility();
  assert.ok([...sceneItems].every(mesh=>mesh.visible),
    'camera rotation re-enables original tile meshes without regenerating them');
  assert.equal(grass.generatedTiles,generated);
  assert.equal(ctx.camera.updated,3);
  grass.dispose();
  assert.ok([...meshes].every(mesh=>mesh.disposed===1));
});

test('distance width correction is shared by both grass geometry LODs',()=>{
  const {ctx,sceneItems}=fixture({radius:50,density:4});
  const grass=createMicroGrass(ctx);
  const far=[...sceneItems].find(mesh=>mesh.userData.grassTier==='far');
  const near=[...sceneItems].find(mesh=>mesh.userData.grassTier==='near');
  const compile=material=>{
    const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>'};
    material.onBeforeCompile(shader);return shader;
  };
  const farShader=compile(far.material),nearShader=compile(near.material);
  assert.match(farShader.vertexShader,/uniform vec4 fcGrassDensityLod/);
  assert.match(farShader.vertexShader,/fcWidthLod = 1\.0 \+ fcDensityT \* fcGrassDensityLod\.z/);
  assert.match(nearShader.vertexShader,/fcWidthLod = 1\.0 \+ fcDensityT \* fcGrassDensityLod\.z/);
  assert.match(farShader.vertexShader,/fcGrassPriority/);
  assert.match(farShader.vertexShader,/fcBladeFade/);
  assert.equal(farShader.uniforms.fcGrassDensityLod.value.z,.30);
  assert.equal(farShader.uniforms.fcGrassDensityLod.value.w,.005);
  assert.equal(nearShader.uniforms.fcGrassDensityLod.value.z,.30);
  grass.dispose();
});


test('cheap grass mode still reduces distant instance counts without a costly shader',()=>{
  const {ctx,sceneItems}=fixture({radius:60,density:6});
  ctx.settings.grassInteraction=false;
  const grass=createMicroGrass(ctx);
  const far=[...sceneItems].filter(mesh=>mesh.userData.grassTier==='far');
  const before=far.map(mesh=>mesh.count);
  grass.updateVisibility();
  assert.ok(far.some((mesh,i)=>mesh.count<before[i]));
  for(const mesh of far){
    const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>'};
    mesh.material.onBeforeCompile(shader);
    assert.match(shader.vertexShader,/fcGrassDensityLod/);
    assert.doesNotMatch(shader.vertexShader,/fcGrassActors|fcGrassClearings|fcGrassProfile/);
  }
  grass.dispose();
});


test('three distance LOD parameters update existing instances and both shader tiers live',()=>{
  const {ctx,sceneItems}=fixture({radius:65,density:5});
  ctx.settings.grassFullDensityDistance=26;
  ctx.settings.grassFarDensityPercent=38;
  ctx.settings.grassFarWidthBonus=30;
  const grass=createMicroGrass(ctx);
  grass.updateVisibility();
  const tiles=[...sceneItems];
  const originalCount=new Map(tiles.map(mesh=>[mesh,mesh.count]));
  const generated=grass.generatedTiles;
  for(const mesh of tiles)mesh.instanceMatrix.needsUpdate=false;

  ctx.settings.grassFarDensityPercent=100;
  ctx.settings.grassFarWidthBonus=0;
  grass.tick();
  grass.updateVisibility();
  assert.ok(tiles.every(mesh=>mesh.count>=originalCount.get(mesh)));
  assert.ok(tiles.every(mesh=>mesh.instanceMatrix.needsUpdate===false));
  const shaderUniform=tiles[0].material.userData.grassUniforms.fcGrassDensityLod.value;
  assert.equal(shaderUniform.x,26);
  assert.equal(shaderUniform.z,0);

  ctx.settings.grassFullDensityDistance=10;
  ctx.settings.grassFarDensityPercent=0;
  ctx.settings.grassFarWidthBonus=100;
  ctx.settings.grassDensitySharpness=.4;
  grass.tick();
  grass.updateVisibility();
  assert.equal(shaderUniform.x,10);
  assert.equal(shaderUniform.z,1);
  assert.equal(shaderUniform.w,.4);
  const near=tiles.filter(mesh=>mesh.userData.grassTier==='near');
  const far=tiles.filter(mesh=>mesh.userData.grassTier==='far');
  assert.ok(near.every(mesh=>mesh.count<=originalCount.get(mesh)),
    'reducing the full-density radius does not increase near page draws');
  assert.ok(far.some(mesh=>mesh.count<originalCount.get(mesh)),
    'distant density decreases as the minimum percent approaches zero');
  assert.equal(grass.generatedTiles,generated,'LOD slider changes reuse existing pages');
  assert.ok(tiles.every(mesh=>mesh.instanceMatrix.needsUpdate===false),
    'no instance buffer upload for slider changes');
  grass.dispose();
});

test('distance LOD full-density radius can exceed grass render radius',()=>{
  assert.equal(grassDistanceDensity(13,12,{nearEnd:30,minDensity:0}),1);
  assert.equal(grassDistanceDensity(30,50,{nearEnd:30,minDensity:.25}),1);
  assert.equal(grassDistanceDensity(48,50,{nearEnd:30,minDensity:.25}),.25);
  assert.equal(grassDistanceDensity(48,50,{nearEnd:30,minDensity:1}),1);
  assert.equal(grassDistanceDensity(48,50,{nearEnd:30,minDensity:0}),0);
});

test('rational density sharpness retains grass until the far boundary',()=>{
  const opts={nearEnd:26,minDensity:.38};
  const at=distance=>grassDistanceDensity(distance,50,{...opts,sharpness:8});
  assert.equal(at(26),1);
  assert.equal(at(48),.38);
  assert.ok(at(38)>.5,'high k keeps considerable density halfway');
  assert.ok(at(46)>at(47),'density drops most sharply near cutoff');
  const linear=grassDistanceDensity(38,50,{...opts,sharpness:1});
  assert.ok(at(38)>linear);
});

test('k=0 keeps coefficient independent and small k behaves normally',()=>{
  assert.equal(grassDistanceDensity(50,50,{sharpness:0,minDensity:.38}),.38);
  assert.ok(grassDistanceDensity(30,50,{sharpness:.005,minDensity:.38}) > .95,
    'small k should preserve grass just after the full-density zone');
  assert.ok(grassDistanceDensity(42,50,{sharpness:.005,minDensity:.38}) < .8,
    'small k still thins the grass toward the far boundary');
  assert.ok(grassDistanceDensity(30,50,{sharpness:5,minDensity:.38}) > .99);
});

test('grass can start reducing from the player position at 0m',()=>{
  assert.equal(grassDistanceDensity(0,50,{nearEnd:0}),1);
  assert.ok(grassDistanceDensity(10,50,{nearEnd:0})<1);
});


test('stable priorities and conservative bounds do not exclude potentially visible blades',()=>{
  const {ctx,sceneItems}=fixture({radius:60,density:5});
  ctx.settings.grassFullDensityDistance=0;
  ctx.settings.grassDensitySharpness=.3;
  ctx.settings.grassFarDensityPercent=18;
  const grass=createMicroGrass(ctx);
  const pages=[...sceneItems];
  const original=pages.map(mesh=>[mesh,[...mesh.matrices.values()].map(m=>
    [m.position.x,m.position.z])]);
  grass.updateVisibility();
  for(const [mesh,positions] of original){
    const priorities=mesh.geometry.getAttribute('fcGrassPriority').array;
    let previous=-1;
    for(let i=0;i<positions.length;i++){
      const rank=priorities[i];
      assert.ok(rank>previous,'static deterministic priority ordering');
      previous=rank;
      const [x,z]=positions[i];
      const coverage=grassDistanceDensity(Math.hypot(x-ctx.px,z-ctx.pz),60,{
        nearEnd:0,minDensity:.18,sharpness:.3,
      });
      if(i>=mesh.count)assert.ok(coverage<=rank-.045+1e-6,
        'CPU may omit only instances already fully hidden by shader');
    }
  }
  ctx.px+=.8;
  ctx.pz+=.5;
  grass.tick();
  grass.updateVisibility();
  for(const [mesh,positions] of original){
    assert.deepEqual([...mesh.matrices.values()].map(m=>[m.position.x,m.position.z]),
      positions,'player movement never swaps or regenerates grass positions');
  }
  grass.dispose();
});

test('small k retains nearby grass while smoothly reaching far density',()=>{
  const config={nearEnd:0,minDensity:.38,sharpness:.05};
  const density=d=>grassDistanceDensity(d,50,config);
  assert.equal(density(0),1);
  assert.ok(density(2)>.999,'first few meters must remain fully covered');
  assert.ok(density(5)>.99,'near foliage should not disappear at k=0.05');
  assert.ok(density(10)>.96,'fades gradually without a near-density cliff');
  assert.ok(density(25)<density(10),'thinning remains useful in mid-distance');
  assert.equal(density(48),.38);
  assert.ok(density(5)>grassDistanceDensity(5,50,{...config,sharpness:.005})-0.01);
  assert.ok(grassDistanceDensity(25,50,{...config,sharpness:.5})>density(25),
    'higher k preserves more grass farther out');
});

test('shader and CPU share the same cubic/quadratic stable falloff',()=>{
  const {ctx,sceneItems}=fixture({radius:50,density:4});
  const grass=createMicroGrass(ctx);
  for(const material of new Set([...sceneItems].map(mesh=>mesh.material))){
    const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>'};
    material.onBeforeCompile(shader);
    assert.match(shader.vertexShader,/fcNear = fcDistanceT\*fcDistanceT\*fcDistanceT/);
    assert.match(shader.vertexShader,/fcGrassDensityShape\.x\+fcGrassDensityLod\.w/);
    assert.match(shader.vertexShader,/fcGrassDensityShape\.y-fcDistanceT/);
    assert.doesNotMatch(shader.vertexShader,/pow\(fcDistanceT/);
  }
  grass.dispose();
});

test('independent formula parameters change density and remain finite at zero',()=>{
  const opts={nearEnd:0,minDensity:.38,sharpness:.005};
  const at=(d,extra={})=>grassDistanceDensity(d,50,{...opts,...extra});
  const near=t=>t*t*t,far=(a,t)=>(a-t)*(a-t);
  for(const a of [0,.5,1,2,3])
    for(const c of [0,.25,2,3]){
      const t=25/48,denom=near(t)+(c+.005)*far(a,t);
      const wanted=.38+.62*(1-near(t)/denom);
      assert.ok(Math.abs(at(25,{coefficient:c,offset:a})-wanted)<1e-12);
    }
  assert.ok(at(25,{coefficient:0})<at(25,{coefficient:1}));
  assert.ok(at(25,{offset:0})>at(25,{offset:1}));
  assert.equal(at(0,{coefficient:0,offset:0,sharpness:0}),1);
  assert.ok(Number.isFinite(at(25,{coefficient:0,offset:0,sharpness:0})));
  assert.equal(at(25,{coefficient:0,offset:0,sharpness:0}),.38);
});

test('for nonmonotonic offset below 1 CPU renders full tiles for safe shader LOD',()=>{
  const {ctx,sceneItems}=fixture({radius:50,density:5});
  ctx.settings.grassFullDensityDistance=0;
  ctx.settings.grassDensitySharpness=.005;
  ctx.settings.grassDensityCoefficient=.25;
  ctx.settings.grassDensityOffset=.5;
  const grass=createMicroGrass(ctx);
  grass.updateVisibility();
  assert.ok([...sceneItems].every(mesh=>mesh.count===mesh.geometry.getAttribute('fcGrassPriority').array.filter(x=>x>0).length),
    'non-monotonic settings may not remove tiles from the CPU side');
  const uniform=[...sceneItems][0].material.userData.grassUniforms.fcGrassDensityShape.value;
  assert.equal(uniform.x,.25);
  assert.equal(uniform.y,.5);
  grass.dispose();
});


test('game replaces low-poly grass with editor-curved four-leaf clumps',()=>{
  const {ctx,sceneItems}=fixture({radius:12,density:2});
  Object.assign(ctx.settings,GRASS_CLUSTER_DEFAULTS,{grassClusterEnabled:true,
    grassClusterDensity:30});
  const grass=createMicroGrass(ctx);
  const mesh=[...sceneItems].find(v=>v.userData.grassTier==='near');
  assert.ok(mesh);
  assert.equal(mesh.geometry.getAttribute('fcBladeProgress').count,
    GRASS_CLUSTER_DEFAULTS.grassClusterBlades*
    (GRASS_CLUSTER_DEFAULTS.grassClusterTriangles+2));
  const pos=mesh.matrices.get(0);
  assert.ok(pos.scale.y>=GRASS_CLUSTER_DEFAULTS.grassClusterMinHeight);
  assert.ok(pos.scale.y<=GRASS_CLUSTER_DEFAULTS.grassClusterMaxHeight);
  assert.equal(pos.scale.x,1);
  assert.equal(mesh.material.userData.grassUniforms.fcGrassWindSpeed.value,
    GRASS_CLUSTER_DEFAULTS.grassClusterWindSpeed);
  const originalCount=grass.generatedTiles;
  ctx.settings.grassClusterWindSpeed=.15;
  grass.tick();
  assert.equal(mesh.material.userData.grassUniforms.fcGrassWindSpeed.value,.15);
  assert.equal(grass.generatedTiles,originalCount,
    'wind animation is a uniform, no tile rebuild');
  const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',
    fragmentShader:'#include <common>\n#include <color_fragment>'};
  mesh.material.onBeforeCompile(shader);
  assert.match(shader.vertexShader,/fcBladeCentre/);
  assert.match(shader.vertexShader,/fcGrassDensityShape/);
  assert.match(shader.vertexShader,/fcGrassDensityCurve/);
  assert.match(shader.vertexShader,/fcGrassWindSpeed/);
  assert.match(shader.vertexShader,/fcGrassPriority/);
  assert.match(shader.vertexShader,/fcGrassClearings/);
  grass.dispose();
});

test('curved two-sided grass shaders expose normals, AO and backlight controls',()=>{
  for(const simple of [false,true]){
    const {ctx,sceneItems}=fixture({radius:12,density:2});
    Object.assign(ctx.settings,GRASS_CLUSTER_DEFAULTS,{
      grassClusterEnabled:true,grassClusterDensity:20,
      grassInteraction:!simple,
    });
    ctx.sun={
      position:{x:25,y:90,z:15},target:{position:{x:0,y:0,z:0}},intensity:2,
    };
    const grass=createMicroGrass(ctx);
    const mesh=[...sceneItems].find(m=>m.userData.grassTier==='near');
    assert.ok(mesh);
    const shader={
      uniforms:{},
      vertexShader:'#include <common>\n#include <begin_vertex>',
      fragmentShader:'#include <common>\n#include <color_fragment>',
    };
    mesh.material.onBeforeCompile(shader);
    assert.match(shader.vertexShader,/fcBladeTangent/);
    assert.match(shader.vertexShader,/vFcSmoothLight/);
    assert.match(shader.vertexShader,/fcGrassSunDirection/);
    assert.match(shader.fragmentShader,/fcGrassProceduralNormals/);
    assert.match(shader.fragmentShader,/fcGrassAOIntensity/);
    assert.match(shader.fragmentShader,/fcGrassTranslucencyIntensity/);
    assert.equal(shader.uniforms.fcGrassSunDirection,
      mesh.material.userData.grassUniforms.fcGrassSunDirection);
    const sunlight=shader.uniforms.fcGrassSunPower;
    assert.ok(sunlight.value>.1);
    const generated=grass.generatedTiles;
    ctx.sun.intensity=0;
    grass.tick();
    assert.equal(sunlight.value,0);
    assert.equal(grass.generatedTiles,generated);
    grass.dispose();
  }
});

test('legacy grass shaders keep original normal lighting and no cluster attributes',()=>{
  const {ctx,sceneItems}=fixture();
  ctx.settings.grassClusterEnabled=false;
  const grass=createMicroGrass(ctx);
  const mesh=[...sceneItems].find(m=>m.userData.grassTier==='near');
  const shader={
    uniforms:{},
    vertexShader:'#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
    fragmentShader:'#include <common>\n#include <opaque_fragment>',
  };
  mesh.material.onBeforeCompile(shader);
  assert.doesNotMatch(shader.vertexShader,/fcBulgedNormal|fcGrassRibbonSide/);
  assert.doesNotMatch(shader.fragmentShader,/fcGrassTransmission/);
  grass.dispose();
});

test('far clustered grass keeps coverage but uses fewer triangles per leaf',()=>{
  const {ctx,sceneItems}=fixture({radius:38,density:1});
  Object.assign(ctx.settings,GRASS_CLUSTER_DEFAULTS,{
    grassClusterEnabled:true,grassClusterDensity:12,
  });
  const grass=createMicroGrass(ctx);
  const near=[...sceneItems].find(mesh=>mesh.userData.grassTier==='near');
  const far=[...sceneItems].find(mesh=>mesh.userData.grassTier==='far');
  assert.ok(near&&far,'both tiers must load');
  assert.equal(near.geometry.indices.length/3,
    GRASS_CLUSTER_DEFAULTS.grassClusterBlades*GRASS_CLUSTER_DEFAULTS.grassClusterTriangles);
  assert.equal(far.geometry.indices.length/3,
    GRASS_CLUSTER_DEFAULTS.grassClusterBlades*2);
  grass.dispose();
});
