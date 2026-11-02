import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {REFERENCE_MOTION_NAMES,REFERENCE_MOTION_GROUPS,shouldLoopPreviewClip,referenceClipInfo} from '../characters/humanoid/reference-motion-ui.js';

const glb=readFileSync(new URL('../characters/humanoid/game/body_male.glb',import.meta.url));
function getGltfJson(buffer){
 assert.equal(buffer.toString('ascii',0,4),'glTF');
 assert.equal(buffer.readUInt32LE(4),2);
 assert.equal(buffer.readUInt32LE(8),buffer.length);
 assert.equal(buffer.readUInt32LE(16),0x4E4F534A);
 const length=buffer.readUInt32LE(12);
 return JSON.parse(buffer.toString('utf8',20,20+length));
}

test('workbench-only REF clips are not exported in the self-contained runtime GLB',()=>{
 const gltf=getGltfJson(glb);
 const names=gltf.animations.map(clip=>clip.name);
 assert.equal(names.length,13);
 assert.equal(new Set(names).size,13);
 assert.ok(names.every(name=>!name.startsWith('REF_')));
 assert.ok(gltf.meshes?.length>0);
 assert.equal(gltf.skins?.length,1);
 assert.equal(gltf.skins[0].joints.length,53);
 assert.ok(gltf.nodes.some(node=>node.name==='Root'));
 for(const clip of gltf.animations){
  assert.ok(clip.channels.length>0,`Clip ${clip.name} has channels`);
  for(const channel of clip.channels){
   assert.ok(['rotation','translation','scale'].includes(channel.target.path));
   assert.ok(gltf.nodes[channel.target.node].name);
  }
 }
});

test('UI groups cover every REF action once and mark cycling vs one-shot clips',()=>{
 assert.equal(REFERENCE_MOTION_GROUPS.length,6);
 assert.equal(new Set(REFERENCE_MOTION_NAMES).size,19);
 assert.ok(shouldLoopPreviewClip('REF_KayKit_Run_A'));
 assert.ok(shouldLoopPreviewClip('REF_KayKit_Chopping_Loop'));
 assert.ok(!shouldLoopPreviewClip('REF_KayKit_Attack_Axe1H'));
 assert.ok(!shouldLoopPreviewClip('REF_Experimental_Eat_HandToMouth'));
 assert.ok(shouldLoopPreviewClip('walk'));
 assert.ok(!shouldLoopPreviewClip('jump'));
 assert.match(referenceClipInfo('REF_Experimental_Eat_HandToMouth'),/Эксперимент/);
});

test('editor plays clip Actions on the same visible humanoid and can repeat one-shot animations',()=>{
 const page=readFileSync(new URL('../characters/humanoid/preview-lite.html',import.meta.url),'utf8');
 assert.doesNotMatch(page,/reference-motion-preview\.glb/);
 assert.match(page,/fillAnimationChoices\(\)/);
 assert.match(page,/actor\.play\(name,\{loop:shouldLoopPreviewClip\(name\)/);
 assert.match(page,/id="replayAnimation"/);
 assert.doesNotMatch(page,/scene\.add\(gltf\.scene\)/);
});
