import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyClassicGrassTwoSidedLighting,applyGrassFoliageEffects,makeGrassFoliageUniforms,
} from '../src/grass-palette.js';

function shaderWithProceduralNormals(){
  const shader={
    uniforms:{},
    vertexShader:'#include <common>\n#include <color_vertex>',
    fragmentShader:'#include <common>\n#include <normal_fragment_begin>\n#include <color_fragment>\n#include <lights_fragment_end>\n#include <opaque_fragment>',
  };
  const u=makeGrassFoliageUniforms();
  applyClassicGrassTwoSidedLighting(shader);
  applyGrassFoliageEffects(shader,u);
  return shader;
}

const norm=v=>{
  const length=Math.hypot(...v)||1;
  return v.map(c=>c/length);
};
const dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const distance=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));
function proceduralNormal(worldUp,viewNormal){
  const up=norm(worldUp),smooth=norm(viewNormal);
  const lateral=smooth.map((n,i)=>n-up[i]*dot(smooth,up));
  return norm(up.map((n,i)=>n*.94+lateral[i]*.55));
}

test('procedural grass normal keeps continuous lateral lighting at horizontal normals',()=>{
  const {fragmentShader}=shaderWithProceduralNormals();
  assert.match(fragmentShader,/fcLateral=fcSmooth-normal\*dot\(fcSmooth,normal\)/);
  assert.match(fragmentShader,/fcProceduralNormal=normalize\(normal\*\.94\+fcLateral\*\.55\)/);
  assert.doesNotMatch(fragmentShader,/if\(dot\(fcSmooth,normal\)<0\.0\)/,
    'a hard sign switch at dot=0 causes sudden flashes as the camera moves');

  // Vertical ribbon normals are practically perpendicular to world-up.
  // A tiny change in camera-space rounding must not change their shading.
  const up=[0,1,0];
  const plus=proceduralNormal(up,[1,1e-7,0]);
  const minus=proceduralNormal(up,[1,-1e-7,0]);
  assert.ok(distance(plus,minus)<1e-6,
    'opposite rounding errors give visually identical normals');

  // View-space camera rotation must preserve world lighting direction.
  for(const radians of [0,.2,.9,Math.PI,5.6]){
    const rotateY=v=>[
      v[0]*Math.cos(radians)-v[2]*Math.sin(radians),
      v[1],
      v[0]*Math.sin(radians)+v[2]*Math.cos(radians),
    ];
    const rotated=proceduralNormal(rotateY(up),rotateY([1,0,0]));
    assert.ok(distance(rotated,rotateY(proceduralNormal(up,[1,0,0])))<1e-12);
  }
});
