import test from 'node:test';
import assert from 'node:assert/strict';
import {bakeGrassAO,grassAORootOffsets,createGrassBakedAOAtlas} from '../src/grass-baked-ao.js';
import {generateBladeRoots} from '../src/grass-clumps-core.mjs';
import {grassTileData} from '../src/world-stream-data.js';

test('AO roots match procedural clump geometry root placements',()=>{
  const config={grassClusterBlades:5,grassClusterSeed:7,
    grassClusterBladeGapMin:.01,grassClusterBladeGapMax:.12,
    grassClusterAngleSpread:300};
  const geometryRoots=generateBladeRoots({seed:7,bladesPerClump:5,
    bladeGapMin:.01,bladeGapMax:.12});
  assert.deepEqual(grassAORootOffsets(config),geometryRoots.map(r=>[r.x,r.z]));
  assert.deepEqual(grassAORootOffsets(null),[[0,0]]);
});

test('world worker produces nonempty AO alongside geometry, only for nearby grass',()=>{
  const args={seed:123,tx:1,tz:1,size:12,density:20,tier:'near',
    ao:{enabled:true,resolution:64,sampling:100,configKey:'test1'}};
  const result=grassTileData(args);
  assert.ok(result.samples instanceof Float32Array);
  assert.ok(result.samples.length>0);
  assert.ok(result.ao.ao instanceof Uint8Array);
  assert.equal(result.ao.resolution,64);
  assert.equal(result.ao.configKey,'test1');
  assert.ok(result.ao.ao.some(v=>v<128),'roots create darker distance pixels');
  const far=grassTileData({...args,tier:'far'});
  assert.ok(far instanceof Float32Array);
});

test('empty grass and zero sampling bake to fully unoccluded distance fields',()=>{
  const empty=bakeGrassAO({samples:new Float32Array(),tx:0,tz:0,resolution:64});
  assert.equal(empty.ao.length,empty.width*empty.width);
  assert.ok(empty.ao.every(v=>v===255));
  const none=bakeGrassAO({samples:new Float32Array([1,0,1,0,1,0,0,0,0]),
    tx:0,tz:0,resolution:64,sampling:0});
  assert.ok(none.ao.every(v=>v===255));
});

test('AO atlas retains baked cache across movement and reconfiguration, keeps sampling coordinates aligned',()=>{
  const patch={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});}};
  const u={
    fcGroundGrassShadowMap:{value:null},
    fcGroundGrassShadowPatch:{value:patch},
    fcGroundGrassShadowIntensity:{value:0},
    fcGroundGrassShadowRadius:{value:0},
    fcGroundGrassShadowSoftness:{value:0},
    fcGroundGrassShadowEdgeFade:{value:0},
  };
  class DataTexture {
    constructor(data,width,height){this.image={data,width,height};}
    dispose(){this.disposed=true;}
  }
  const atlas=createGrassBakedAOAtlas({DataTexture,RGBAFormat:1,
    UnsignedByteType:2,LinearFilter:3,ClampToEdgeWrapping:4},u);
  const sample=new Float32Array([6,0,6,0,1,0,0,0,0]);
  const baked=bakeGrassAO({samples:sample,tx:0,tz:0,resolution:128});
  assert.equal(atlas.ready(baked),true);
  atlas.tick(6,6,{resolution:128,windowTiles:5,enabled:true,
    radius:.5,intensity:.8,softness:50,tilesPerFrame:2,uploadsPerSecond:8});
  assert.equal(atlas.metrics.cached,1);
  assert.equal(atlas.metrics.uploads,1);
  assert.equal(u.fcGroundGrassShadowIntensity.value,.8);
  assert.equal(patch.z,60);
  assert.equal(atlas.has(0,0),true);
  const firstTexture=u.fcGroundGrassShadowMap.value;
  // Move to next tile before upload interval; shader must still use OLD texture origin.
  atlas.tick(18,6,{resolution:128,windowTiles:5,enabled:true,
    radius:.5,intensity:.8,uploadsPerSecond:1});
  assert.equal(atlas.metrics.uploads,1);
  assert.equal(patch.x,-24);
  atlas.tick(18,6,{resolution:128,windowTiles:3,enabled:true,
    radius:.5,intensity:.8,uploadsPerSecond:8});
  assert.equal(atlas.metrics.cached,1);
  assert.equal(patch.z,0,'reset until the new atlas is ready');
  assert.equal(firstTexture.disposed,true);
  atlas.dispose();
  assert.equal(u.fcGroundGrassShadowMap.value,null);
});
