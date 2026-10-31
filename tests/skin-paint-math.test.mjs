import test from 'node:test';
import assert from 'node:assert/strict';
import {uvToCanvas,interpolateScreenPoints,PAINT_RESOLUTION} from '../characters/humanoid/skin-paint-math.js';

test('UV masks resolve to 1024 pixels and preserve glTF UV orientation',()=>{
 assert.equal(PAINT_RESOLUTION,1024);
 assert.deepEqual(uvToCanvas({x:.5,y:.25}),{x:512,y:256});
 assert.deepEqual(uvToCanvas({x:0,y:1}),{x:0,y:1024});
});
test('a mouse stroke is sampled every <=5 screen pixels, including endpoint',()=>{
 const samples=interpolateScreenPoints({x:0,y:0},{x:12,y:0},5);
 assert.deepEqual(samples,[{x:4,y:0},{x:8,y:0},{x:12,y:0}]);
});
test('stationary brush generates a single sample',()=>{
 assert.deepEqual(interpolateScreenPoints({x:3,y:7},{x:3,y:7}),[{x:3,y:7}]);
});
test('diagonal brush samples intermediate points and ends at exact target',()=>{
 const p=interpolateScreenPoints({x:5,y:5},{x:15,y:15},4);
 assert.equal(p.length,4);
 assert.deepEqual(p[p.length-1],{x:15,y:15});
 assert.ok(p[1].x>p[0].x&&p[1].y>p[0].y);
});
