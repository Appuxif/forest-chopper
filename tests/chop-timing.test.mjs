import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 CHOP_CONTACT_FRAME,CHOP_SOURCE_FPS,CHOP_CONTACT_CLIP_TIME,
 chopContactClipTime,chopContactReached,
} from '../src/chop-timing.js';

test('one 30 FPS, frame-25 axe contact for all three models',()=>{
 assert.equal(CHOP_CONTACT_FRAME,25);
 assert.equal(CHOP_SOURCE_FPS,30);
 assert.equal(CHOP_CONTACT_CLIP_TIME,25/30);
 for(const model of ['legacy','male','female']){
  assert.equal(chopContactClipTime(model),25/30);
  assert.equal(chopContactReached({time:17/24},0,5000,1.6,model),false);
  assert.equal(chopContactReached({time:25/30-0.0001},0,5000,1.6,model),false);
  assert.equal(chopContactReached({time:25/30},0,5000,1.6,model),true);
 }
});

test('fallback contact threshold respects actual axe playback speed',()=>{
 const start=1000;
 for(const model of ['legacy','male','female']){
  assert.equal(chopContactReached(null,start,start+520,1.6,model),false);
  assert.equal(chopContactReached(null,start,start+521,1.6,model),true);
  assert.equal(chopContactReached(null,start,start+833,1,model),false);
  assert.equal(chopContactReached(null,start,start+834,1,model),true);
  assert.equal(chopContactReached(null,start,start+347,2.4,model),false);
  assert.equal(chopContactReached(null,start,start+348,2.4,model),true);
 }
});

test('all three exported bodies contain Chop contact at exact same GLB sample time',()=>{
 for(const model of ['legacy','male','female']){
  const bytes=readFileSync(new URL('../characters/humanoid/game/body_'+model+'.glb',import.meta.url));
  const jsonLength=bytes.readUInt32LE(12);
  const gltf=JSON.parse(bytes.toString('utf8',20,20+jsonLength));
  const chunkStart=20+jsonLength+8;
  const chop=gltf.animations.find(clip=>clip.name==='Chop');
  assert.ok(chop,model+' must contain its own Chop animation');
  const sampler=chop.samplers.find(s=>gltf.accessors[s.input].count>=CHOP_CONTACT_FRAME);
  assert.ok(sampler,model+' Chop must have frame-by-frame keys');
  const accessor=gltf.accessors[sampler.input];
  const view=gltf.bufferViews[accessor.bufferView];
  const frameOffset=chunkStart+(view.byteOffset??0)+(accessor.byteOffset??0)
    +(CHOP_CONTACT_FRAME-1)*(view.byteStride??4);
  assert.ok(Math.abs(bytes.readFloatLE(frameOffset)-CHOP_CONTACT_CLIP_TIME)<1e-6,
    model+' 25th exported sample must equal the contact timestamp');
 }
});
