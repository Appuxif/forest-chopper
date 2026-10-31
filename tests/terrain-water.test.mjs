import test from 'node:test';
import assert from 'node:assert/strict';
import {terrainHeight} from '../src/terrain.js';
import {baseTerrainHeight} from '../src/terrain-noise.js';
import {pondDepthAt,pondsNearTile,pondSandAt} from '../src/ponds.js';
import {lakeAt,lakesNearTile,lakeNormalized} from '../src/lakes.js';

test('terrain height is deterministic, flat at spawn and continuous around grid boundaries',()=>{
  for(const seed of [1,112233,999998]){
    assert.ok(Math.abs(terrainHeight(seed,0,0))<1e-12);
    for(const [x,z] of [[2,1],[90,80],[300,-240],[-400,200]]){
      assert.equal(terrainHeight(seed,x,z),terrainHeight(seed,x,z));
      assert.ok(Number.isFinite(terrainHeight(seed,x,z)));
      const nearby=terrainHeight(seed,x+.001,z);
      assert.ok(Math.abs(terrainHeight(seed,x,z)-nearby)<.1,
        'the heightfield is continuous at arbitrary chunk seams');
    }
  }
});

test('rare lakes and ponds have real depth, sloping sandy shores and no duplicate lake IDs',()=>{
  const seed=123456,lake=lakeAt(seed,0,-1);
  assert.ok(lake);
  assert.equal(lake.kind,'lake');
  assert.ok(lake.depth>=4.5&&lake.depth<=6);
  assert.ok(lake.rx>80&&lake.rz>65);
  assert.ok(pondDepthAt(seed,lake.x,lake.z)>3.5);
  assert.ok(terrainHeight(seed,lake.x,lake.z)<baseTerrainHeight(seed,lake.x,lake.z));
  assert.ok(lakeNormalized(lake,lake.x,lake.z)<.01);
  const sand=pondSandAt(lake,lake.x,lake.z,terrainHeight(seed,lake.x,lake.z));
  assert.ok(sand.sand>.9);
  const nearby=lakesNearTile(seed,lake.x-20,lake.z-20,40);
  assert.equal(nearby.filter(x=>x.id===lake.id).length,1);
  assert.ok(pondsNearTile(seed,lake.x-20,lake.z-20,40).some(x=>x.id===lake.id));
  // Land outside the carved basin cannot be treated as submerged, even
  // if an adjacent hillside is lower than the horizontal water plane.
  for(const u of [1.01,1.08,1.17]){
    const x=lake.x+lake.rx*u*1.22;
    assert.equal(pondDepthAt(seed,x,lake.z),0);
  }
});

test('pond and lake beds are on the same world-coordinate heightfield',()=>{
  const seed=123456;
  const center=pondsNearTile(seed,82,46,40).find(p=>p.kind===5);
  assert.ok(center,'the guaranteed showcase pond remains');
  const d=pondDepthAt(seed,center.x,center.z);
  assert.ok(d>.5&&d<6);
  assert.ok(Math.abs(terrainHeight(seed,center.x,center.z)-center.level)<6);
});
