import {flatTerrain} from './helpers/flat-terrain.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysics} from '../src/physics.js';
import {
  rockFootprint,nearbyRocks,rockBlocksPlayer,highestRockSupport,standingOnRock,
} from '../src/rock-collisions.js';

function fixture(){
  const ctx={terrain:flatTerrain(),chunkSize:24,rockColliders:new Map(),
    logLength:3,logRadius:.29,PLAYER_RADIUS:.31,PLAYER_HEIGHT:1.7,
    GRAVITY:19,JUMP_SPEED:7.5,trees:new Map(),placed:[],
    px:0,pz:0,feetY:0,verticalSpeed:0,onGround:true,jumpRequested:false};
  ctx.rockColliders.set('0,0',[{x:1,z:0,radius:.65,top:.82,bottom:0}]);
  return {ctx,physics:createPhysics(ctx)};
}

test('rocks block horizontal walking, including sliding and crossing chunk edges',()=>{
  const {ctx,physics}=fixture();
  assert.equal(rockFootprint(ctx.rockColliders.get('0,0')[0],.5,0,.31),true);
  physics.moveHorizontal(.5,.35);
  assert.equal(ctx.px,0,'stone blocks horizontal penetration');
  assert.equal(ctx.pz,.35,'blocked X axis still allows sliding along Z');
  assert.equal(rockBlocksPlayer(ctx.rockColliders,24,1,0,1.1,.31,1.7),false,
    'standing above the boulder does not block movement');
  ctx.rockColliders.set('-1,-1',[{x:-.3,z:-.2,radius:.3,top:.65,bottom:0}]);
  let visited=0;
  nearbyRocks(ctx.rockColliders,ctx.chunkSize,-.15,-.15,()=>{visited++});
  assert.ok(visited>=1,'rock lookup handles negative coordinates and chunk boundaries');
  assert.equal(rockBlocksPlayer(ctx.rockColliders,24,-.2,-.2,0,.31,1.7),true);
});

test('player can jump onto the faceted rock, land, jump again and walk off',()=>{
  const {ctx,physics}=fixture();
  physics.requestJump();
  for(let i=0;i<7;i++)physics.simulateVertical(.04);
  assert.ok(ctx.feetY>1.1,'jump reaches above a small boulder');
  physics.moveHorizontal(1,0);
  assert.equal(ctx.px,1,'avatar can move over the rock once feet clear its top');
  for(let i=0;i<28;i++)physics.simulateVertical(.04);
  assert.ok(Math.abs(ctx.feetY-.82)<.001,'falling player lands on the stone');
  assert.equal(ctx.onGround,true);
  assert.equal(standingOnRock(ctx.rockColliders,24,1,0,ctx.feetY,.31),true);
  physics.requestJump();
  physics.simulateVertical(.04);
  assert.ok(ctx.feetY>.82,'jumping again from the rock works');
  for(let i=0;i<36;i++)physics.simulateVertical(.04);
  assert.ok(Math.abs(ctx.feetY-.82)<.001);
  physics.moveHorizontal(1.7,0);
  physics.simulateVertical(.04);
  assert.equal(ctx.onGround,false,'leaving the rock drops the player');
  for(let i=0;i<25;i++)physics.simulateVertical(.04);
  assert.equal(ctx.feetY,0);
  assert.equal(ctx.onGround,true);
});

test('a rock never catches the player if feet were already below its top',()=>{
  const {ctx}=fixture();
  assert.equal(highestRockSupport(ctx.rockColliders,24,1,0,.1,0,.31),0);
  assert.equal(highestRockSupport(ctx.rockColliders,24,1,0,1,.8,.31),.82);
});
