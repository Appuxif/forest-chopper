import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBlackSoilPixels, createBlackSoilGroundTextures,
} from '../src/black-soil-texture.js';
import {sanitizeSettings} from '../src/settings.js';
import {validateGrassConfig} from '../src/grass-clumps-core.mjs';

test('black soil pixels are deterministic, opaque, dark and visibly relief-shaped',()=>{
  const a=buildBlackSoilPixels(64);
  const b=buildBlackSoilPixels(64);
  assert.deepEqual(a,b);
  assert.equal(a.color.length,64*64*4);
  assert.equal(a.height.length,64*64*4);
  const tones=new Set(),elevations=new Set();
  for(let p=0;p<a.color.length;p+=4){
    assert.ok(a.color[p]>=8&&a.color[p]<=54);
    assert.ok(a.color[p+1]>=8&&a.color[p+1]<=54);
    assert.ok(a.color[p+2]>=8&&a.color[p+2]<=54);
    assert.equal(a.color[p+3],255);
    assert.equal(a.height[p+3],255);
    assert.equal(a.height[p],a.height[p+1]);
    assert.equal(a.height[p+1],a.height[p+2]);
    tones.add(a.color[p]);
    elevations.add(a.height[p]);
  }
  assert.ok(tones.size>15,tones.size);
  assert.ok(elevations.size>35,elevations.size);
});

test('periodic soil noise does not make a hard seam at tile edges',()=>{
  const {color,height}=buildBlackSoilPixels(256);
  let max=0;
  for(let y=0;y<256;y++){
    for(const pixels of [color,height]){
      const p=(y*256)*4,q=(y*256+255)*4;
      max=Math.max(max,Math.abs(pixels[p]-pixels[q]));
    }
  }
  for(let x=0;x<256;x++){
    for(const pixels of [color,height]){
      const p=x*4,q=(255*256+x)*4;
      max=Math.max(max,Math.abs(pixels[p]-pixels[q]));
    }
  }
  assert.ok(max<45,'no abrupt wrapped-edge jump: '+max);
});

test('black soil creates both seamless albedo and height maps for bump lighting',()=>{
  const created=[];
  const doc={createElement(tag){
    assert.equal(tag,'canvas');
    const canvas={width:0,height:0};
    canvas.getContext=()=>({
      createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},
      putImageData(d,x,y){assert.equal(x,0);assert.equal(y,0);canvas.data=d.data;},
    });
    created.push(canvas);
    return canvas;
  }};
  const THREE={
    RepeatWrapping:'repeat',SRGBColorSpace:'srgb',
    LinearMipmapLinearFilter:'mipmap',LinearFilter:'linear',
    CanvasTexture:class{constructor(canvas){this.image=canvas;this.repeat={
      x:1,y:1,set(x,y){this.x=x;this.y=y;},
    };}},
  };
  const result=createBlackSoilGroundTextures(
    THREE,{capabilities:{getMaxAnisotropy(){return 16;}}},doc);
  assert.equal(created.length,2);
  assert.equal(result.map.colorSpace,'srgb');
  assert.equal(result.bumpMap.colorSpace,undefined);
  assert.ok(result.bumpScale>0);
  for(const texture of [result.map,result.bumpMap]){
    assert.equal(texture.wrapS,'repeat');
    assert.equal(texture.wrapT,'repeat');
    assert.equal(texture.generateMipmaps,true);
    assert.equal(texture.anisotropy,8);
    assert.equal(texture.image.width,512);
    assert.equal(texture.image.data.length,512*512*4);
  }
});

test('third texture works in game settings and standalone editor',()=>{
  assert.equal(sanitizeSettings({grassClusterGroundType:'blacksoil'}).grassClusterGroundType,'blacksoil');
  assert.equal(validateGrassConfig({groundTextureType:'blacksoil'}).groundTextureType,'blacksoil');
  assert.equal(sanitizeSettings({}).grassClusterGroundType,'forest',
    'new third choice must not override the user default');
});
