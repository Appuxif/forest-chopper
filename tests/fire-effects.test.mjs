import test from 'node:test';
import assert from 'node:assert/strict';
import {FIRE_TIERS,TORCH_TIERS,resolveFireTier,fireBaseRadius,fireHeight,
 createFireEffects,SMOKE_OPACITY,firePreset,createFireVisibilityTester} from '../src/fire-effects.js';
import {presentCampfireModel,disposeCampfireEffects} from '../src/campfire-model.js';

test('source-generator counts and distance LOD for four quality presets',()=>{
 assert.deepEqual([FIRE_TIERS.ultra,FIRE_TIERS.high,FIRE_TIERS.medium],
  [{smoke:30,flames:7,sparks:6},{smoke:10,flames:3,sparks:3},{smoke:0,flames:1,sparks:1}]);
 assert.deepEqual([TORCH_TIERS.ultra,TORCH_TIERS.high,TORCH_TIERS.medium],
  [{smoke:20,flames:5,sparks:3},{smoke:10,flames:2,sparks:1},{smoke:0,flames:1,sparks:0}]);
 for(const [preset,expected] of Object.entries({
  ultra:['ultra','high','glow'],high:['high','medium','glow'],
  medium:['medium','low','glow'],low:['low','glow','glow']})){
  assert.deepEqual([resolveFireTier(preset,49.99),resolveFireTier(preset,50),resolveFireTier(preset,100)],expected);
 }
 assert.equal(resolveFireTier('ultra',99.99),'high');
 assert.equal(SMOKE_OPACITY,.1);
 assert.equal(fireHeight('campfire'),1.0);
 assert.equal(fireHeight('torch'),.6);
 assert.ok(Math.abs(fireBaseRadius('campfire')-.35)<1e-12);
 assert.equal(fireBaseRadius('torch'),.145*.7);
 assert.equal(firePreset({performancePreset:'high'}),'high');
 assert.equal(firePreset({performancePreset:'custom',quality:'balanced'}),'high');
});

function gpuFixture(){
 const meshes=[];
 class Obj{
  constructor(){
   this.userData={};this.children=[];this.visible=true;
   this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z})}};
   this.scale={x:1,y:1,z:1,set(x,y,z){Object.assign(this,{x,y,z})},setScalar(n){this.x=this.y=this.z=n;}};
   this.rotation={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z})}};
   this.matrix={};
  }
  add(obj){this.children.push(obj)}
  remove(obj){this.children=this.children.filter(x=>x!==obj)}
  updateMatrix(){this.matrix={position:{x:this.position.x,y:this.position.y,z:this.position.z},rotation:{x:this.rotation.x,y:this.rotation.y,z:this.rotation.z},scale:{x:this.scale.x,y:this.scale.y,z:this.scale.z}};}
 }
 class Geo{
  constructor(...args){this.args=args;this.attributes={};this.disposed=false;}
  translate(){return this;}
  setAttribute(name,value){this.attributes[name]=value;}
  dispose(){this.disposed=true;}
 }
 class Mat{
  constructor(config={}){Object.assign(this,config);this.disposed=false;}
  dispose(){this.disposed=true;}
 }
 class Instanced extends Obj{
  constructor(geo,material,count){
   super();this.geometry=geo;this.material=material;this.count=count;this.matrices=new Array(count);
   this.instanceMatrix={needsUpdate:false,setUsage(value){this.usage=value;}};
   this.disposeCalls=0;meshes.push(this);
  }
  setMatrixAt(i,m){this.matrices[i]=structuredClone(m);}
  dispose(){this.disposeCalls++;}
 }
 class Sprite extends Obj{
  constructor(material){super();this.material=material;}
 }
 const THREE={
  Group:Obj,Object3D:Obj,InstancedMesh:Instanced,Sprite,
  ConeGeometry:Geo,SphereGeometry:Geo,InstancedBufferAttribute:class{constructor(a,n){this.array=a;this.itemSize=n;}},
  ShaderMaterial:Mat,MeshBasicMaterial:Mat,SpriteMaterial:Mat,CanvasTexture:class{},
  AdditiveBlending:2,DoubleSide:3,FrontSide:4,DynamicDrawUsage:5,
 };
 return {THREE,meshes,root:new Obj()};
}

