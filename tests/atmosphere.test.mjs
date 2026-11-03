import test from 'node:test';
import assert from 'node:assert/strict';
import {
  celestialDirections,shadowMapSizeForQuality,skyGeometryDistances,selectShadowTrees,
  createAtmosphere,SHADOW_TREE_LIMIT,SHADOW_TREE_RADIUS,SHADOW_UPDATE_MS,
} from '../src/atmosphere.js';

test('celestial positions follow the 16-minute cycle: sun by day, moon by night',()=>{
  const noon=celestialDirections(0);
  const dusk=celestialDirections(.25);
  const midnight=celestialDirections(.5);
  const dawn=celestialDirections(.75);
  assert.ok(noon.sun.y>.8 && noon.moon.y<0);
  assert.ok(Math.abs(dusk.sun.y)<1e-10);
  assert.ok(midnight.sun.y<-.8 && midnight.moon.y>.8);
  assert.ok(Math.abs(dawn.sun.y)<1e-10);
  assert.ok(dusk.sun.x>0 && dawn.sun.x<0,'sun traverses the visible sky');
  assert.deepEqual(celestialDirections(0),celestialDirections(1));
  assert.deepEqual(celestialDirections(.5),celestialDirections(1.5));
  assert.deepEqual(celestialDirections(NaN),noon);
  for(const phase of [0,.17,.25,.5,.75,.99]){
    const {sun,moon}=celestialDirections(phase);
    assert.ok(Math.abs(Math.hypot(sun.x,sun.y,sun.z)-1)<1e-10);
    assert.ok(Math.abs(sun.x+moon.x)<1e-10);
    assert.ok(Math.abs(sun.y+moon.y)<1e-10);
  }
});

test('sky dome and sun/moon fit within every graphics preset far clip distance',()=>{
 for(const [preset,far] of [['low',180],['medium',230],['high',280],['ultra',320]]){
  const {domeRadius,bodyDistance,sunRadius,moonRadius}=skyGeometryDistances(far);
  assert.ok(domeRadius<far,`${preset}: sky dome must be inside far plane`);
  assert.ok(bodyDistance+sunRadius<far,`${preset}: sun must be visible`);
  assert.ok(bodyDistance+moonRadius<far,`${preset}: moon must be visible`);
  assert.ok(bodyDistance<domeRadius,`${preset}: bodies stay inside dome`);
  assert.ok(Math.abs(sunRadius/bodyDistance-6.4/210)<1e-9,
    `${preset}: sun angular size must not change`);
 }
});

test('shadow budget picks nearest trees and honors quality levels',()=>{
  assert.equal(shadowMapSizeForQuality('low'),512);
  assert.equal(shadowMapSizeForQuality('balanced'),1024);
  assert.equal(shadowMapSizeForQuality('high'),2048);
  assert.equal(shadowMapSizeForQuality('broken'),1024);
  const trees=new Map();
  for(let i=0;i<150;i++)trees.set(i,{position:{x:i*.95,z:0}});
  const selected=selectShadowTrees(trees,0,0);
  assert.equal(selected.length,SHADOW_TREE_LIMIT);
  assert.equal(selected[0],trees.get(0));
  assert.ok(selected.at(-1).position.x<=SHADOW_TREE_RADIUS);
  const shifted=selectShadowTrees(trees,100,0,39,3);
  assert.deepEqual(shifted,[trees.get(105),trees.get(106),trees.get(104)]);
});

