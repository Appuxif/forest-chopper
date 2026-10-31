import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createResourceZones,zoneCoords,behindPlayer,RESOURCE_ZONE_SIZE,
  RESOURCE_LIMIT,RESOURCE_RADIUS,RESOURCE_PER_ZONE
} from '../src/resource-zones.js';

test('grid keys are stable in all four quadrants',()=>{
  assert.equal(RESOURCE_ZONE_SIZE,10);
  assert.deepEqual(zoneCoords(0,0),[0,0]);
  assert.deepEqual(zoneCoords(9.99,-.1),[0,-1]);
  assert.deepEqual(zoneCoords(-10,-10),[-1,-1]);
  assert.deepEqual(zoneCoords(-10.01,10),[-2,1]);
});
test('resources only spawn distinctly behind the camera heading',()=>{
  // yaw=0 faces negative Z; only positive Z is sufficiently behind.
  assert.equal(behindPlayer(0,0,0,0,5),true);
  assert.equal(behindPlayer(0,0,0,0,-5),false);
  assert.equal(behindPlayer(0,0,Math.PI,0,5),false);
  assert.equal(behindPlayer(0,0,Math.PI,0,-5),true);
  assert.equal(behindPlayer(0,0,-Math.PI/2,5,0),false);
  assert.equal(behindPlayer(0,0,-Math.PI/2,-5,0),true);
});
test('one-time zone population stays stable as player stands still and rotates',()=>{
  const spawner=createResourceZones();
  assert.equal(spawner.update({x:0,z:0,yaw:0}),true);
  const first=spawner.nodes;
  assert.ok(first.length>0);
  assert.ok(first.length<=RESOURCE_LIMIT);
  assert.ok(spawner.zones.length<=9);
  assert.ok(spawner.zones.length>0);
  assert.ok(spawner.nodes.every(n=>n.kind==='stone'||n.kind==='branch'));
  assert.ok(spawner.nodes.every(n=>Math.hypot(n.x,n.z)<=RESOURCE_RADIUS));
  assert.ok(spawner.nodes.every(n=>behindPlayer(0,0,0,n.x,n.z)));
  const zoneItems=new Map();
  for(const n of first)zoneItems.set(n.zone,(zoneItems.get(n.zone)??0)+1);
  assert.ok([...zoneItems.values()].every(n=>n<=RESOURCE_PER_ZONE));
  assert.equal(spawner.update({x:0,z:0,yaw:0}),false);
  assert.equal(spawner.update({x:0,z:0,yaw:Math.PI/2}),false);
  assert.deepEqual(spawner.nodes,first,'looking back at the generated area must not spawn new items');
});
test('collecting a few resources never makes fresh ones pop into sight',()=>{
  const spawner=createResourceZones();
  spawner.update({x:0,z:0,yaw:0});
  const all=spawner.nodes;
  const takeCount=Math.min(Math.max(0,all.length-2),3);
  for(const n of all.slice(0,takeCount))assert.equal(spawner.collect(n.id),true);
  const after=spawner.nodes;
  assert.equal(after.length,all.length-takeCount);
  assert.equal(spawner.update({x:0,z:0,yaw:0}),false);
  assert.equal(spawner.update({x:0,z:0,yaw:Math.PI}),false);
  assert.deepEqual(spawner.nodes,after);
});
test('leaving an area forgets resources, and reentry creates different ids',()=>{
  const spawner=createResourceZones();
  spawner.update({x:0,z:0,yaw:0});
  const originals=spawner.nodes.map(n=>n.id);
  assert.ok(originals.length>0);
  spawner.update({x:50,z:50,yaw:0});
  assert.ok(spawner.nodes.every(n=>Math.hypot(n.x-50,n.z-50)<=RESOURCE_RADIUS));
  assert.ok(spawner.nodes.every(n=>!originals.includes(n.id)));
  spawner.update({x:0,z:0,yaw:0});
  assert.ok(spawner.nodes.length>0);
  assert.ok(spawner.nodes.every(n=>!originals.includes(n.id)));
});
test('items from other neighbouring zones disappear beyond 10 metres and do not reappear while watched',()=>{
  const spawner=createResourceZones();
  spawner.update({x:0,z:0,yaw:0});
  spawner.update({x:9,z:0,yaw:0});
  assert.ok(spawner.nodes.every(n=>Math.hypot(n.x-9,n.z)<=RESOURCE_RADIUS));
  const existing=spawner.nodes.map(n=>n.id);
  spawner.update({x:9,z:0,yaw:Math.PI});
  assert.deepEqual(spawner.nodes.map(n=>n.id),existing);
  spawner.clear();
  assert.equal(spawner.count,0);
  assert.equal(spawner.zones.length,0);
});
