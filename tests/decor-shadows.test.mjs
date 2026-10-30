import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDecorShadowCasters,DECOR_SHADOW_LIMIT}
  from '../src/decor-shadows.js';

test('flowers, mushrooms, rocks and bushes share a bounded nearest-first shadow budget',()=>{
  const chunks=new Map();
  const objects=[
    {position:{x:7,z:0},userData:{decorType:'flower'}},
    {position:{x:2,z:0},userData:{decorType:'mushroom'}},
    {position:{x:4,z:0},userData:{decorType:'grass'}},
    {position:{x:5,z:0},userData:{decorType:'rock'}},
    {position:{x:200,z:0},userData:{decorType:'rock'}},
  ];
  chunks.set('0,0',{userData:{shadowDecor:objects}});
  assert.deepEqual(selectDecorShadowCasters(chunks,0,0,30,10),
    [objects[1],objects[2],objects[3],objects[0]]);
  assert.deepEqual(selectDecorShadowCasters(chunks,0,0,30,2),
    [objects[1],objects[2]]);
  assert.ok(DECOR_SHADOW_LIMIT>0 && DECOR_SHADOW_LIMIT<1000);
});
