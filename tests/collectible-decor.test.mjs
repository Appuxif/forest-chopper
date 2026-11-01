import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DECOR_ITEM_IDS,DECOR_ITEM_NAMES,MUSHROOM_IDS,FLOWER_IDS,
  decorResource,nearbyDecorResources,isDecorResourceId
} from '../src/collectible-decor.js';
import {createInventoryModel,ITEM_STACK,validItem} from '../src/inventory.js';
import {createResourceZones,nearbyResources,RESOURCE_RESPAWN_SECONDS} from '../src/resource-zones.js';
import {ITEM_NAMES} from '../src/ground-boxes.js';

test('four actual mushroom species and four flowers are individually collectible',()=>{
  assert.equal(MUSHROOM_IDS.length,4);
  assert.equal(FLOWER_IDS.length,4);
  assert.equal(DECOR_ITEM_IDS.length,9);
  for(const id of DECOR_ITEM_IDS){
    assert.equal(ITEM_STACK[id],10,id);
    assert.ok(DECOR_ITEM_NAMES[id]);
    assert.equal(ITEM_NAMES[id],DECOR_ITEM_NAMES[id]);
    assert.equal(validItem({id,count:1}),true);
    assert.equal(validItem({id,count:11}),false);
  }
});
test('existing chunk positions and species are stable across generation and reload',()=>{
  const items=nearbyDecorResources(12345,0,0);
  assert.equal(items.length,71);
  assert.equal(items.filter(x=>x.kind==='dry_grass').length,30);
  assert.deepEqual(items.slice(0,2).map(item=>({
    id:item.id,kind:item.kind,
    x:+item.x.toFixed(4),z:+item.z.toFixed(4),
  })),[
    {id:'d:-1,-1:5',kind:'flower:pink_wildflower',x:-13.9651,z:-16.4325},
    {id:'d:-1,-1:7',kind:'dry_grass',x:-23.1193,z:-19.8328},
  ]);
  for(const item of items){
    assert.ok(isDecorResourceId(item.id));
    const [cx,cz,index]=item.id.slice(2).split(/[:,]/).map(Number);
    assert.deepEqual(decorResource(12345,cx,cz,index),item);
    assert.ok(item.kind==='dry_grass'||['mushroom:','flower:'].some(prefix=>item.kind.startsWith(prefix)));
  }
  assert.equal(decorResource(12345,0,0,25),null);
  assert.equal(decorResource(12345,0,0,-1),null);
  assert.equal(isDecorResourceId('d:0,0:25'),false);
  assert.equal(isDecorResourceId('0,0:0'),false);
});
test('inventory stacks same type, never mixes boletus with milkcap or flowers',()=>{
  const bag=createInventoryModel();
  const items=[
    'mushroom:fly_agaric','mushroom:boletus','mushroom:milkcap',
    'flower:daisy','flower:buttercup',
  ];
  for(const id of items)assert.equal(bag.addItem({id,count:3}),true);
  assert.equal(bag.addItem({id:'mushroom:boletus',count:9}),true);
  const stored=bag.slots.filter(Boolean);
  assert.equal(stored.filter(x=>x.id==='mushroom:boletus').length,2);
  assert.deepEqual(stored.filter(x=>x.id==='mushroom:boletus').map(x=>x.count),[10,2]);
  for(const id of items.filter(x=>x!=='mushroom:boletus'))
    assert.equal(bag.count(id),3);
  const restored=createInventoryModel();
  assert.equal(restored.restore(bag.serialize(),0),true);
  assert.deepEqual(restored.slots,bag.slots);
});
test('flower and mushroom respawn after exactly ten minutes using existing resource cooldowns',()=>{
  let time=10000;
  const zones=createResourceZones({seed:12345,now:()=>time});
  zones.update({x:0,z:0});
  const flower=zones.nodes.find(x=>x.kind==='flower:buttercup');
  const mushroom=zones.nodes.find(x=>x.kind==='mushroom:milkcap');
  assert.ok(flower);assert.ok(mushroom);
  assert.equal(zones.collect(flower.id),true);
  assert.equal(zones.collect(mushroom.id),true);
  assert.equal(zones.isCollected(flower.id),true);
  const snapshot=zones.cooldowns;
  assert.equal(snapshot[flower.id],time+RESOURCE_RESPAWN_SECONDS);
  assert.equal(snapshot[mushroom.id],time+RESOURCE_RESPAWN_SECONDS);
  const reloaded=createResourceZones({seed:12345,now:()=>time});
  assert.equal(reloaded.restore(snapshot),true);
  reloaded.update({x:0,z:0});
  assert.ok(!reloaded.nodes.some(x=>x.id===flower.id||x.id===mushroom.id));
  time+=RESOURCE_RESPAWN_SECONDS;
  reloaded.update({x:0,z:0});
  assert.deepEqual(reloaded.nodes.find(x=>x.id===flower.id),flower);
  assert.deepEqual(reloaded.nodes.find(x=>x.id===mushroom.id),mushroom);
  assert.equal(reloaded.isCollected(flower.id),false);
  assert.equal(nearbyResources(12345,0,0,{}).length,18+71);
});

test('dry grass shares cooldowns and has tiny carry weight',()=>{
 let now=5000;
 const zones=createResourceZones({seed:12345,now:()=>now});
 zones.update({x:0,z:0});
 const grass=zones.nodes.find(x=>x.kind==='dry_grass');
 assert.ok(grass);
 assert.equal(zones.collect(grass.id),true);
 const inventory=createInventoryModel();
 assert.equal(inventory.addItem({id:'dry_grass',count:10}),true);
 assert.equal(inventory.count('dry_grass'),10);
 assert.ok(Math.abs(inventory.weight()-4)<1e-9);
 const saved=zones.cooldowns;
 const reloaded=createResourceZones({seed:12345,now:()=>now});
 assert.equal(reloaded.restore(saved),true);
 reloaded.update({x:0,z:0});
 assert.equal(reloaded.nodes.some(x=>x.id===grass.id),false);
 now+=RESOURCE_RESPAWN_SECONDS;
 reloaded.update({x:0,z:0});
 assert.deepEqual(reloaded.nodes.find(x=>x.id===grass.id),grass);
});
