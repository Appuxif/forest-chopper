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


test('deep night clamps lake panorama, increases black fog and lowers loaded radius',()=>{
 class Group{constructor(){this.material=null;}}
 class Material{dispose(){}}
 const scene={fog:{density:.012},add(){}};
 const camera={far:280,updateProjectionMatrix(){}};
 const terrain=new TerrainSystem({Group,MeshPhongMaterial:Material},
   {scene,camera,material:{}});
 terrain.setGraphics({viewDistance:280,lakeViewDistance:400});
 const lake=lakeAt(123456,0,-1);
 terrain.setSeed(123456);
 terrain.updateVisibilityTarget(lake.x,lake.z);
 terrain.tick(0);terrain.tick(1000);
 assert.ok(terrain.radius>=3);
 terrain.setNightBlend(1,100);
 terrain.updateVisibilityTarget(lake.x,lake.z);
 for(let t=1100;t<=3800;t+=100)terrain.tick(t);
 assert.equal(terrain.radius,2);
 assert.ok(camera.far<=101,'lake cannot reveal the far shore at night');
 assert.ok(scene.fog.density>.039,'deep night uses dense dark fog');
 terrain.setNightBlend(0,100);
 terrain.updateVisibilityTarget(lake.x,lake.z);
 for(let t=3900;t<=6700;t+=100)terrain.tick(t);
 assert.ok(camera.far>350,'lake panorama returns at day');
 terrain.dispose();
});


test('deep-night terrain view can be 30 metres without enlarging lake visibility',()=>{
 class Group{constructor(){this.material=null;}}
 class Material{dispose(){}}
 const scene={fog:{density:.012},add(){}};
 const camera={far:280,updateProjectionMatrix(){}};
 const terrain=new TerrainSystem({Group,MeshPhongMaterial:Material},
   {scene,camera,material:{}});
 terrain.setGraphics({viewDistance:280,lakeViewDistance:400});
 terrain.setSeed(123456);
 const lake=lakeAt(123456,0,-1);
 terrain.setNightBlend(1,30);
 terrain.updateVisibilityTarget(lake.x,lake.z);
 terrain.tick(0);terrain.tick(300);
 assert.equal(terrain.nightViewDistance,30);
 assert.equal(terrain.effectiveViewDistance,30);
 assert.equal(terrain.radius,2);
 assert.ok(camera.far<=30.1,'night frustum hides the opposite shore even near water');
 assert.ok(scene.fog.density>.03,'night retains dense fog');
 terrain.setNightBlend(0,30);
 terrain.updateVisibilityTarget(lake.x,lake.z);
 terrain.tick(600);
 assert.equal(terrain.effectiveViewDistance,280);
 terrain.dispose();
});