function fixture(){
  class Color {
    constructor(hex=0){
      this.r=((hex>>16)&255)/255;this.g=((hex>>8)&255)/255;this.b=(hex&255)/255;
    }
    copy(other){Object.assign(this,{r:other.r,g:other.g,b:other.b});return this;}
    clone(){return new Color().copy(this);}
    lerp(other,t){this.r+=(other.r-this.r)*t;this.g+=(other.g-this.g)*t;this.b+=(other.b-this.b)*t;return this;}
  }
  class Vector3 {
    constructor(x=0,y=0,z=0){this.set(x,y,z);}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
    copy(v){return this.set(v.x,v.y,v.z);}
    addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this;}
    normalize(){const n=Math.hypot(this.x,this.y,this.z);this.x/=n;this.y/=n;this.z/=n;return this;}
  }
  class Layers {
    constructor(){this.mask=1;}
    set(n){this.mask=1<<n;}
    enable(n){this.mask|=1<<n;}
    test(other){return (this.mask & other.mask)!==0;}
  }
  class DirectionalLight {
    constructor(color=new Color(0xffe4a6),intensity=2.3){
      this.color=color.clone();this.intensity=intensity;
      this.position=new Vector3();this.layers=new Layers();this.castShadow=false;
      this.target={position:new Vector3(),updateMatrixWorld(){}};
      this.shadow={mapSize:{set(x,y){this.x=x;this.y=y;}},
        camera:{layers:new Layers(),updateProjectionMatrix(){}},map:null,
        dispose(){this.disposed=true;}};
    }
    updateMatrixWorld(){}
  }
  class Group {constructor(){this.children=[];this.layers=new Layers();this.visible=true;}}
  class Geometry{constructor(){this.disposed=false;}dispose(){this.disposed=true;}}
  class Material{constructor(options){this.options=options;this.disposed=false;Object.assign(this,options);}dispose(){this.disposed=true;}}
  class ShaderMaterial extends Material{}
  class Mesh{
    constructor(geometry,material){
      this.geometry=geometry;this.material=material;this.position=new Vector3();
      this.scale={setScalar(n){this.value=n;}};
      this.children=[];this.castShadow=false;this.visible=true;
    }
  }
  const scene={
    background:new Color(0xa4c8be),children:[],
    add(...objects){this.children.push(...objects);},
    remove(...objects){this.children=this.children.filter(c=>!objects.includes(c));},
  };
  const camera={position:new Vector3(2,3,4),layers:new Layers(),far:280};
  camera.layers.enable(1);camera.layers.enable(3);
  const sun=new DirectionalLight();
  const hemisphere={layers:new Layers(),intensity:2.1};
  const renders=[];
  const renderer={shadowMap:{render(lights,shadowScene,viewCamera){
    renders.push({light:lights[0],count:shadowScene.children.length,mask:viewCamera.layers.mask});
    lights[0].shadow.needsUpdate=false;
  }}};
  const ground={receiveShadow:false};
  const settings={quality:'balanced',shadowDistance:60,shadowRefreshSeconds:1,
    characterShadowsEnabled:true,characterShadowDistance:30,shadowContrast:70};
  const trees=new Map();
  for(let i=0;i<65;i++)trees.set(i,{position:{x:i*.75,z:0},
    children:Array.from({length:5},()=>({castShadow:false}))});
  const THREE={Color,Vector3,SphereGeometry:Geometry,MeshBasicMaterial:Material,
    ShaderMaterial,Mesh,Group,DirectionalLight,BackSide:1,PCFSoftShadowMap:2};
  const characters=[{layers:new Layers(),castShadow:true},{layers:new Layers(),castShadow:true}];
  characters[0].layers.set(1);characters[1].layers.set(3);
  const atmosphere=createAtmosphere({THREE,renderer,scene,camera,sun,hemisphere,ground,settings,trees,
    getCharacterShadowCasters:()=>characters,
    getPointShadowCasters:light=>light.userData?.shadowRole==='static'
      ?[...characters,characters[0]]
      :light.userData?.shadowFrozen?[]:[characters[0]]});
  return {scene,renderer,renders,ground,sun,hemisphere,trees,settings,atmosphere,camera};
}

test('atmosphere rescales camera-centered sky and celestial bodies when preset changes far plane',()=>{
 const f=fixture();
 for(const far of [280,230,180,320]){
  f.camera.far=far;
  f.atmosphere.tick(far,0,0);
  const sky=skyGeometryDistances(far);
  assert.ok(Math.abs(f.atmosphere.dome.scale.value-sky.domeRadius/235)<1e-9);
  assert.ok(Math.abs(f.atmosphere.sunBody.scale.value-sky.sunRadius)<1e-9);
  assert.ok(Math.abs(f.atmosphere.moonBody.scale.value-sky.moonRadius)<1e-9);
  assert.ok(Math.abs(Math.hypot(
    f.atmosphere.sunBody.position.x-f.camera.position.x,
    f.atmosphere.sunBody.position.y-f.camera.position.y,
    f.atmosphere.sunBody.position.z-f.camera.position.z,
  )-sky.bodyDistance)<1e-9);
 }
});

test('point-light shadow renders a bounded local caster scene and restores camera layers',()=>{
  const f=fixture();
  const point={isPointLight:true,shadow:{autoUpdate:false,needsUpdate:true}};
  const before=f.camera.layers.mask;
  f.renderer.shadowMap.render([point],f.scene,f.camera);
  assert.equal(f.renders.length,1);
  assert.equal(f.renders[0].light,point);
  assert.equal(f.renders[0].count,1,'only the nearby caster is rendered for the cube map');
  assert.equal(f.renders[0].mask,1|(1<<1)|(1<<3)|(1<<4));
  assert.equal(f.camera.layers.mask,before);
  f.renderer.shadowMap.render([point],f.scene,f.camera);
  assert.equal(f.renders.length,1,'cached point-shadow map does not redraw when unchanged');
});

