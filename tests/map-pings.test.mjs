import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapPings,mapPointToWorld} from '../src/map-pings.js';

test('ephemeral map markers expire, replace repeated players, cap memory and sanitize data',()=>{
  let time=1000;
  const pins=createMapPings({now:()=>time,ttlMs:8000,max:3});
  assert.equal(pins.receive({by:1,name:'Alex',x:12,z:-4}),true);
  assert.equal(pins.receive({by:2,name:'Bob',x:15,z:16}),true);
  assert.equal(pins.receive({by:1,name:'Alex',x:20,z:10}),true);
  assert.deepEqual(pins.active().map(p=>p.by),[2,1]);
  assert.equal(pins.active().find(p=>p.by===1).x,20);
  assert.equal(pins.receive({by:3,x:8,z:9}),true);
  assert.equal(pins.receive({by:4,x:5,z:6}),true);
  assert.deepEqual(pins.active().map(p=>p.by),[1,3,4],'the oldest marker is evicted');
  for(const invalid of [null,{}, {by:0,x:1,z:2},{by:1,x:NaN,z:0},
    {by:2,x:Infinity,z:0},{by:3,x:240001,z:0},{by:1,x:0,z:'0'}]){
    assert.equal(pins.receive(invalid),false);
  }
  time+=7999;
  assert.equal(pins.active().length,3);
  time+=1;
  assert.equal(pins.active().length,0);
  pins.receive({by:1,x:0,z:0});
  pins.clear();
  assert.equal(pins.active().length,0);
});

test('minimap tap coordinates are independent of CSS scaling and reject outside-circle presses',()=>{
  const size=256,range=55,rect={left:20,top:100,width:128,height:128};
  assert.deepEqual(mapPointToWorld(84,164,rect,12,-8,size,range),{x:12,z:-8});
  // Edge of the circular minimap represents a 55 m world radius.
  assert.deepEqual(mapPointToWorld(142,164,rect,0,0,size,range),{x:55,z:0});
  assert.deepEqual(mapPointToWorld(20,100,rect,0,0,size,range),null);
  assert.equal(mapPointToWorld(100,120,{left:0,top:0,width:0,height:128},0,0),null);
  assert.equal(mapPointToWorld(Infinity,20,rect,0,0),null);
  assert.deepEqual(mapPointToWorld(84,150,rect,0,0),{x:0,z:-13.3});
});
