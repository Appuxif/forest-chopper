import {flatTerrain} from './helpers/flat-terrain.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {gladesForTile,gladeAtPoint,gladeDensity,GLADE_CELL} from '../src/grass-glades.js';
import {generateGrassTile,createMicroGrass,effectiveGrassRadius,MICRO_GRASS_NIGHT_RADIUS} from '../src/micro-grass.js';

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
    getAttribute(key){return this.attributes[key];}
    computeVertexNormals(){}
    clone(){
      const copy=new Geometry();
      for(const [key,attr] of Object.entries(this.attributes))copy.setAttribute(key,attr.clone());
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
  class Object3D {
    constructor(){
      this.position={x:0,y:0,z:0,set:(x,y,z)=>Object.assign(this.position,{x,y,z})};
      this.rotation={x:0,y:0,z:0,set:(x,y,z)=>Object.assign(this.rotation,{x,y,z})};
      this.scale={x:1,y:1,z:1,setScalar:(n)=>Object.assign(this.scale,{x:n,y:n,z:n})};
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
    Vector2,Vector4,Object3D,Color,InstancedMesh,DoubleSide:2,
  };
  const ctx={THREE,terrain:flatTerrain(),scene:{add(mesh){sceneItems.add(mesh);},remove(mesh){sceneItems.delete(mesh);}},
    px:5,pz:6,seed:7812,avatars:new Map(),settings:{
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