test('one instanced GPU draw per effect, LOD switches counts without rebuilding',()=>{
 const {THREE,root,meshes}=gpuFixture();
 const originalDoc=globalThis.document;
 globalThis.document={createElement:()=>({getContext:()=>({
  createRadialGradient:()=>({addColorStop(){}}),fillRect(){},
 })})};
 try{
  const fx=createFireEffects(THREE,root,'campfire');
  assert.equal(meshes.length,3);
  assert.equal(fx.glow!==null,true);
  assert.equal(root.children.length,1);
  fx.setTier('ultra');
  assert.ok(Math.abs(fx.visualScale-(.80/1.45))<1e-12);
  assert.deepEqual([fx.smoke.count,fx.flames.count,fx.sparks.count],[30,7,6]);
  assert.ok(fx.flames.matrices[6]);
  fx.tick(1000,{x:4,y:3,z:4},{x:0,y:0,z:0});
  assert.equal(fx.smoke.matrices.filter(Boolean).length,30);
  assert.equal(fx.sparks.matrices.filter(Boolean).length,6);
  assert.equal(fx.flames.material.uniforms.uTime.value,1);
  const originalMatrix=fx.smoke.matrices[0];
  fx.tick(1001,{x:4,y:3,z:4},{x:0,y:0,z:0});
  assert.equal(fx.smoke.matrices[0],originalMatrix,'smoke matrix upload capped at ~30fps');
  fx.setTier('high');
  assert.deepEqual([fx.smoke.count,fx.flames.count,fx.sparks.count],[10,3,3]);
  fx.setTier('medium');
  assert.deepEqual([fx.smoke.count,fx.flames.count,fx.sparks.count],[0,1,1]);
  assert.equal(fx.flames.matrices[0].scale.x*fx.visualScale>fireBaseRadius('campfire'),true,'medium flame is wider');
  fx.setTier('glow');
  assert.equal(fx.glow.visible,true);
  assert.ok([fx.smoke,fx.flames,fx.sparks].every(mesh=>!mesh.visible));
  fx.setTier('off');
  assert.equal(fx.glow.visible,false);
  assert.equal(meshes.length,3,'no added meshes when tier changes');
  fx.dispose();
  assert.equal(root.children.length,0);
  assert.ok(meshes.every(mesh=>mesh.disposeCalls===1));
  assert.equal(fx.smoke.geometry.disposed,false,'shared geometry never disposed by individual fire');
 }finally{globalThis.document=originalDoc;}
});

test('torch uses reduced particle counts, 20cm flames and source spark scaling',()=>{
 const {THREE,root}=gpuFixture();
 const fx=createFireEffects(THREE,root,'torch');
 fx.setTier('ultra');
 assert.deepEqual([fx.smoke.count,fx.flames.count,fx.sparks.count],[20,5,3]);
 assert.equal(fx.anchor.position.y,1.48);
 assert.ok(Math.abs(fx.visualScale-(.60/1.45))<1e-12);
 assert.equal(fx.smoke.material.uniforms.uOpacity.value,SMOKE_OPACITY);
 const y=fx.flames.matrices[0].scale.y;
 assert.ok(y*fx.visualScale>=.3&&y*fx.visualScale<=1.2,'torch stays near 60cm instead of 2m');
 fx.tick(1000,{x:0,y:2,z:0},{x:0,y:0,z:0});
 assert.equal(fx.smoke.matrices.filter(Boolean).length,20);
 fx.setTier('medium');
 assert.equal(fx.sparks.visible,false);
 fx.dispose();
});

test('primary outer flame is centred for campfire and torch at every tier',()=>{
 for(const kind of ['campfire','torch']){
  const {THREE,root}=gpuFixture();
  const fx=createFireEffects(THREE,root,kind);
  for(const tier of ['ultra','high','medium']){
   fx.setTier(tier);
   const primary=fx.flames.matrices[0].position;
   assert.equal(primary.x,0,kind+' '+tier+' outer x');
   assert.equal(primary.z,0,kind+' '+tier+' outer z');
   if(fx.flames.count>1){
    const secondary=fx.flames.matrices[1].position;
    assert.ok(Math.hypot(secondary.x,secondary.z)>0,kind+' secondary tongues keep their variation');
   }
  }
  fx.dispose();
 }
});

