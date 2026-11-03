import test from 'node:test';
import assert from 'node:assert/strict';
import {
  celestialDirections,shadowMapSizeForQuality,skyGeometryDistances,selectShadowTrees,
  createAtmosphere,SHADOW_TREE_LIMIT,SHADOW_TREE_RADIUS,SHADOW_UPDATE_MS,
  CHARACTER_SHADOW_RADIUS,CHARACTER_SHADOW_MAP_SIZES,
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

test('trees and nearby skinned players use independent shadow maps',()=>{
  const f=fixture();
  assert.equal(f.renderer.shadowMap.enabled,true);
  assert.equal(f.renderer.shadowMap.autoUpdate,true);
  assert.equal(f.sun.castShadow,true);
  assert.equal(f.sun.shadow.autoUpdate,false);
  const charLight=f.atmosphere.characterLight;
  assert.equal(charLight.castShadow,true);
  assert.equal(charLight.shadow.camera.left,-CHARACTER_SHADOW_RADIUS);
  assert.equal(charLight.shadow.camera.right,CHARACTER_SHADOW_RADIUS);
  assert.equal(charLight.shadow.camera.top,30);
  assert.deepEqual(CHARACTER_SHADOW_MAP_SIZES,{low:512,balanced:1024,high:2048});
  assert.equal(f.atmosphere.sunIntensity,2.3);
  assert.equal(f.atmosphere.ambientIntensity,2.1,'raw ambient remains accessible for cycle restore');
  assert.equal(f.ground.receiveShadow,true);
  assert.equal(f.atmosphere.sunBody.visible,true);
  assert.equal(f.atmosphere.moonBody.visible,false);
  f.atmosphere.tick(0,0,0);
  assert.equal(charLight.shadow.camera.left,-54,'30m detail + 16m proxy + 8m margin');
  assert.ok(Math.abs(f.hemisphere.intensity-2.1*(1-.65*.7))<1e-9);
  assert.equal(f.sun.shadow.mapSize.x,1024);
  assert.equal(charLight.shadow.mapSize.x,1024);
  assert.ok(f.atmosphere.shadowCasters<=480);
  assert.ok(f.atmosphere.shadowCasters>0);
  assert.ok(f.atmosphere.lightDirection.y>0);
  const oldCasters=[...f.trees.values()].filter(t=>t.children[0].castShadow);
  assert.equal(oldCasters.length,f.atmosphere.shadowCasters);
  f.sun.shadow.needsUpdate=false;
  charLight.shadow.needsUpdate=false;
  f.atmosphere.tick(1000/144,0,0);
  assert.equal(f.sun.shadow.needsUpdate,false,'character updates do not refresh trees');
  assert.equal(charLight.shadow.needsUpdate,true);
  f.renderer.shadowMap.render([f.sun,charLight],f.scene,f.camera);
  assert.equal(f.renders.length,1,'only the due character map redraws');
  assert.equal(f.renders[0].light,charLight);
  assert.equal(f.renders[0].count,2,'only character meshes enter the fast pass');
  assert.equal(f.renders[0].mask,(1<<1)|(1<<3)|(1<<4));
  assert.equal(f.camera.layers.mask,(1)|(1<<1)|(1<<3),'view camera restored');
  f.atmosphere.tick(1000/144*2,0,0);
  assert.equal(charLight.shadow.needsUpdate,true,'character map redraws on every rendered frame');
  f.renderer.shadowMap.render([f.sun,charLight],f.scene,f.camera);
  const beforeTree=f.renders.length;
  f.atmosphere.tick(SHADOW_UPDATE_MS,70,0);
  assert.equal(f.sun.shadow.needsUpdate,true);
  assert.equal(charLight.shadow.needsUpdate,true);
  f.renderer.shadowMap.render([f.sun,charLight],f.scene,f.camera);
  assert.deepEqual(f.renders.slice(beforeTree).map(r=>r.light),[f.sun,charLight]);
  assert.ok(f.renders.at(-2).count>0,'only nearby tree groups enter the slow pass');
  assert.ok(f.trees.get(0).children.every(m=>!m.castShadow));
  f.settings.quality='high';
  f.atmosphere.tick(SHADOW_UPDATE_MS*2,70,0);
  assert.equal(f.sun.shadow.mapSize.x,2048);
  assert.equal(charLight.shadow.mapSize.x,2048);
  f.settings.quality='low';
  f.atmosphere.tick(SHADOW_UPDATE_MS*3,70,0);
  assert.equal(f.sun.shadow.mapSize.x,512);
  assert.equal(charLight.shadow.mapSize.x,512);
  // Radius changes resize and recenter the character-only shadow camera.
  f.settings.characterShadowDistance=100;
  f.atmosphere.tick(SHADOW_UPDATE_MS*3+.5,70,0);
  assert.equal(charLight.shadow.camera.left,-124);
  assert.equal(charLight.shadow.camera.right,124);
  assert.ok(charLight.shadow.camera.far>300);
  f.settings.shadowContrast=0;
  f.atmosphere.tick(SHADOW_UPDATE_MS*3+.6,70,0);
  assert.equal(f.hemisphere.intensity,2.1);
  f.settings.shadowContrast=100;
  f.atmosphere.tick(SHADOW_UPDATE_MS*3+.7,70,0);
  assert.ok(Math.abs(f.hemisphere.intensity-2.1*.35)<1e-9);
  f.settings.characterShadowsEnabled=false;
  f.atmosphere.tick(SHADOW_UPDATE_MS*3+1,70,0);
  assert.equal(charLight.castShadow,false);
  assert.equal(f.sun.intensity,2.3);
  f.settings.characterShadowsEnabled=true;
  f.atmosphere.tick(SHADOW_UPDATE_MS*3+2,70,0);
  assert.equal(charLight.castShadow,true);
  f.atmosphere.setSunIntensity(.9);
  assert.equal(f.atmosphere.sunIntensity,.9);
  f.atmosphere.setPhase(.5);
  f.atmosphere.tick(SHADOW_UPDATE_MS*4,70,0);
  assert.equal(f.atmosphere.sunBody.visible,false);
  assert.equal(f.atmosphere.moonBody.visible,true);
  assert.ok(f.sun.position.y>0);
  f.atmosphere.restore();
  f.atmosphere.tick(SHADOW_UPDATE_MS*5,70,0);
  assert.equal(f.atmosphere.sunBody.visible,true);
  assert.equal(f.atmosphere.moonBody.visible,false);
  f.atmosphere.dispose();
  assert.equal(f.hemisphere.intensity,2.1,'disposal restores original ambient light');
  assert.equal(f.atmosphere.shadowCasters,0);
  assert.equal(f.ground.receiveShadow,false);
  assert.ok(f.trees.values().every(t=>t.children.every(c=>!c.castShadow)));
  assert.equal(f.atmosphere.dome.material.disposed,true);
});

test('night sky zenith uses darker palette while daytime keeps its usual blue',()=>{
 const f=fixture();
 const sky=f.atmosphere.dome.material.uniforms;
 const day={...sky.zenith.value};
 f.atmosphere.setPhase(.5);
 const expected={r:0,g:1/255,b:1/255};
 for(const channel of ['r','g','b'])assert.ok(Math.abs(sky.zenith.value[channel]-expected[channel])<1e-12);
 f.atmosphere.setPhase(0);
 assert.deepEqual({r:sky.zenith.value.r,g:sky.zenith.value.g,b:sky.zenith.value.b},day);
});


test('one-sun mode renders static trees and skinned characters together every frame',()=>{
 const f=fixture();
 const character=f.atmosphere.characterLight;
 f.settings.splitShadowMaps=false;
 f.atmosphere.tick(0,0,0);
 assert.equal(f.sun.castShadow,true);
 assert.equal(character.castShadow,false);
 assert.equal(character.visible,false);
 assert.equal(f.sun.intensity,2.3);
 assert.equal(character.intensity,0);
 f.renderer.shadowMap.render([f.sun],f.scene,f.camera);
 assert.equal(f.renders.length,1);
 assert.ok(f.renders[0].count>f.atmosphere.shadowCasters,
   'single map includes both the forest batch and character meshes');
 assert.equal(f.renders[0].mask,1|(1<<1)|(1<<3)|(1<<4));
 f.atmosphere.tick(16,0,0);
 assert.equal(f.sun.shadow.needsUpdate,true,'unified map refreshes every rendered frame');
 f.renderer.shadowMap.render([f.sun],f.scene,f.camera);
 assert.equal(f.renders.length,2);
 f.settings.splitShadowMaps=true;
 f.atmosphere.tick(32,0,0);
 assert.equal(character.castShadow,true);
 assert.equal(character.visible,true);
 assert.equal(f.sun.intensity,2.3*.5);
 assert.equal(character.intensity,2.3*.5);
 assert.equal(character.shadow.needsUpdate,true);
 f.renderer.shadowMap.render([f.sun,character],f.scene,f.camera);
 assert.equal(f.renders.at(-1).light,character);
 f.atmosphere.tick(48,0,0);
 assert.equal(f.sun.shadow.needsUpdate,false,'split static shadow map is throttled');
 assert.equal(character.shadow.needsUpdate,true,'split character shadows redraw every rendered frame');
});

test('point-light caster roles are routed to separate static/dynamic cubemap scenes',()=>{
 const f=fixture();
 const point={isPointLight:true,userData:{shadowRole:'static'},
   shadow:{autoUpdate:false,needsUpdate:true}};
 f.renderer.shadowMap.render([point],f.scene,f.camera);
 assert.equal(f.renders.at(-1).count,3);
 assert.equal(f.renders.at(-1).mask,1|(1<<1)|(1<<3)|(1<<4));
 point.userData.shadowRole='dynamic';
 point.shadow.needsUpdate=true;
 f.renderer.shadowMap.render([point],f.scene,f.camera);
 assert.equal(f.renders.at(-1).count,1);
 assert.equal(f.renders.length,2);
});


test('cached dynamic point-shadow cubemap clears casters once and then skips depth passes',()=>{
 const f=fixture();
 const point={isPointLight:true,userData:{shadowRole:'dynamic',shadowFrozen:false},
   shadow:{autoUpdate:true,needsUpdate:true}};
 f.renderer.shadowMap.render([point],f.scene,f.camera);
 assert.equal(f.renders.length,1);
 assert.equal(f.renders[0].count,1);
 point.userData.shadowFrozen=true;
 point.shadow.autoUpdate=false;
 point.shadow.needsUpdate=true;
 f.renderer.shadowMap.render([point],f.scene,f.camera);
 assert.equal(f.renders.length,2,'last render clears the old moving silhouette');
 assert.equal(f.renders[1].count,0,'no moving character remains in the frozen map');
 f.renderer.shadowMap.render([point],f.scene,f.camera);
 assert.equal(f.renders.length,2,'cached map is reused without further redraws');
 point.userData.shadowFrozen=false;
 point.shadow.autoUpdate=true;
 f.renderer.shadowMap.render([point],f.scene,f.camera);
 assert.equal(f.renders.length,3,'return to near region resumes GPU updates');
 assert.equal(f.renders[2].count,1);
});
