import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlantInteraction} from '../src/plant-interaction.js';

const plant=(type,x,z,yaw=0)=>({
  position:{x,y:0,z},
  rotation:{x:0,y:yaw,z:0},
  userData:{decorType:type},
});

test('flowers and grass bend away from the local avatar, recover smoothly and reset',()=>{
  const flower=plant('flower',.6,0),grass=plant('grass',0,.6);
  const chunks=new Map([['0,0',{userData:{reactivePlants:[flower,grass]}}]]);
  const ctx={px:0,pz:0,chunkSize:24,chunks,avatars:new Map()};
  const interaction=createPlantInteraction(ctx);
  for(let i=0;i<8;i++)interaction.tick(1/60);
  assert.ok(flower.rotation.z<-.05,'flower bends along +X away from player');
  assert.ok(grass.rotation.x>.03,'grass bends along +Z away from player');
  ctx.px=6;ctx.pz=6;
  for(let i=0;i<110;i++)interaction.tick(1/60);
  assert.equal(flower.rotation.z,0);
  assert.equal(grass.rotation.x,0);
  ctx.px=0;ctx.pz=0;
  interaction.tick(1/60);
  interaction.clear();
  assert.equal(flower.rotation.z,0);
});

test('nearby network avatar can bend a flower without affecting the shared geometry',()=>{
  const flower=plant('flower',9.3,9);
  const ctx={px:10,pz:10,chunkSize:24,
    chunks:new Map([['0,0',{userData:{reactivePlants:[flower]}}]]),
    avatars:new Map([['remote',{group:{position:{x:9,z:9}}}]])};
  createPlantInteraction(ctx).tick(.05);
  assert.ok(Math.abs(flower.rotation.z)>.001);
});
