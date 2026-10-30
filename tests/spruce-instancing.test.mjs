import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpruceBatch,detachSpruceForFall,prepareSpruceParts} from '../src/spruce-instancing.js';

class Vec {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){Object.assign(this,{x,y,z});return this;}
  copy(v){return this.set(v.x,v.y,v.z);}
}
class FakeObject {
  constructor(){
    this.position=new Vec();this.scale={value:1,setScalar(n){this.value=n;}};
    this.rotation={set(x,y,z){Object.assign(this,{x,y,z});}};
    this.children=[];
  }
  updateMatrix(){this.matrix={x:this.position.x,y:this.position.y,z:this.position.z,s:this.scale.value};}
  add(v){this.children.push(v);}
  remove(v){this.children=this.children.filter(child=>child!==v);}
}
class FakeInstances {
  constructor(geometry,material,capacity){
    this.geometry=geometry;this.material=material;this.capacity=capacity;this.count=0;
    this.matrices=[];this.instanceMatrix={setUsage(){}};
  }
  setMatrixAt(i,m){this.matrices[i]={...m};}
  computeBoundingSphere(){this.boundsComputed=(this.boundsComputed??0)+1;}
  dispose(){this.disposed=true;}
}
const THREE={Object3D:FakeObject,InstancedMesh:FakeInstances,DynamicDrawUsage:35048};
function tree(x,z,h,scale){
  return {position:new Vec(x,0,z),userData:{h,scale}};
}

test('two GPU batches hold eight trees and compact after removing one',()=>{
  const parent=new FakeObject(),parts=[{geometry:'bark',material:'brown'},{geometry:'needles',material:'green'}];
  const batch=createSpruceBatch(THREE,parts,parent,8);
  assert.equal(batch.meshes.length,2);
  assert.equal(parent.children.length,2);
  const entries=Array.from({length:8},(_,i)=>tree(i*3,i,9+i*.2,1.2));
  entries.forEach(e=>batch.add(e));
  for(const mesh of batch.meshes){
    assert.equal(mesh.count,8);
    assert.equal(mesh.matrices[7].x,21);
    assert.ok(Math.abs(mesh.matrices[0].s-10.8)<1e-9);
    assert.equal(mesh.castShadow,true);
  }
  batch.remove(entries[3]);
  assert.equal(entries[3].userData.spruceBatch,null);
  assert.equal(batch.meshes[0].count,7);
  assert.equal(batch.meshes[0].matrices[3].x,12);
  batch.dispose();
  assert.equal(parent.children.length,0);
  assert.ok(batch.meshes.every(m=>m.disposed));
  assert.ok(entries.every(t=>t.userData.spruceBatch===null));
});

test('falling spruce detaches from batch and gets its own animated model',()=>{
  const parent=new FakeObject();
  const batch=createSpruceBatch(THREE,[{geometry:'bark',material:'brown'}],parent);
  const trunk=tree(5,2,12,1.3);
  trunk.add=object=>{trunk.visual=object;};
  batch.add(trunk);
  let detached=0;
  const ctx={
    spruceTemplate:{clone(){return {scale:{multiplyScalar(n){this.n=n;}}};}},
    atmosphere:{invalidateStaticShadows(){detached++;}}
  };
  detachSpruceForFall(ctx,trunk);
  assert.equal(batch.meshes[0].count,0);
  assert.ok(Math.abs(trunk.visual.scale.n-15.6)<1e-9);
  assert.equal(trunk.userData.spruceBatch,null);
  assert.equal(detached,1);
  // A repeated notification should not duplicate the fallen model.
  detachSpruceForFall(ctx,trunk);
  assert.equal(detached,1);
});

test('GLB component transforms are baked once for shared instance meshes',()=>{
  const calls=[];
  const template={
    updateMatrixWorld(v){calls.push('world:'+v);},
    traverse(callback){
      callback({isMesh:true,geometry:{clone(){return {applyMatrix4(matrix){calls.push(matrix);return this;}};}},material:'bark',matrixWorld:'A'});
      callback({isMesh:false});
      callback({isMesh:true,geometry:{clone(){return {applyMatrix4(matrix){calls.push(matrix);return this;}};}},material:'needles',matrixWorld:'B'});
    }
  };
  assert.deepEqual(prepareSpruceParts(THREE,template).map(part=>part.material),['bark','needles']);
  assert.deepEqual(calls,['world:true','A','B']);
});