test('zero refresh interval updates forest shadows every rendered frame',()=>{
  const f=fixture();
  f.settings.shadowRefreshSeconds=0;
  f.atmosphere.tick(0,0,0);
  assert.equal(f.sun.shadow.needsUpdate,true);
  f.renderer.shadowMap.render([f.sun],f.scene,f.camera);
  assert.equal(f.renders.filter(r=>r.light===f.sun).length,1);
  f.atmosphere.tick(1000/60,0,0);
  assert.equal(f.sun.shadow.needsUpdate,true,'sun shadow must update on second frame');
  f.renderer.shadowMap.render([f.sun],f.scene,f.camera);
  assert.equal(f.renders.filter(r=>r.light===f.sun).length,2);
  f.settings.shadowRefreshSeconds=.5;
  f.atmosphere.tick(1000/60*2,0,0);
  f.renderer.shadowMap.render([f.sun],f.scene,f.camera);
  assert.equal(f.renders.filter(r=>r.light===f.sun).length,3,
    'switching to a timed interval immediately refreshes the map');
  f.atmosphere.tick(1000/60*3,0,0);
  assert.equal(f.sun.shadow.needsUpdate,false,
    'timed mode must not update the forest shadow map every frame');
  f.atmosphere.dispose();
});

test('new crafted structures enter cached forest shadows on invalidation',()=>{
  const f=fixture();
  f.atmosphere.tick(0,0,0);
  f.renderer.shadowMap.render([f.sun],f.scene,f.camera);
  f.sun.shadow.needsUpdate=false;
  f.atmosphere.invalidateStaticShadows();
  f.atmosphere.tick(20,0,0);
  assert.equal(f.sun.shadow.needsUpdate,true,
    'structures update the sun map immediately, not after the timed refresh');
});

test('two CSM maps each contain trees and moving characters, with no third light',()=>{
 const f=fixture();
 const near=f.atmosphere.nearSun;
 assert.equal([f.sun,...f.scene.children].filter(obj=>obj instanceof f.sun.constructor).length,2);
 f.atmosphere.tick(0,0,0);
 assert.equal(f.sun.shadow.mapSize.x,1024);
 assert.equal(near.shadow.mapSize.x,2048);
 assert.equal(f.sun.intensity,2.3,'far sunlight uses full intensity');
 assert.equal(near.intensity,2.3,'near sunlight is gated, not half-brightness');
 f.renderer.shadowMap.render([f.sun,near],f.scene,f.camera);
 assert.equal(f.renders.length,2);
 for(const render of f.renders){
  assert.equal(render.mask,1|(1<<1)|(1<<3)|(1<<4));
  assert.ok(render.count>=3,'trees and two characters share each cascade map');
 }
 const far=f.renders[0],close=f.renders[1];
 assert.ok(far.count>=3&&close.count>=3,'both near and far include combined casters');
 assert.equal(f.camera.layers.mask,1|(1<<1)|(1<<3));
 f.atmosphere.tick(100,0,0);
 assert.equal(f.sun.shadow.needsUpdate,false);
 assert.equal(near.shadow.needsUpdate,true,'near map repaints each frame');
 f.renderer.shadowMap.render([near],f.scene,f.camera);
 f.atmosphere.tick(220,0,0);
 assert.equal(near.shadow.needsUpdate,true,'near map updates on the next render');
 assert.equal(f.sun.shadow.needsUpdate,false,'far map remains cached');
 f.renderer.shadowMap.render([near],f.scene,f.camera);
 assert.equal(f.renders.at(-1).count>=3,true,'players remain in near map on refresh');
 f.settings.characterShadowsEnabled=false;
 f.atmosphere.tick(1000,0,0);
 f.renderer.shadowMap.render([f.sun,near],f.scene,f.camera);
 assert.ok(f.renders.at(-1).count<close.count,'character toggle removes casters, not a separate map');
 f.atmosphere.dispose();
 assert.equal(f.scene.children.includes(near),false,'near cascade disposed');
 assert.equal(f.hemisphere.intensity,2.1);
});

