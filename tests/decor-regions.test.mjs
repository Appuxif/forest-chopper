import test from 'node:test';
import assert from 'node:assert/strict';
import {createDecorRegionManager,decorRegionKey} from '../src/decor-region-batches.js';
import {selectDecorShadowCasters} from '../src/decor-shadows.js';

class Obj {
  constructor(){
    this.children=[];this.userData={};this.visible=true;this.position={x:0,y:0,z:0};
    this.rotation={x:0,y:0,z:0};this.matrixWorld={x:0,z:0};
    this.layers={mask:1,set(n){this.mask=2**n;}};
  }
  add(child){this.children.push(child);child.parent=this;}
  remove(child){this.children.splice(this.children.indexOf(child),1);}
  traverse(fn){fn(this);for(const c of this.children)c.traverse(fn);}
  updateMatrixWorld(force){
    const p=this.parent?.matrixWorld??{x:0,z:0};
    this.matrixWorld={x:this.position.x+p.x,z:this.position.z+p.z};
    if(force)for(const c of this.children)c.updateMatrixWorld(true);
  }
}
class Mesh extends Obj {
  constructor(geo,mat){super();this.isMesh=true;this.geometry=geo;this.material=mat;}
}
class InstancedMesh extends Mesh {
  constructor(geo,mat,n){super(geo,mat);this.count=n;this.data=[];this.instanceMatrix={needsUpdate:false};}
  setMatrixAt(i,m){this.data[i]={...m};}
  getMatrixAt(i,m){Object.assign(m,this.data[i]);}
  dispose(){this.disposed=true;}
}
const THREE={Group:Obj,InstancedMesh,Matrix4:class {}};
function chunk(x,z,geo,mat){
  const root=new Obj();
  const flower=new Mesh(geo,mat);flower.position={x,y:0,z};flower.userData.decorType='flower';
  root.add(flower);
  const sign=new Mesh({},{});sign.position={x:0,y:0,z:0};
  root.add(sign);
  root.userData.shadowDecor=[flower,sign];
  return {root,flower,sign};
}

test('neighbouring chunks share one instance draw; remove restores remaining chunk',()=>{
  const scene=new Obj(),geometry={},material={};
  let changes=0;
  const manager=createDecorRegionManager(THREE,scene,{onChange:()=>changes++});
  const a=chunk(1,1,geometry,material);
  const b=chunk(27,2,geometry,material);
  manager.add(0,0,a.root);
  manager.add(1,0,b.root);
  assert.equal(manager.regions.size,1);
  const region=[...manager.regions.values()][0];
  assert.equal(region.batch.meshes.length,1);
  assert.equal(region.batch.meshes[0].count,2);
  assert.deepEqual(region.batch.meshes[0].data.map(v=>v.x),[1,27]);
  assert.deepEqual(a.root.userData.shadowDecor,[a.sign]);
  const selected=selectDecorShadowCasters(new Map([
    ['a',a.root],['b',b.root],
  ]),2,1,40,10,manager.regions);
  assert.equal(selected.filter(obj=>obj===region.batch.meshes[0]).length,1);
  b.flower.visible=false;
  b.flower.userData.decorBatch.sync(b.flower);
  assert.equal(region.batch.meshes[0].count,1);
  b.flower.visible=true;
  b.flower.userData.decorBatch.sync(b.flower);
  assert.equal(region.batch.meshes[0].count,2);
  manager.remove(a.root);
  assert.equal(manager.regions.size,1);
  assert.equal(region.batch.meshes[0].count,1);
  assert.equal(region.batch.meshes[0].data[0].x,27);
  assert.equal(a.root.userData.shadowDecor[0],a.flower);
  manager.remove(b.root);
  assert.equal(manager.regions.size,0);
  assert.equal(scene.children.length,0);
  assert.ok(changes>=4);
});

test('chunks on region boundary stay separated and clear frees source overlays',()=>{
  const scene=new Obj(),manager=createDecorRegionManager(THREE,scene);
  const a=chunk(0,0,{},{});
  const b=chunk(72,0,{},{});
  manager.add(1,0,a.root);manager.add(2,0,b.root);
  assert.equal(manager.regions.size,2);
  assert.notEqual(decorRegionKey(1,0),decorRegionKey(2,0));
  manager.clear();
  assert.equal(manager.regions.size,0);
  assert.equal(scene.children.length,0);
  assert.equal(a.flower.layers.mask,1);
  assert.equal(b.flower.layers.mask,1);
  assert.equal(a.root.userData.shadowDecor[0],a.flower);
  assert.equal(b.root.userData.shadowDecor[0],b.flower);
});

test('switching 1×1 / 2×2 / 3×3 / 5×5 preserves collected IDs and source transforms',()=>{
  const scene=new Obj(),geo={},mat={};
  const manager=createDecorRegionManager(THREE,scene);
  const a=chunk(1,1,geo,mat);
  const b=chunk(26,2,geo,mat);
  const c=chunk(49,3,geo,mat);
  for(const [x,part] of [[0,a],[1,b],[2,c]])manager.add(x,0,part.root);
  b.flower.visible=false;
  b.flower.userData.collectedResource=true;
  b.flower.userData.decorBatch.sync(b.flower);
  for(const size of [1,2,3,5,1,5]){
    assert.equal(manager.setSize(size),true);
    assert.equal(manager.size,size);
    let active=0;
    for(const region of manager.regions.values())
      for(const batch of region.batch.meshes)active+=batch.count;
    assert.equal(active,2,'only unscollected flowers remain visible');
    assert.equal(b.flower.userData.collectedResource,true);
    assert.equal(b.flower.layers.mask,2**30);
    assert.ok(a.flower.userData.decorBatch);
    assert.ok(c.flower.userData.decorBatch);
    const prior=manager.regions.size;
    assert.equal(manager.setSize(size),false,'no redundant rebuild for same size');
    assert.equal(manager.regions.size,prior);
  }
  b.flower.userData.collectedResource=false;
  b.flower.visible=true;
  b.flower.userData.decorBatch.sync(b.flower);
  assert.equal([...manager.regions.values()].reduce((sum,r)=>
    sum+r.batch.meshes.reduce((n,m)=>n+m.count,0),0),3,
    'collected flower can respawn after region changes');
  assert.throws(()=>manager.setSize(4),RangeError);
  manager.remove(a.root);
  manager.remove(b.root);
  manager.remove(c.root);
  assert.equal(manager.regions.size,0);
  assert.equal(scene.children.length,0);
});
