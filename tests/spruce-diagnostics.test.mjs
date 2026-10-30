import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpruceDiagnostics} from '../src/spruce-diagnostics.js';

class BufferAttribute {
  constructor(array,itemSize){this.array=array;this.itemSize=itemSize;}
}
class Geometry {
  constructor(cards=20) {
    this.index=new BufferAttribute(new Uint16Array(
      Array.from({length:cards},(_,i)=>[i*4,i*4+1,i*4+2,i*4,i*4+2,i*4+3]).flat()),1);
    this.position={count:cards*4};
    this.disposed=0;
  }
  getAttribute(name){return name==='position'?this.position:null;}
  clone() {
    const g=new Geometry();
    g.index=new BufferAttribute(new Uint16Array(this.index.array),1);
    g.position={...this.position};
    return g;
  }
  setIndex(attribute){this.index=attribute;}
  dispose(){this.disposed++;}
}
const THREE={BufferAttribute};
function fixture(){
  const geometry=new Geometry(),barkGeometry={};
  const atlas={image:{width:512,height:512}},material={map:atlas,alphaTest:.45,type:'MeshStandardMaterial'};
  const barkMat={vertexColors:true,map:{uuid:'spruce-bark'},alphaTest:0,type:'MeshLambertMaterial'};
  const settings={spruceFoliageVisible:true,spruceFoliageShadows:true,spruceFoliageDensity:100};
  const foliageMesh={geometry,material,visible:true,castShadow:true,
    computeBoundingSphere(){this.bounds=(this.bounds??0)+1;}};
  const barkMesh={geometry:barkGeometry,material:barkMat,visible:true,castShadow:true};
  const batch={meshes:[barkMesh,foliageMesh]};
  const original={geometry,material,visible:false,castShadow:false,userData:{spruceFoliage:true}};
  const tree={children:[{geometry:barkGeometry,material:barkMat,userData:{}},original],
    userData:{spruceModel:true,treeBatch:batch}};
  let invalidations=0;
  const ctx={spruceParts:[{geometry:barkGeometry,material:barkMat},{geometry,material}],
    settings,chunks:new Map([[1,{userData:{treeBatch:batch}}]]),
    trees:new Map([[1,tree]]),falling:[],
    atmosphere:{invalidateStaticShadows(){invalidations++;}}};
  const controls=createSpruceDiagnostics(THREE,ctx);
  controls.applyBatch(batch);controls.applyTree(tree);
  return {geometry,barkGeometry,material,settings,foliageMesh,barkMesh,
    original,tree,ctx,controls,get invalidations(){return invalidations;}};
}

test('generated spruce preserves original texture/material and bark while toggling foliage',()=>{
  const f=fixture();
  f.settings.spruceFoliageVisible=false;
  assert.equal(f.controls.tick(),true);
  assert.equal(f.foliageMesh.visible,false);
  assert.equal(f.foliageMesh.castShadow,false);
  assert.equal(f.barkMesh.visible,true);
  assert.equal(f.barkMesh.castShadow,true);
  assert.equal(f.barkMesh.material.map.uuid,'spruce-bark',
    'textured bark must never be treated as foliage');
  assert.equal(f.foliageMesh.material,f.material);
  assert.equal(f.foliageMesh.geometry,f.geometry);
  f.settings.spruceFoliageVisible=true;
  f.settings.spruceFoliageShadows=false;
  f.controls.tick();
  assert.equal(f.foliageMesh.visible,true);
  assert.equal(f.foliageMesh.castShadow,false);
  assert.equal(f.barkMesh.castShadow,true);
  assert.equal(f.controls.tick(),false);
  assert.equal(f.invalidations,2);
});

test('density slider removes whole quads from already-trimmed shared geometry, restores 100%',()=>{
  const f=fixture(),source=Array.from(f.geometry.index.array);
  const records=[];
  for(const density of [75,50,25,20,5,0,100]){
    f.settings.spruceFoliageDensity=density;
    assert.equal(f.controls.tick(),true);
    assert.equal(f.foliageMesh.geometry,f.original.geometry);
    assert.equal(f.foliageMesh.material,f.material);
    assert.equal(f.foliageMesh.geometry.index.array.length,
      density===0?120:120*density/100);
    assert.equal(f.foliageMesh.visible,density>0);
    assert.equal(f.foliageMesh.castShadow,density>0);
    assert.equal(f.barkMesh.geometry,f.barkGeometry);
    records.push({density,ids:[...f.foliageMesh.geometry.index.array].filter((_,i)=>i%6===0)});
  }
  assert.equal(f.foliageMesh.geometry,f.geometry);
  assert.deepEqual([...f.geometry.index.array],source,'original trimmed geometry unchanged');
  assert.ok(records[2].ids.some(i=>i/4>5),'sampling distributed throughout branches');
  assert.ok(records[2].ids.every(id=>records[1].ids.includes(id)));
  assert.equal(f.geometry.disposed,0);
  assert.equal(f.foliageMesh.bounds,6,'culling bounds updated after geometry swap');
});

test('new chunks and falling trees inherit current foliage density, visibility and shadows',()=>{
  const f=fixture();
  f.settings.spruceFoliageDensity=50;f.settings.spruceFoliageShadows=false;
  f.controls.tick();
  const extra={geometry:f.geometry,material:f.material,visible:true,castShadow:true};
  const next={meshes:[extra]};
  f.controls.applyBatch(next);
  assert.equal(extra.geometry.index.array.length,60);
  assert.equal(extra.castShadow,false);
  f.tree.userData.treeBatch=null;
  f.ctx.trees.clear();
  f.ctx.falling.push({tree:f.tree});
  f.controls.applyTree(f.tree);
  assert.equal(f.original.visible,true);
  assert.equal(f.original.castShadow,false);
  f.settings.spruceFoliageVisible=false;
  f.controls.tick();
  assert.equal(f.original.visible,false);
  assert.equal(f.original.material,f.material);
});

test('fallback when procedural generator fails remains safe',()=>{
  const diagnostics=createSpruceDiagnostics(THREE,{spruceParts:null});
  assert.equal(diagnostics.tick(),undefined);
  diagnostics.applyBatch({meshes:[]});
  diagnostics.applyTree({userData:{spruceModel:true},children:[]});
});
