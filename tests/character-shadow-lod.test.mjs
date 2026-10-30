import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectCharacterShadowCasters, snapCharacterShadowCenter,
  CHARACTER_SHADOW_NEAR, CHARACTER_SHADOW_FAR,CHARACTER_SHADOW_PROXY_EXTRA,
} from '../src/character-shadow-lod.js';

function remote(distance, id) {
  const detail={id:id+'-skinned'}, proxy={id:id+'-proxy'};
  return {
    group:{position:{x:distance,z:0}},
    actor:{shadowMeshes:[detail]},
    shadowProxy:proxy,shadowLod:'off',
    detail,proxy,
  };
}

test('local skinned shadow is always detailed; remote LOD uses true geometry, proxy, then none',()=>{
  const local={shadowMeshes:[{id:'local-animated'}]};
  const near=remote(5,'near'),mid=remote(38,'mid'),far=remote(52,'far');
  const casters=selectCharacterShadowCasters(local,[mid,far,near],0,0);
  assert.deepEqual(casters,[local.shadowMeshes[0],near.detail,mid.proxy]);
  assert.equal(near.shadowLod,'detailed');
  assert.equal(mid.shadowLod,'proxy');
  assert.equal(far.shadowLod,'off');

  // Do not switch proxy on/off merely because the avatar oscillates at 28 m.
  mid.group.position.x=CHARACTER_SHADOW_FAR+1;
  assert.ok(selectCharacterShadowCasters(local,[mid],0,0).includes(mid.proxy));
  mid.group.position.x=CHARACTER_SHADOW_FAR+3;
  assert.ok(!selectCharacterShadowCasters(local,[mid],0,0).includes(mid.proxy));
});

test('custom radius changes both detail and proxy range, including 100 metre preset',()=>{
  const local={shadowMeshes:[{id:'local'}]};
  const near=remote(98,'near'),proxy=remote(109,'proxy'),off=remote(121,'off');
  const casters=selectCharacterShadowCasters(local,[near,proxy,off],0,0,{near:100});
  assert.deepEqual(casters,[local.shadowMeshes[0],near.detail,proxy.proxy]);
  assert.equal(off.shadowLod,'off');
  assert.equal(CHARACTER_SHADOW_NEAR,30);
  assert.equal(CHARACTER_SHADOW_FAR,46);
  assert.equal(CHARACTER_SHADOW_PROXY_EXTRA,16);
});

test('distant actors are kept cheap, and detailed shadows have an explicit budget',()=>{
  const local={shadowMeshes:[{id:'local'}]};
  const nearA=remote(3,'A'),nearB=remote(6,'B');
  const casters=selectCharacterShadowCasters(local,[nearB,nearA],0,0,
    {near:CHARACTER_SHADOW_NEAR,maxDetailed:1,maxTotal:2});
  assert.deepEqual(casters,[local.shadowMeshes[0],nearA.detail,nearB.proxy]);
  const limited=selectCharacterShadowCasters(local,[nearA,nearB],0,0,
    {maxTotal:1,maxDetailed:1});
  assert.deepEqual(limited,[local.shadowMeshes[0],nearA.detail]);
  assert.equal(nearB.shadowLod,'off');
});

test('directional shadow centre snaps to the light-space texel grid',()=>{
  const direction={x:0,y:Math.sqrt(1-.3*.3),z:.3};
  const span=60,resolution=1024,texel=span/resolution;
  const point=snapCharacterShadowCenter(1.01,3.23,direction,span,resolution);
  const horizontal=point.x;
  const vertical=point.y*.3 - point.z*direction.y;
  assert.ok(Math.abs(horizontal/texel-Math.round(horizontal/texel))<1e-8);
  assert.ok(Math.abs(vertical/texel-Math.round(vertical/texel))<1e-8);
  const next=snapCharacterShadowCenter(1.018,3.23,direction,span,resolution);
  assert.ok(Math.abs(next.x-point.x)<1e-10,
    'subtexel player motion must not shift the shadow projection');
  assert.deepEqual(snapCharacterShadowCenter(2,4,{x:0,y:1,z:0},60,1024),
    {x:2,y:0,z:4});
});
