import test from 'node:test';
import assert from 'node:assert/strict';
import {nightBlend,fireLighting,blendLighting} from '../src/lighting-profile.js';

test('exact deep night 6-10, dusk 4-6, dawn 10-12 with smooth endpoints',()=>{
 for(const [hour,value] of [[0,0],[4,0],[5,.5],[6,1],[8,1],[10,1],[11,.5],[12,0],[15,0]]){
  assert.ok(Math.abs(nightBlend(hour/16)-value)<1e-10, String(hour));
 }
 assert.equal(nightBlend(1+.5),1);
 assert.equal(nightBlend(-.5),1);
 assert.equal(blendLighting(2,10,.5),6);
});
test('campfire and torch independently use day, night and height settings',()=>{
 const settings={
  campfireDayIntensity:1.1,campfireNightIntensity:9,campfireDayRadius:1,campfireNightRadius:30,campfireLightHeight:2.6,
  torchDayIntensity:2,torchNightIntensity:8,torchDayRadius:3,torchNightRadius:18,torchLightHeight:3.2,
 };
 assert.deepEqual(fireLighting(settings,'campfire',0),{intensity:1.1,radius:1,height:2.6,visibilityDistance:100,activationDistance:100,shadowVisibilityDistance:30,decay:2});
 assert.deepEqual(fireLighting(settings,'campfire',1),{intensity:9,radius:30,height:2.6,visibilityDistance:100,activationDistance:100,shadowVisibilityDistance:30,decay:2});
 assert.deepEqual(fireLighting(settings,'torch',1),{intensity:8,radius:18,height:3.2,visibilityDistance:100,activationDistance:100,shadowVisibilityDistance:30,decay:2});
 assert.deepEqual(fireLighting(settings,'torch',.5),{intensity:5,radius:10.5,height:3.2,visibilityDistance:100,activationDistance:100,shadowVisibilityDistance:30,decay:2});
 assert.deepEqual(fireLighting({...settings,torchVisibilityDistance:175,torchDecay:.4},'torch',1),
   {intensity:8,radius:18,height:3.2,visibilityDistance:175,activationDistance:175,shadowVisibilityDistance:30,decay:.4});
 assert.deepEqual(fireLighting({...settings,torchVisibilityDistance:20,
  torchActivationDistance:200,torchDecay:.1},'torch',1),
  {intensity:8,radius:18,height:3.2,visibilityDistance:20,activationDistance:200,shadowVisibilityDistance:30,decay:.1});
 assert.deepEqual(fireLighting({...settings,campfireVisibilityDistance:180,
  campfireActivationDistance:35},'campfire',1),
  {intensity:9,radius:30,height:2.6,visibilityDistance:180,activationDistance:35,shadowVisibilityDistance:30,decay:2});
});
