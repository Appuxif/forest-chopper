import test from 'node:test';
import assert from 'node:assert/strict';
import {createWind} from '../src/wind.js';

function tree(id,x,z,birch=false) {
  return {
    position:{x,z},
    userData:{id,species:birch?'birch':'conifer',hp:10,maxHp:10},
    rotation:{x:0,y:0,z:0},
    children:Array.from({length:5},(_,i)=>({
      geometry:{id:'shared'},
      material:{id:'shared'},
      rotation:{x:i===0?0:.017*i,y:birch?.23*i:0,z:i===0?0:-.008*i},
      position:{x:i*.14,y:i*1.1,z:0},
    })),
  };
}
function fixture() {
  const trees=new Map();
  for (let i=0;i<140;i++) trees.set(String(i),tree(String(i), (i%14-7)*2, (Math.floor(i/14)-5)*2, i%3===0));
  const ctx={trees,px:0,pz:0,settings:{windEnabled:true}};
  const motionQuery={matches:false};
  const wind=createWind(ctx,{motionQuery,intervalMs:150,radius:24,maxTrees:28});
  return {ctx,motionQuery,wind};
}
const snapshot = t => t.children.map(c=>({x:c.rotation.x,y:c.rotation.y,z:c.rotation.z,geometry:c.geometry,material:c.material,position:{...c.position}}));

test('wind sways only up to 28 nearby crowns, with fixed trunks/materials and frame throttling',()=>{
  const {ctx,wind}=fixture();
  const original=new Map([...ctx.trees].map(([id,t])=>[id,snapshot(t)]));
  wind.tick(0);
  assert.equal(wind.activeCount,28);
  let affected=0;
  for(const [id,t] of ctx.trees){
    const before=original.get(id),after=snapshot(t);
    assert.deepEqual(after[0],before[0],'trunk cannot move');
    assert.ok(t.children.every((child,i)=>child.geometry===before[i].geometry&&child.material===before[i].material));
    assert.ok(t.children.every((child,i)=>child.rotation.y===before[i].y), 'original birch yaw must persist');
    assert.equal(t.userData.hp,10);
    if(after.slice(1).some((child,i)=>child.x!==before[i+1].x||child.z!==before[i+1].z)){
      affected++;
      assert.ok(after.slice(1).every((child,i)=>Math.abs(child.x-before[i+1].x)<.01&&Math.abs(child.z-before[i+1].z)<.025));
    }
  }
  assert.ok(affected>=24,'expected many nearby swaying trees, got '+affected);
  const previous=[...ctx.trees.values()].map(snapshot);
  wind.tick(100);
  assert.deepEqual([...ctx.trees.values()].map(snapshot),previous);
  wind.tick(151);
  assert.equal(wind.activeCount,28);
  assert.notDeepEqual([...ctx.trees.values()].map(snapshot),previous);
  wind.clear();
  assert.equal(wind.activeCount,0);
  for(const [id,t] of ctx.trees)assert.deepEqual(snapshot(t),original.get(id));
  wind.clear();
});

test('unloaded, felled and distant trees restore their leaf rotations instead of leaking references',()=>{
  const {ctx,wind}=fixture();
  wind.tick(0);
  const activeTree=[...ctx.trees.values()].find(t=>t.children[1].rotation.z!==-.008);
  const leafOrigin=-.008;
  assert.ok(activeTree);
  for(const [id,t] of ctx.trees) if(t===activeTree)ctx.trees.delete(id);
  wind.tick(160);
  assert.equal(activeTree.children[1].rotation.z,leafOrigin);
  assert.equal(wind.activeCount,28);
  ctx.px=10000;ctx.pz=10000;
  wind.tick(320);
  assert.equal(wind.activeCount,0);
});

test('wind respects both reduce-motion and the persisted player preference immediately',()=>{
  const {ctx,wind,motionQuery}=fixture();
  motionQuery.matches=true;
  wind.tick(0);
  assert.equal(wind.activeCount,0);
  motionQuery.matches=false;
  wind.tick(180);
  assert.equal(wind.activeCount,28);
  const moved=[...ctx.trees.values()].find(t=>t.children[1].rotation.z!==-.008);
  ctx.settings.windEnabled=false;
  wind.tick(181);
  assert.equal(wind.activeCount,0);
  assert.equal(moved.children[1].rotation.z,-.008);
  ctx.settings.windEnabled=true;
  wind.tick(330);
  assert.equal(wind.activeCount,28);
  motionQuery.matches=true;
  wind.tick(331);
  assert.equal(wind.activeCount,0);
  assert.equal(moved.children[1].rotation.z,-.008);
});
