import test from 'node:test';
import assert from 'node:assert/strict';
import {createWaterSplashes} from '../src/water-splashes.js';

function fixture(depth=.3){
  const members=new Set();
  class Geometry{rotateX(){return this;}dispose(){this.disposed=true;}}
  class Material{dispose(){this.disposed=true;}}
  class Object3D{
    constructor(){
      this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});}};
      this.rotation={set(){}};
      this.scale={x:1,setScalar(n){this.x=n;},
        set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    }
    updateMatrix(){this.matrix={position:{x:this.position.x,y:this.position.y,z:this.position.z},scale:{x:this.scale.x}};}
  }
  class InstancedMesh{
    constructor(geo,mat,capacity){
      this.geometry=geo;this.material=mat;this.capacity=capacity;
      this.instanceMatrix={needsUpdate:false};
      this.matrices=new Map();
    }
    setMatrixAt(i,m){this.matrices.set(i,structuredClone(m));}
    dispose(){this.disposed=true;}
  }
  const THREE={IcosahedronGeometry:Geometry,RingGeometry:Geometry,
    MeshBasicMaterial:Material,InstancedMesh,Object3D,DoubleSide:2};
  const ctx={THREE,scene:{add(...x){x.forEach(o=>members.add(o));},
    remove(...x){x.forEach(o=>members.delete(o));}},
    terrain:{heightAt(){return 0;},waterDepthAt(){return depth;}},
    px:0,pz:0,feetY:0,onGround:true,sprinting:false,
  };
  return {ctx,effect:createWaterSplashes(ctx),members};
}
function visible(mesh){
  return [...mesh.matrices.values()].filter(m=>m.scale.x>.001).length;
}

test('shallow-water movement emits bounded droplets without rings; clearing releases them',()=>{
  const {ctx,effect,members}=fixture();
  const [droplets]=[...members];
  assert.equal(members.size,1,'ripples should not be rendered');
  assert.equal(droplets.capacity,88);
  assert.equal(visible(droplets),0);
  for(let i=0;i<5;i++){ctx.px+=.2;effect.tick(.04);}
  effect.tick(.016);
  assert.ok(visible(droplets)>0,'footstep produces airborne water droplets');
  ctx.sprinting=true;
  for(let i=0;i<150;i++){ctx.px+=.1;effect.tick(.025);}
  assert.equal(droplets.matrices.size,88,'instanced droplet allocation remains capped');
  effect.clear();
  assert.equal(visible(droplets),0);
  effect.dispose();
  assert.equal(members.size,0);
  assert.equal(droplets.disposed,true);
});

test('dry ground, deep water, standing still and midair do not trigger splashes',()=>{
  for(const depth of [0,.02,1.4]){
    const {ctx,effect,members}=fixture(depth);
    for(let i=0;i<15;i++){ctx.px+=.12;effect.tick(.04);}
    assert.equal(visible([...members][0]),0);
    effect.dispose();
  }
  const {ctx,effect,members}=fixture(.4);
  ctx.onGround=false;
  for(let i=0;i<10;i++){ctx.px+=.1;ctx.feetY=.4;effect.tick(.05);}
  assert.equal(visible([...members][0]),0);
  ctx.feetY=0;ctx.onGround=true;
  for(let i=0;i<10;i++)effect.tick(.05);
  assert.equal(visible([...members][0]),0);
  effect.dispose();
});
