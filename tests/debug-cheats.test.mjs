import test from 'node:test';
import assert from 'node:assert/strict';
import {safeTeleportPoint} from '../src/debug-cheats.js';

test('safe debug teleport rejects lakes and solid trees and finds nearby ground',()=>{
 const ctx={
  terrain:{heightAt:()=>2,waterDepthAt:(x,z)=>x<1.5?2:0},
  blocksPlayerAt:(x,z)=>x>2&&x<4&&Math.abs(z)<1,
 };
 const p=safeTeleportPoint(ctx,0,0);
 assert.ok(p);
 assert.ok(p.x>=1.5);
 assert.ok(!ctx.blocksPlayerAt(p.x,p.z,p.y));
 assert.equal(p.y,2);
 assert.equal(safeTeleportPoint(ctx,NaN,1),null);
});
test('safe debug teleport never places player in water when all candidates are flooded',()=>{
 const ctx={terrain:{heightAt:()=>0,waterDepthAt:()=>4},blocksPlayerAt:()=>false};
 assert.equal(safeTeleportPoint(ctx,0,0,{maxRadius:4}),null);
});