test('far cascade does not disable nearer tree shadows when its budget changes',()=>{
 const f=fixture();
 f.settings.shadowDistance=150;
 f.settings.sunNearShadowDistance=25;
 f.atmosphere.tick(0,0,0);
 assert.equal(f.trees.get(0).children.every(m=>m.castShadow),true,
  'near-only tree is still allowed to cast shadows');
 f.atmosphere.tick(250,0,0);
 assert.equal(f.trees.get(0).children.every(m=>m.castShadow),true);
 f.settings.shadowDistance=300;
 f.atmosphere.tick(300,0,0);
 assert.equal(f.trees.get(0).children.every(m=>m.castShadow),true,
  'changing far range never changes near tree caster flags');
 f.atmosphere.dispose();
 assert.ok([...f.trees.values()].every(tree=>tree.children.every(m=>!m.castShadow)));
});

test('deep-night sky zenith and horizon match black fog, daytime stays blue',()=>{
 const f=fixture();
 const sky=f.atmosphere.dome.material.uniforms;
 const day={...sky.zenith.value};
 f.atmosphere.setPhase(.5);
 const expected={r:0,g:0,b:0};
 for(const channel of ['r','g','b'])assert.ok(Math.abs(sky.zenith.value[channel]-expected[channel])<1e-12);
 assert.deepEqual({r:sky.zenith.value.r,g:sky.zenith.value.g,b:sky.zenith.value.b},
  {r:0,g:0,b:0},'full-night zenith is black: no visible gradient band');
 // In the real game day-cycle applies the identical black scene.background.
 // The dome shader reads it as horizon and renders a uniform black sky.
 sky.horizon.value.copy({r:0,g:0,b:0});
 assert.deepEqual({r:sky.horizon.value.r,g:sky.horizon.value.g,b:sky.horizon.value.b},
  {r:0,g:0,b:0});
 f.atmosphere.setPhase(0);
 assert.deepEqual({r:sky.zenith.value.r,g:sky.zenith.value.g,b:sky.zenith.value.b},day);
});


test('point light uses one common cubemap and retains cached last frame',()=>{
 const f=fixture();
 const point={isPointLight:true,userData:{shadowFrozen:false},
  shadow:{autoUpdate:true,needsUpdate:true}};
 f.renderer.shadowMap.render([point],f.scene,f.camera);
 assert.equal(f.renders[0].count,1);
 point.userData.shadowFrozen=true;
 point.shadow.autoUpdate=false;
 point.shadow.needsUpdate=false;
 f.renderer.shadowMap.render([point],f.scene,f.camera);
 assert.equal(f.renders.length,1,'cached map is reused, no split-mode redraw');
 point.shadow.needsUpdate=true;
 f.renderer.shadowMap.render([point],f.scene,f.camera);
 assert.equal(f.renders[1].count,0,'cold invalidated cache excludes moving actors');
});

test('sun CSM uses live near map, independently cached far map and separate resolutions',()=>{
 const f=fixture();
 const near=f.atmosphere.nearSun;
 f.settings.shadowDistance=80;
 f.settings.shadowMapSize=1024;
 f.settings.sunNearShadowDistance=30;
 f.settings.sunNearShadowMapSize=2048;
 f.settings.shadowRefreshSeconds=1;
 f.atmosphere.tick(0,0,0);
 assert.equal(f.sun.shadow.mapSize.x,1024,'far map keeps lower resolution');
 assert.equal(near.shadow.mapSize.x,2048,'near map is 2K by default');
 assert.equal(f.atmosphere.nearSun.shadow.mapSize.x,2048);
 assert.equal(f.sun.shadow.camera.left,-92,'far map spans a broad area');
 assert.equal(near.shadow.camera.left,-50,'near coverage includes fade and caster overlap');
 assert.equal(f.sun.castShadow,true);
 assert.equal(near.castShadow,true);
 f.renderer.shadowMap.render([f.sun,near],f.scene,f.camera);
 assert.equal(f.renders.length,2,'near and far maps are rendered separately');
 const [farRender,nearRender]=f.renders;
 assert.equal(farRender.light,f.sun);
 assert.equal(nearRender.light,near);
 assert.ok(farRender.count>=3&&nearRender.count>=3,'both maps include their combined casters');
 f.atmosphere.tick(100,0,0);
 assert.equal(f.sun.shadow.needsUpdate,false,'far map remains cached at 100ms');
 assert.equal(near.shadow.needsUpdate,true,'near map refreshes on every rendered frame');
 f.renderer.shadowMap.render([near],f.scene,f.camera);
 assert.equal(near.shadow.needsUpdate,false,'renderer consumes the frame update');
 f.atmosphere.tick(210,0,0);
 assert.equal(f.sun.shadow.needsUpdate,false,'far map remains cached at 210ms');
 assert.equal(near.shadow.needsUpdate,true,'near map immediately requests another frame');
 f.renderer.shadowMap.render([near],f.scene,f.camera);
 f.settings.sunNearShadowMapSize=4096;
 f.atmosphere.tick(230,0,0);
 assert.equal(near.shadow.mapSize.x,4096,'4K near option is applied without restarting');
 assert.equal(f.sun.shadow.mapSize.x,1024,'far resolution remains independent');
});

