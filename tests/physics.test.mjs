import {flatTerrain} from './helpers/flat-terrain.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysics} from '../src/physics.js';

const fixture = () => {
  const ctx = {terrain:flatTerrain(),
    logLength: 3.6, logRadius: .29, PLAYER_RADIUS: .31, PLAYER_HEIGHT: 1.7,
    GRAVITY: 19, JUMP_SPEED: 7.5, trees: new Map(), placed: [],
    px: 0, pz: 0, feetY: 0, verticalSpeed: 0,
    onGround: true, jumpRequested: false,
  };
  return {ctx, physics: createPhysics(ctx)};
};

test('oriented log footprints and collision', () => {
  const {ctx, physics} = fixture();
  const p = {x: 0, z: 0, y: .29, orientation: 0};
  ctx.placed.push(p);
  assert.equal(physics.logFootprint(p, 1.6, 0), true);
  assert.equal(physics.logFootprint(p, 0, 1), false);
  assert.equal(physics.blocksPlayerAt(0, 0, 0), true);
  assert.equal(physics.blocksPlayerAt(0, 0, 1.2), false);
  p.orientation = 1;
  assert.equal(physics.logFootprint(p, 1.6, 0), false);
  assert.equal(physics.logFootprint(p, 0, 1.6), true);
});

test('axis sliding blocks trunk on one axis without freezing other', () => {
  const {ctx, physics} = fixture();
  ctx.trees.set('tree', {position: {x: 1, z: 0}});
  physics.moveHorizontal(.6, .8);
  assert.equal(ctx.px, 0);
  assert.equal(ctx.pz, .8);
});

test('landing on log surface and head collision', () => {
  const {ctx, physics} = fixture();
  ctx.placed.push({x: 0, z: 0, orientation: 0, y: .29});
  ctx.feetY = .9; ctx.verticalSpeed = -5; ctx.onGround = false;
  physics.simulateVertical(.05);
  assert.equal(ctx.feetY, .9 - (5 + 19*.05)*.05);
  for (let i = 0; i < 30; i++) physics.simulateVertical(.05);
  assert.ok(Math.abs(ctx.feetY - .58) < .001);
  assert.equal(ctx.onGround, true);

  ctx.placed = [{x: 0, z: 0, orientation: 0, y: 2.3}];
  ctx.feetY = 0; ctx.onGround = true; ctx.verticalSpeed = 0;
  physics.requestJump();
  for (let i = 0; i < 8; i++) physics.simulateVertical(.05);
  assert.ok(ctx.feetY < .32, 'head is stopped at the underside of an overhead log');
});

test('jump charges stamina exactly once, only when grounded, and reports exhaustion',()=>{
 const {ctx,physics}=fixture();
 const sent=[],spent=[];
 let energy=2;
 ctx.isOnline=()=>true;
 ctx.sendNet=payload=>sent.push(payload);
 ctx.vitals={jump(){spent.push(1);if(energy<1)return false;energy--;return true;}};
 physics.requestJump();
 physics.requestJump();
 assert.equal(spent.length,1,'duplicate keyboard/pointer events must not charge twice');
 assert.equal(ctx.jumpRequested,true);
 assert.deepEqual(sent,[{type:'jump'}]);
 physics.simulateVertical(.016);
 assert.equal(ctx.onGround,false);
 physics.requestJump();
 assert.equal(spent.length,1,'cannot jump midair');
 ctx.feetY=0;ctx.verticalSpeed=0;ctx.onGround=true;
 physics.requestJump();
 assert.equal(spent.length,2);
 physics.simulateVertical(.016);
 ctx.feetY=0;ctx.verticalSpeed=0;ctx.onGround=true;
 physics.requestJump();
 assert.equal(spent.length,3,'insufficient energy is checked on grounded jump');
 assert.equal(ctx.jumpRequested,false);
 assert.equal(sent.length,2);
});
