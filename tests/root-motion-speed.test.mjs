import test from 'node:test';
import assert from 'node:assert/strict';
import {MIN_ROOT_TRAVEL,rootMotionSpeed,playbackRateForSpeed} from '../src/root-motion-speed.js';

const info=(x,z,duration)=>({travel:{x,z},duration});

test('animation travel and duration determine native meters per second',()=>{
 const run=info(0,1.8882,22/30);
 assert.ok(Math.abs(rootMotionSpeed(run)-2.5748)<.001);
 assert.ok(Math.abs(playbackRateForSpeed(run,4.6)-1.786)<.005);
});

test('root playback reacts to different animation frame counts',()=>{
 const sameTravelShort=info(0,1.5,15/30);
 const sameTravelLong=info(0,1.5,30/30);
 assert.equal(rootMotionSpeed(sameTravelShort),3);
 assert.equal(rootMotionSpeed(sameTravelLong),1.5);
 assert.equal(playbackRateForSpeed(sameTravelLong,3),2);
 assert.equal(playbackRateForSpeed(sameTravelShort,3),1);
});

test('stationary walk is not mistaken for real root motion',()=>{
 assert.equal(rootMotionSpeed(info(.0009,.0001,1)),0);
 assert.equal(playbackRateForSpeed(info(0,0,1),2.5),1);
 assert.equal(rootMotionSpeed(info(MIN_ROOT_TRAVEL,0,1)),MIN_ROOT_TRAVEL);
 assert.equal(rootMotionSpeed(info(1,0,0)),0);
});
