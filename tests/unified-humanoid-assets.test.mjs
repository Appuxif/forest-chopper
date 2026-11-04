import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

function glb(name){
 const data=readFileSync(new URL('../characters/humanoid/game/'+name+'.glb',import.meta.url));
 assert.equal(data.toString('utf8',0,4),'glTF');
 const size=data.readUInt32LE(12);
 return JSON.parse(data.toString('utf8',20,20+size));
}

test('two independent runtime gender GLBs each contain 14 production Actions, one rig and face presets',()=>{
 const male=glb('body_male'),female=glb('body_female');
 for(const asset of [male,female]){
  assert.equal(asset.skins.length,1);
  assert.equal(asset.skins[0].joints.length,53);
  const clips=new Map(asset.animations.map(clip=>[clip.name,clip]));
  assert.ok(clips.has('run'));
  assert.ok(clips.has('run_backward'));
  assert.ok(clips.has('walk'));
  assert.ok(clips.has('walk_back'),'authored backward root motion replaces old stock clip');
  assert.ok(clips.has('Chop'));
  assert.ok(clips.has('idle'));
  assert.equal(asset.animations.length,14);
  assert.equal(clips.size,14);
  assert.equal([...clips.keys()].filter(name=>name.startsWith('REF_')).length,0);
  assert.ok(asset.meshes.every(mesh=>mesh.extras?.targetNames?.join(',')==='angular,soft'));
  assert.ok(asset.meshes.every(mesh=>mesh.primitives.every(primitive=>primitive.targets?.length===2)));
  const run=clips.get('run');
  assert.equal(run.channels.length,159);
  const root=run.channels.find(c=>asset.nodes[c.target.node].name==='Root'&&c.target.path==='translation');
  assert.ok(root,'authored root motion stays in the same model animation');
  const input=asset.accessors[run.samplers[root.sampler].input];
  assert.equal(input.count,21);
  assert.ok(input.max[0]>0.65 && input.max[0]<0.72);
 }
});

test('only one visible character actor drives gameplay and Root Motion',()=>{
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const animation=readFileSync(new URL('../src/animations.js',import.meta.url),'utf8');
 const player=readFileSync(new URL('../src/player.js',import.meta.url),'utf8');
 assert.match(main,/ownAvatar=await createAvatar\(/);
 assert.doesNotMatch(main,/createHumanoidPlayerModel|humanoidPreview|createLumberjack/);
 assert.match(animation,/rootMotion=extractRootMotion\(THREE,clips\)/);
 assert.match(animation,/mixer=human\.mixer/);
 assert.match(player,/ctx\.tickActor\(ctx\.ownAvatar/);
 assert.doesNotMatch(player,/humanoidPreview/);
});
