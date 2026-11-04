import test from 'node:test';
import assert from 'node:assert/strict';
import {CHOP_CONTACT_FRAME,CHOP_SOURCE_FPS,CHOP_CONTACT_CLIP_TIME,
 HUMANOID_CHOP_CONTACT_FRAME,HUMANOID_CHOP_SOURCE_FPS,HUMANOID_CHOP_CONTACT_CLIP_TIME,
 chopContactClipTime,chopContactReached} from '../src/chop-timing.js';
import {readFileSync} from 'node:fs';

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

test('new male and female models use Blender frame 25 at 30 FPS, not legacy frame 18',()=>{
 assert.equal(HUMANOID_CHOP_CONTACT_FRAME,25);
 assert.equal(HUMANOID_CHOP_SOURCE_FPS,30);
 assert.equal(HUMANOID_CHOP_CONTACT_CLIP_TIME,25/30);
 assert.equal(chopContactClipTime(),17/24);
 assert.equal(chopContactClipTime('legacy'),17/24);
 for(const model of ['male','female']){
  assert.equal(chopContactClipTime(model),25/30);
  assert.equal(chopContactReached({time:17/24},0,5000,1.6,model),false);
  assert.equal(chopContactReached({time:25/30-.0001},0,5000,1.6,model),false);
  assert.equal(chopContactReached({time:25/30},0,5000,1.6,model),true);
  assert.equal(chopContactReached({time:1},0,5000,1.6,model),true);
 }
});

test('model-specific timing fallback tracks axe playback speed when action is absent',()=>{
 const start=1000;
 for(const model of ['male','female']){
  assert.equal(chopContactReached(null,start,start+520,1.6,model),false);
  assert.equal(chopContactReached(null,start,start+521,1.6,model),true);
  assert.equal(chopContactReached(null,start,start+833,1,model),false);
  assert.equal(chopContactReached(null,start,start+834,1,model),true);
  assert.equal(chopContactReached(null,start,start+347,2.4,model),false);
  assert.equal(chopContactReached(null,start,start+348,2.4,model),true);
 }
 assert.equal(chopContactReached(null,start,start+444,1.6,'legacy'),true,
  'classic frame-18 fallback remains unchanged');
});

test('both exported humanoid GLB Chop clips contain frame 25 at exactly 25/30s',()=>{
 for(const model of ['male','female']){
  const bytes=readFileSync(new URL(`../characters/humanoid/game/body_${model}.glb`,import.meta.url));
  const jsonLength=bytes.readUInt32LE(12);
  const gltf=JSON.parse(bytes.toString('utf8',20,20+jsonLength));
  const chunkStart=20+jsonLength+8;
  const chop=gltf.animations.find(clip=>clip.name==='Chop');
  assert.ok(chop, `${model} game GLB must contain Chop animation`);
  const sampler=chop.samplers.find(s=>gltf.accessors[s.input].count>=HUMANOID_CHOP_CONTACT_FRAME);
  assert.ok(sampler, `${model} must export frame-by-frame Chop keys`);
  const accessor=gltf.accessors[sampler.input];
  const view=gltf.bufferViews[accessor.bufferView];
  const frameOffset=chunkStart+(view.byteOffset??0)+(accessor.byteOffset??0)
    +(HUMANOID_CHOP_CONTACT_FRAME-1)*(view.byteStride??4);
  assert.ok(Math.abs(bytes.readFloatLE(frameOffset)-HUMANOID_CHOP_CONTACT_CLIP_TIME)<1e-6,
    `${model} GLB's 25th key must coincide with contact time`);
 }
});
