import test from 'node:test';
import assert from 'node:assert/strict';
import {debugFlightDelta} from '../src/debug-flight-motion.js';

const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8, `${actual} != ${expected}`);

test('flight W follows the camera direction including vertical pitch',()=>{
 const level=debugFlightDelta({forward:1,yaw:0,pitch:0,dt:1});
 near(level.x,0);near(level.y,0);near(level.z,-24);
 const upwards=debugFlightDelta({forward:1,yaw:0,pitch:Math.PI/2,dt:1});
 near(upwards.x,0);near(upwards.y,24);near(upwards.z,0);
 const downwards=debugFlightDelta({forward:1,pitch:-Math.PI/2,dt:1});
 near(downwards.y,-24);
 const back=debugFlightDelta({forward:-1,pitch:Math.PI/2,dt:1});
 near(back.y,-24);
});
test('flight strafing stays horizontal regardless of camera pitch, yaw rotates movement',()=>{
 const r=debugFlightDelta({side:1,yaw:0,pitch:1.2,dt:1});
 near(r.x,24);near(r.y,0);near(r.z,0);
 const turned=debugFlightDelta({forward:1,yaw:Math.PI/2,pitch:0,dt:1});
 near(turned.x,-24);near(turned.z,0);
});
test('manual vertical controls work independently of the camera and normalize diagonal speed',()=>{
 const asc=debugFlightDelta({vertical:1,pitch:-1,dt:1});
 near(asc.y,24);
 const desc=debugFlightDelta({vertical:-1,pitch:1,dt:1});
 near(desc.y,-24);
 const diagonal=debugFlightDelta({forward:1,vertical:1,dt:1});
 near(Math.hypot(diagonal.x,diagonal.y,diagonal.z),24);
 const half=debugFlightDelta({forward:.5,pitch:0,dt:1});
 near(half.z,-12);
});