test('existing low-poly meshes remain default and are reused after downshifting',()=>{
 const {THREE,root,meshes}=gpuFixture();
 const legacy=()=>({visible:false,scale:{set(){}}});
 root.userData={flame:legacy(),innerFlame:legacy(),sparks:[legacy()],fireKind:'campfire'};
 const ctx={THREE,settings:{performancePreset:'low',flameBillboard:false}};
 assert.equal(presentCampfireModel(ctx,root,{lit:true,distance:5}),'low');
 assert.equal(root.userData.flame.visible,true);
 assert.equal(meshes.length,0,'legacy path allocates no new particle batches');
 ctx.settings.performancePreset='ultra';
 assert.equal(presentCampfireModel(ctx,root,{lit:true,distance:5}),'ultra');
 assert.equal(meshes.length,3);
 assert.equal(root.userData.flame.visible,false);
 assert.equal(root.userData.fireEffects.smoke.count,30);
 assert.equal(presentCampfireModel(ctx,root,{lit:true,distance:100}),'glow');
 assert.equal(root.userData.fireEffects.flames.visible,false);
 assert.equal(presentCampfireModel(ctx,root,{lit:false,distance:1}),'off');
 ctx.settings.performancePreset='low';
 assert.equal(presentCampfireModel(ctx,root,{lit:true,distance:10}),'low');
 assert.equal(root.userData.flame.visible,true);
 assert.equal(meshes.length,3,'no duplicate meshes on quality change');
 disposeCampfireEffects(root);
 assert.equal(root.userData.fireEffects,null);
});

test('frustum check uses one updated camera frustum and skips off-screen fires',()=>{
 class Matrix4{multiplyMatrices(){return this;}}
 class Vector3{set(x,y,z){Object.assign(this,{x,y,z});}}
 class Sphere{set(center,radius){this.center={...center};this.radius=radius;return this;}}
 class Frustum{
  setFromProjectionMatrix(){this.prepared=true;return this;}
  intersectsSphere(s){return s.center.x<50;}
 }
 let calls=0;
 const ctx={
  THREE:{Matrix4,Vector3,Sphere,Frustum},
  camera:{projectionMatrix:{},matrixWorldInverse:{},updateMatrixWorld(){calls++}},
 };
 const tester=createFireVisibilityTester(ctx);
 tester.begin();
 assert.equal(tester.visible(5,0,5,'campfire',10),true);
 assert.equal(tester.visible(60,0,5,'campfire',60),false);
 assert.equal(calls,1,'frustum matrix calculated once per tick');
});

test('instanced flames and initial smoke/embers reproduce HTML generator seeded layout',()=>{
 // Standalone HTML randomState=712903, with three random calls per log.
 let state=712903;
 const rand=()=>((state=(1664525*state+1013904223)>>>0)/4294967296);
 const between=(min,max)=>min+(max-min)*rand();
 for(let i=0;i<5;i++){between(-.04,.13);between(-.14,.14);between(-.14,.14);}
 const originalFlames=[];
 for(let i=0;i<48;i++){
  const a=between(0,Math.PI*2),r=i<4?between(0,.2):between(.15,.57);
  const seed=between(0,100),rot=between(0,Math.PI*2);
  const total=between(.66,1.40)*(i<3?1.16:1);
  const width=between(.85,1.15),height=between(.78,1.23);
  if(i<10)originalFlames.push({x:Math.cos(a)*r,z:Math.sin(a)*r,seed,rot,total,width,height});
 }
 const originalPuffs=[];
 for(let i=0;i<660;i++){
  const puff={phase:rand(),angle:between(0,Math.PI*2),
   radius:Math.sqrt(rand()),seed:between(0,300),rise:between(.75,1.36),
   shape:[between(.72,1.42),between(.74,1.5),between(.73,1.45)]};
  if(i<30)originalPuffs.push(puff);
 }
 const originalEmbers=[];
 for(let i=0;i<160;i++){
  const ember={phase:rand(),angle:between(0,6.28),radius:between(.1,.55),
   velocity:between(.18,.48),seed:between(0,40)};
  if(i<6)originalEmbers.push(ember);
 }
 const {THREE,root}=gpuFixture();
 const fx=createFireEffects(THREE,root,'campfire');
 fx.setTier('ultra');
 const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,String(a)+' differs from reference '+String(b));
 for(let i=0;i<7;i++){
  const expected=originalFlames[i],actual=fx.flames.matrices[i];
  const factor=expected.total;
  approx(actual.position.x,i===0?0:expected.x);
  approx(actual.position.z,i===0?0:expected.z);
  approx(actual.rotation.y,expected.rot);
  approx(actual.scale.x*fx.visualScale,.35*factor*expected.width);
  approx(actual.scale.y*fx.visualScale,1.00*factor*expected.height);
  approx(actual.position.y*fx.visualScale+fx.anchor.position.y,.25+.41*fx.visualScale-.20);
  approx(fx.flames.geometry.attributes.aSeed.array[i],expected.seed);
 }
 fx.tick(0,{x:6,y:3,z:6},{x:0,y:0,z:0});
 const smokeYs=fx.smoke.matrices.slice(0,30).map(p=>p.position.y).sort((a,b)=>a-b);
 const expectedYs=originalPuffs.map(p=>.74+7.6*p.phase+
  Math.sin(p.seed)*.05*p.phase).sort((a,b)=>a-b);
 for(let i=0;i<30;i++)approx(smokeYs[i],expectedYs[i]);
 for(let i=0;i<6;i++){
  const e=originalEmbers[i],p=fx.sparks.matrices[i].position;
  approx(p.x,Math.cos(e.angle)*e.radius+Math.sin(e.seed)*e.phase*.15);
  approx(p.y,.55+e.phase*4.7);
  approx(p.z,Math.sin(e.angle)*e.radius+Math.cos(e.seed)*e.phase*.16);
 }
 fx.dispose();
});


