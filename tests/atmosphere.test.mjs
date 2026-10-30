import test from 'node:test';
import assert from 'node:assert/strict';
import {
  celestialDirections,shadowMapSizeForQuality,selectShadowTrees,
  createAtmosphere,SHADOW_TREE_LIMIT,SHADOW_TREE_RADIUS,SHADOW_UPDATE_MS,
} from '../src/atmosphere.js';

test('celestial positions follow the 8-minute cycle: sun by day, moon by night',()=>{
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
    lerp(other,t){this.r+=(other.r-this.r)*t;this.g+=(other.g-this.g)*t;this.b+=(other.b-this.b)*t;return this;}
  }
  class Vector3 {
    constructor(x=0,y=0,z=0){this.set(x,y,z);}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
    copy(v){return this.set(v.x,v.y,v.z);}
    addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this;}
    normalize(){const n=Math.hypot(this.x,this.y,this.z);this.x/=n;this.y/=n;this.z/=n;return this;}
  }
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
  const camera={position:new Vector3(2,3,4)};
  const sun={
    position:new Vector3(),target:{position:new Vector3(),updateMatrixWorld(){}},
    castShadow:false,updateMatrixWorld(){},
    shadow:{
      mapSize:{set(x,y){this.x=x;this.y=y;}},
      camera:{updateProjectionMatrix(){}},
      map:null,
    },
  };
  const renderer={shadowMap:{}};
  const ground={receiveShadow:false};
  const settings={quality:'balanced'};
  const trees=new Map();
  for(let i=0;i<65;i++)trees.set(i,{position:{x:i*.75,z:0},
    children:Array.from({length:5},()=>({castShadow:false}))});
  const THREE={Color,Vector3,SphereGeometry:Geometry,MeshBasicMaterial:Material,
    ShaderMaterial,Mesh,BackSide:1,PCFSoftShadowMap:2};
  const atmosphere=createAtmosphere({THREE,renderer,scene,camera,sun,ground,settings,trees});
  return {scene,renderer,ground,sun,trees,settings,atmosphere,camera};
}

test('atmosphere shares a single shadow map and refreshes only near moving trees',()=>{
  const f=fixture();
  assert.equal(f.renderer.shadowMap.autoUpdate,false);
  assert.equal(f.renderer.shadowMap.enabled,true);
  assert.equal(f.sun.castShadow,true);
  assert.equal(f.ground.receiveShadow,true);
  assert.equal(f.atmosphere.sunBody.visible,true);
  assert.equal(f.atmosphere.moonBody.visible,false);
  f.atmosphere.tick(0,0,0);
  assert.equal(f.sun.shadow.mapSize.x,1024);
  assert.equal(f.sun.shadow.mapSize.y,1024);
  assert.ok(f.atmosphere.shadowCasters<=SHADOW_TREE_LIMIT);
  assert.ok(f.atmosphere.shadowCasters>0);
  const oldCasters=[...f.trees.values()].filter(t=>t.children[0].castShadow);
  assert.equal(oldCasters.length,f.atmosphere.shadowCasters);
  f.renderer.shadowMap.needsUpdate=false;
  f.atmosphere.tick(SHADOW_UPDATE_MS-1,0,0);
  assert.equal(f.renderer.shadowMap.needsUpdate,false,'stationary time below throttle does not redraw');
  f.atmosphere.tick(SHADOW_UPDATE_MS,70,0);
  assert.equal(f.renderer.shadowMap.needsUpdate,true);
  assert.ok(f.trees.get(0).children.every(m=>!m.castShadow),'distant trees release their shadow slots');
  f.settings.quality='high';
  f.atmosphere.tick(SHADOW_UPDATE_MS*2,70,0);
  assert.equal(f.sun.shadow.mapSize.x,2048);
  f.settings.quality='low';
  f.atmosphere.tick(SHADOW_UPDATE_MS*3,70,0);
  assert.equal(f.sun.shadow.mapSize.x,512);

  f.atmosphere.setPhase(.5);
  f.atmosphere.tick(SHADOW_UPDATE_MS*4,70,0);
  assert.equal(f.atmosphere.sunBody.visible,false);
  assert.equal(f.atmosphere.moonBody.visible,true);
  assert.ok(f.sun.position.y>0,'moonlight uses visible sky direction');
  f.atmosphere.restore();
  f.atmosphere.tick(SHADOW_UPDATE_MS*5,70,0);
  assert.equal(f.atmosphere.sunBody.visible,true);
  assert.equal(f.atmosphere.moonBody.visible,false);

  f.atmosphere.dispose();
  assert.equal(f.atmosphere.shadowCasters,0);
  assert.equal(f.ground.receiveShadow,false);
  assert.ok(f.trees.values().every(t=>t.children.every(c=>!c.castShadow)));
  assert.equal(f.atmosphere.dome.material.disposed,true);
});
