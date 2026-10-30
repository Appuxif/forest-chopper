import test from 'node:test';
import assert from 'node:assert/strict';
import {createMushrooms,MUSHROOM_SPECIES} from '../src/mushrooms.js';

function threeMock(){
  const allocations={geometries:[],materials:[]};
  class Geometry {
    constructor(...args){this.args=args;allocations.geometries.push(this)}
  }
  class BufferGeometry extends Geometry {
    setAttribute(name,attribute){this.attributes??={};this.attributes[name]=attribute}
    computeVertexNormals(){this.normalsComputed=true}
  }
  class Float32BufferAttribute {
    constructor(array,itemSize){this.array=array;this.itemSize=itemSize}
  }
  class Material {
    constructor(options){this.options=options;allocations.materials.push(this)}
  }
  class Vector2 {constructor(x,y){this.x=x;this.y=y}}
  class Object3D {
    constructor(){
      this.children=[];
      this.userData={};
      this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z})}};
      this.scale={x:1,y:1,z:1,set(x,y,z){Object.assign(this,{x,y,z})},setScalar(v){this.x=this.y=this.z=v}};
      this.rotation={x:0,y:0,z:0};
    }
    add(obj){this.children.push(obj)}
  }
  class Mesh extends Object3D {
    constructor(geometry,material){super();this.geometry=geometry;this.material=material}
  }
  const THREE={
    CylinderGeometry:Geometry,SphereGeometry:Geometry,LatheGeometry:Geometry,
    CircleGeometry:Geometry,TorusGeometry:Geometry,BufferGeometry,
    Float32BufferAttribute,Vector2,MeshLambertMaterial:Material,
    Mesh,Group:Object3D,DoubleSide:2,
  };
  return {THREE,allocations};
}

test('four mushroom types have distinctive shared stems/caps with recognizable details',()=>{
  const {THREE,allocations}=threeMock();
  const assets=createMushrooms(THREE);
  assert.deepEqual(MUSHROOM_SPECIES,['fly_agaric','boletus','death_cap','milkcap']);
  assert.equal(assets.geometries.length,8);
  assert.equal(assets.materials.length,11);
  assert.equal(allocations.geometries.length,8);
  assert.equal(allocations.materials.length,11);
  const expected={
    fly_agaric:['stem','cap','gills','spots'],
    boletus:['stem','cap','pores'],
    death_cap:['stem','cap','gills','ring'],
    milkcap:['stem','cap','gills'],
  };
  const mushrooms=MUSHROOM_SPECIES.map((name,i)=>{
    const mushroom=assets.create(i);
    assert.equal(mushroom.userData.mushroomSpecies,name);
    assert.deepEqual(mushroom.children.map(mesh=>mesh.userData.mushroomPart),expected[name]);
    assert.ok(mushroom.children.every(mesh=>assets.geometries.includes(mesh.geometry)));
    assert.ok(mushroom.children.every(mesh=>assets.materials.includes(mesh.material)));
    assert.ok(mushroom.children.every(mesh=>mesh.position.y>=0));
    return mushroom;
  });
  // Tall slender death cap, thick and broad bolete, broad milkcap, spotted fly agaric.
  assert.ok(mushrooms[2].children[0].scale.x < mushrooms[1].children[0].scale.x);
  assert.ok(mushrooms[1].children[0].scale.x > mushrooms[0].children[0].scale.x);
  assert.notEqual(mushrooms[3].children[1].geometry,mushrooms[1].children[1].geometry);
  const spots=mushrooms[0].children.find(x=>x.userData.mushroomPart==='spots');
  const dots=spots.geometry;
  assert.equal(dots.normalsComputed,true);
  assert.equal(dots.attributes.position.array.length,9*7*3*3);
  assert.ok(dots.attributes.position.array.every(v=>Number.isFinite(v)));
  assert.equal(mushrooms[2].children.find(x=>x.userData.mushroomPart==='ring').rotation.x,Math.PI/2);
  for(let i=0;i<150;i++)assets.create(i%4);
  assert.equal(allocations.geometries.length,8,'unloaded/rebuilt mushrooms do not allocate GPU geometries');
  assert.equal(allocations.materials.length,11,'unloaded/rebuilt mushrooms do not allocate GPU materials');
});

test('shared cap profiles are non-flat and all caps stay above their stems',()=>{
  const {THREE}=threeMock(),factory=createMushrooms(THREE);
  const profiles=factory.geometries.slice(2,5).map(g=>g.args[0]);
  assert.equal(profiles.length,3);
  assert.ok(profiles.every(points=>points.length>=7));
  const bolete=profiles[0],death=profiles[1],milk=profiles[2];
  assert.ok(bolete.at(-1).y>bolete[0].y,'rounded bolete cap');
  assert.ok(death.at(-1).y>death[0].y,'pale toadstool bell');
  assert.ok(milk.at(-1).y < milk.at(-3).y,'milkcap centre sinks below its outer lip');
});
