import test from 'node:test';
import assert from 'node:assert/strict';
import {createTreeWindShader} from '../src/tree-wind-shader.js';

test('GPU shader uses identical height/phase math for trunk, branches and foliage',()=>{
  const controller=createTreeWindShader({motionQuery:{matches:false}});
  const materials=Array.from({length:3},()=>({userData:{}}));
  const shader=()=>({uniforms:{},vertexShader:'#include <common>\nvoid main() { #include <begin_vertex> }'});
  for(const material of materials){
    controller.decorate(material,6);
    const compiled=shader();
    material.onBeforeCompile(compiled);
    assert.match(compiled.vertexShader,/FC_WIND_HEIGHT 6\.00/);
    assert.match(compiled.vertexShader,/fcHeight \* fcHeight/);
    assert.match(compiled.vertexShader,/instanceMatrix\[3\]\.xz/);
    assert.match(compiled.vertexShader,/transformed\.x \+= fcOffset \* 0\.24/);
    assert.equal(compiled.uniforms.fcWindTime,controller.uniforms.fcWindTime);
    assert.equal(compiled.uniforms.fcWindCenter,controller.uniforms.fcWindCenter);
    assert.equal(material.customProgramCacheKey(),'fc-tree-wind-v1:6');
  }
  controller.decorate(materials[0],8);
  assert.equal(materials[0].customProgramCacheKey(),'fc-tree-wind-v1:8');
});
test('GPU wind responds to time, player distance, setting and reduced-motion',()=>{
  const reduced={matches:false};
  const shader=createTreeWindShader({motionQuery:reduced});
  shader.tick(1000,3,-4,true);
  assert.equal(shader.uniforms.fcWindTime.value,1);
  assert.deepEqual(shader.uniforms.fcWindCenter.value,{x:3,y:-4});
  assert.equal(shader.uniforms.fcWindStrength.value,1);
  shader.tick(1500,9,12,false);
  assert.equal(shader.uniforms.fcWindStrength.value,0);
  reduced.matches=true;
  shader.tick(2000,9,12,true);
  assert.equal(shader.uniforms.fcWindStrength.value,0);
  reduced.matches=false;
  shader.tick(2500,9,12,true);
  assert.equal(shader.uniforms.fcWindStrength.value,1);
});