test('all demo systems share a single transform: particle size, smoke rise, sparks and flame height',()=>{
 const {THREE,root}=gpuFixture();
 const fx=createFireEffects(THREE,root,'campfire');fx.setTier('ultra');
 fx.tick(0,{x:5,y:2,z:5},{x:0,y:0,z:0});
 const scale=fx.visualScale;
 assert.ok(Math.abs(scale-.8/1.45)<1e-12);
 assert.equal(fx.anchor.scale.x,scale);
 assert.equal(fx.anchor.scale.y,scale);
 assert.equal(fx.anchor.scale.z,scale);
 assert.ok(fx.smoke.matrices.every(m=>m.scale.x*scale<.85), 'smoke spheres scale with flame');
 assert.ok(fx.sparks.matrices.every(m=>m.scale.x*scale*.035<.08), 'sparks shrink with flame');
 assert.ok(fx.smoke.matrices.every(m=>m.position.y*scale+fx.anchor.position.y<5), 'smoke rise shrinks with flame');
 assert.ok(fx.sparks.matrices.every(m=>m.position.y*scale+fx.anchor.position.y<3), 'sparks rise shrinks with flame');
 fx.dispose();
});


test('billboard glow is hidden before 20m and shown from 20m for fires and torches',()=>{
 for(const kind of ['campfire','torch']){
  const flame={visible:true},innerFlame={visible:true};
  const state={tier:'off',billboard:false};
  const fireEffects={
   setTier(tier){state.tier=tier;},
   setBillboardEnabled(value){state.billboard=value;},
  };
  const group={userData:{flame,innerFlame,sparks:[],fireKind:kind,fireBody:[],fireEffects}};
  const ctx={settings:{performancePreset:'high',flameBillboard:true},THREE:{}};
  const visible=distance=>state.billboard && state.tier!=='off';
  for(const distance of [0,5,19.99]){
   presentCampfireModel(ctx,group,{distance});
   assert.equal(visible(distance),false,kind+' '+distance+'m: no static glow nearby');
  }
  for(const distance of [20,30,99,120]){
   presentCampfireModel(ctx,group,{distance});
   assert.equal(visible(distance),true,kind+' '+distance+'m: distant glow visible');
  }
  ctx.settings.flameBillboard=false;
  presentCampfireModel(ctx,group,{distance:30});
  assert.equal(visible(30),false,kind+': user option still disables billboard');
  ctx.settings.flameBillboard=true;
  presentCampfireModel(ctx,group,{distance:30,lit:false});
  assert.equal(visible(30),false,kind+': unlit fire has no glow');
  presentCampfireModel(ctx,group,{distance:30,onScreen:false});
  assert.equal(visible(30),false,kind+': offscreen fire has no glow');
 }
});
