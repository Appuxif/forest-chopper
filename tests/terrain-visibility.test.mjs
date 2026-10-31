import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainSystem} from '../src/terrain.js';
import {lakeAt} from '../src/lakes.js';

test('lake panorama smoothly widens view and restores forest fog without altering shadow settings',()=>{
  class Group{constructor(){this.material=null;} }
  class Material{dispose(){}}
  const scene={fog:{density:.012},add(){}};
  let projectionUpdates=0;
  const camera={far:280,updateProjectionMatrix(){projectionUpdates++;}};
  const terrain=new TerrainSystem({Group,MeshPhongMaterial:Material},
    {scene,camera,material:{}});
  terrain.setSeed(123456);
  const lake=lakeAt(123456,0,-1);
  terrain.updateVisibilityTarget(lake.x,lake.z);
  assert.equal(terrain.radius,4);
  terrain.tick(1000);
  for(let now=1020;now<=4000;now+=20)terrain.tick(now);
  assert.ok(scene.fog.density<.004,'fog clears on the water');
  assert.ok(camera.far>370,'the opposite shore is inside the far plane');
  terrain.updateVisibilityTarget(0,0);
  assert.equal(terrain.radius,4,'keep terrain loaded until the fog returns');
  for(let now=4020;now<=8500;now+=20){
    terrain.tick(now);
    terrain.updateVisibilityTarget(0,0);
  }
  assert.equal(terrain.radius,3);
  assert.ok(Math.abs(scene.fog.density-.012)<.0001);
  assert.ok(Math.abs(camera.far-280)<2);
  assert.ok(projectionUpdates>0);
  terrain.dispose();
  assert.equal(scene.fog.density,.012);
  assert.equal(camera.far,280);
});