test('moving shadow cameras are texel snapped and retain independent static ranges',()=>{
 const f=fixture();
 const near=f.atmosphere.nearSun;
 f.settings.shadowDistance=60;
 f.settings.shadowMapSize=1024;
 f.settings.sunNearShadowDistance=25;
 f.settings.sunNearShadowMapSize=2048;
 f.settings.shadowRefreshSeconds=0;
 f.atmosphere.tick(0,15.11,25.11);
 const initial={x:near.target.position.x,z:near.target.position.z};
 const firstFar={x:f.sun.target.position.x,z:f.sun.target.position.z};
 f.atmosphere.tick(100,15.110001,25.110001);
 assert.ok(Math.hypot(near.target.position.x-initial.x,near.target.position.z-initial.z)<.001,
  'near texel projection is stable during sub-pixel motion');
 assert.ok(Math.hypot(f.sun.target.position.x-firstFar.x,f.sun.target.position.z-firstFar.z)<.001);
 assert.equal(near.shadow.camera.left,-45);
 assert.equal(f.sun.shadow.camera.left,-72);
 f.atmosphere.tick(200,40,45);
 assert.ok(Math.hypot(near.target.position.x-initial.x,near.target.position.z-initial.z)>5,
  'both maps follow the moving player after a meaningful displacement');
});

test('sunlight cascades preserve combined intensity across day and night',()=>{
 const f=fixture(),near=f.atmosphere.nearSun;
 f.atmosphere.tick(0,0,0);
 assert.equal(f.sun.intensity,2.3);
 assert.equal(near.intensity,2.3,'blend is in the shader, no 0.5 intensity multipliers');
 f.atmosphere.setPhase(.5);
 f.atmosphere.tick(100,0,0);
 assert.equal(f.sun.shadow.intensity,0);
 assert.equal(near.shadow.intensity,0);
 f.atmosphere.setPhase(0);
 f.atmosphere.setSunIntensity(4);
 f.atmosphere.tick(200,0,0);
 assert.equal(f.sun.intensity,4);
 assert.equal(near.intensity,4);
 assert.equal(f.sun.shadow.intensity,1);
 assert.equal(near.shadow.intensity,1);
});


test('10m crisp/10m blend/60m far with 12m overlap spans both shadow maps',()=>{
 const f=fixture();
 Object.assign(f.settings,{
  shadowDistance:60,sunNearShadowDistance:10,
  sunCascadeBlendDistance:10,sunCascadeCasterOverlap:12,
  sunNearShadowSoftness:1,sunFarShadowSoftness:3,
 });
 f.atmosphere.tick(0,0,0);
 const near=f.atmosphere.nearSun;
 assert.equal(near.shadow.camera.left,-33);
 assert.equal(near.shadow.camera.right,33);
 assert.equal(f.sun.shadow.camera.left,-72);
 assert.equal(near.shadow.radius,1);
 assert.equal(f.sun.shadow.radius,3);
 f.renderer.shadowMap.render([f.sun,near],f.scene,f.camera);
 const far=f.renders[0],close=f.renders[1];
 assert.ok(far.count>2,'far map contains shadow casters even inside 10m');
 assert.ok(close.count>2,'near map receives overlapping caster geometry');
 const before=f.sun.shadow.needsUpdate;
 f.settings.sunCascadeCasterOverlap=20;
 f.atmosphere.tick(100,0,0);
 assert.equal(near.shadow.camera.left,-41,'overlap slider changes near shadow frustum');
 assert.equal(f.sun.shadow.needsUpdate,false,'unchanged far caster band keeps its cached map');
 assert.equal(before,false,'cached far map was previously rendered');
 f.settings.sunNearShadowSoftness=2.5;
 f.settings.sunFarShadowSoftness=1.5;
 f.atmosphere.tick(200,0,0);
 assert.equal(near.shadow.radius,2.5,'near softness changes live');
 assert.equal(f.sun.shadow.radius,1.5,'far softness changes live without cubemap rerender');
 f.settings.sunNearShadowSoftness=0;
 f.settings.sunFarShadowSoftness=0;
 f.atmosphere.tick(300,0,0);
 assert.equal(near.shadow.radius,0,'near sunlight hard shadow removes PCF offset');
 assert.equal(f.sun.shadow.radius,0,'far sunlight hard shadow removes PCF offset');

});
