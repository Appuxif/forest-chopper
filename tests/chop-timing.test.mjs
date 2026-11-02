import test from 'node:test';
import assert from 'node:assert/strict';
import {CHOP_CONTACT_FRAME,CHOP_SOURCE_FPS,CHOP_CONTACT_CLIP_TIME,chopContactReached} from '../src/chop-timing.js';

test('Blender frame 18 in 24fps Chop2 is keyframe 17/24s from frame 1',()=>{
 assert.equal(CHOP_CONTACT_FRAME,18);
 assert.equal(CHOP_SOURCE_FPS,24);
 assert.equal(CHOP_CONTACT_CLIP_TIME,17/24);
 assert.equal(chopContactReached({time:0.70},0,3000,1.6),false);
 assert.equal(chopContactReached({time:CHOP_CONTACT_CLIP_TIME},0,0,1.6),true);
 assert.equal(chopContactReached({time:1.5},0,0,1.6),true);
});
test('without animation fallback crosses contact point once based on correct playback rate',()=>{
 const start=1000;
 assert.equal(chopContactReached(null,start,start+440,1.6),false);
 assert.equal(chopContactReached(null,start,start+444,1.6),true);
 assert.equal(chopContactReached(null,start,start+300,2.4),true);
 assert.equal(chopContactReached(null,start,start+300,1),false);
});
