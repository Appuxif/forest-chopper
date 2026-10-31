import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createResourceZones,zoneCoords,resourceHash,zoneResources,nearbyResources,
  RESOURCE_ZONE_SIZE,RESOURCE_LIMIT,RESOURCE_PER_ZONE,RESOURCE_RESPAWN_SECONDS,
} from '../src/resource-zones.js';

test('fixed seed yields the same positions across repeated visits, headings and sessions',()=>{
  assert.equal(RESOURCE_ZONE_SIZE,10);
  assert.deepEqual(zoneCoords(9.99,-.1),[0,-1]);
  assert.deepEqual(zoneCoords(-10.01,10),[-2,1]);
  const items=zoneResources(314159,-1,3);
  assert.equal(items.length,RESOURCE_PER_ZONE);
  assert.deepEqual(items,zoneResources(314159,-1,3));
  assert.notDeepEqual(items,zoneResources(314160,-1,3));
  assert.ok(items.every(r=>r.x>=-10&&r.x<0&&r.z>=30&&r.z<40));
  assert.ok(items.every(r=>['branch','stone'].includes(r.kind)));
});
test('nearest nine grid squares are generated without any camera filter',()=>{
  const all=nearbyResources(9981,0,0);
  assert.equal(all.length,RESOURCE_LIMIT);
  assert.equal(new Set(all.map(r=>r.id)).size,RESOURCE_LIMIT);
  assert.ok(all.some(r=>r.z<0));
  assert.ok(all.some(r=>r.z>0));
  assert.equal(all.filter(r=>r.id.startsWith('0,0:')).length,RESOURCE_PER_ZONE);
});
test('stationary and turning never changes uncollected ground items',()=>{
  let time=1_900_000_000;
  const zones=createResourceZones({seed:5,now:()=>time});
  assert.equal(zones.update({x:0,z:0,yaw:0}),true);
  const initial=zones.nodes;
  assert.equal(zones.update({x:0,z:0,yaw:Math.PI}),false);
  assert.deepEqual(zones.nodes,initial);
  assert.equal(zones.update({x:0,z:0,yaw:0,seed:5}),false);
  assert.deepEqual(zones.nodes,initial);
  assert.equal(zones.update({x:55,z:-22,yaw:0}),true);
  assert.equal(zones.update({x:0,z:0,yaw:0}),true);
  assert.deepEqual(zones.nodes,initial,'re-entering reproduces exact seed positions and ids');
});
test('collected item stays missing until ten minute deadline and then respawns',()=>{
  let time=10000;
  const zones=createResourceZones({seed:1337,now:()=>time});
  zones.update({x:0,z:0});
  const item=zones.nodes[0];
  assert.equal(zones.collect(item.id),true);
  assert.equal(zones.collect(item.id),false);
  assert.equal(zones.cooldowns[item.id],10600);
  assert.equal(zones.update({x:0,z:0}),false);
  assert.ok(!zones.nodes.some(r=>r.id===item.id));
  time=10599;
  assert.equal(zones.update({x:0,z:0}),false);
  time=10600;
  assert.equal(zones.update({x:0,z:0}),true);
  assert.deepEqual(zones.nodes.find(r=>r.id===item.id),item);
  assert.equal(zones.cooldowns[item.id],undefined);
});
test('world cooldowns can be persisted; expired entries do not resurrect after reload',()=>{
  let time=10_000;
  const first=createResourceZones({seed:88,now:()=>time});
  first.update({x:4,z:8});
  const item=first.nodes[0];
  first.collect(item.id);
  const saved=first.cooldowns;
  const next=createResourceZones({seed:88,now:()=>time});
  assert.equal(next.restore(saved),true);
  next.update({x:4,z:8});
  assert.ok(!next.nodes.some(n=>n.id===item.id));
  time+=RESOURCE_RESPAWN_SECONDS+2;
  const later=createResourceZones({seed:88,now:()=>time});
  assert.equal(later.restore(saved),true);
  later.update({x:4,z:8});
  assert.ok(later.nodes.some(n=>n.id===item.id));
  assert.equal(next.restore({'invalid':10999}),false);
});
test('hash arithmetic handles negative zones and has exact cross-language reference values',()=>{
  const a=zoneResources(123456,-3,7);
  assert.deepEqual(a,[
    {id:'-3,7:0',kind:'branch',x:-23.75,z:75.69},
    {id:'-3,7:1',kind:'branch',x:-25.92,z:77.06},
  ]);
  assert.equal(resourceHash(123456,-3,7,0,0)>=0,true);
});
