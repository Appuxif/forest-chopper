import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {relative,resolve} from 'node:path';
import {AUDIO_FILES,AXE_VARIANTS,VOICE_VARIANTS,VOICE_CATEGORIES,chooseVoiceClip,SOUND_CONTROLS,DEFAULT_AUDIO,sanitizeAudioSettings,
 nightBlend,nearestLitFire,waterProximity,stepSurface,stepClip,stepVolumeKey} from '../src/sound-rules.js';
import {sanitizeSettings} from '../src/settings.js';
import {FALL_DURATION} from '../src/fallen-log-layout.js';

test('every registered sound ships in the repo and has independent settings',()=>{
 const keys=SOUND_CONTROLS.map(x=>x.key);
 assert.equal(new Set(keys).size,keys.length);
 for(const [id,file] of Object.entries(AUDIO_FILES))
  assert.ok(existsSync(new URL('../assets/audio/'+file,import.meta.url)),id+' must ship locally');
 const settings=sanitizeSettings(null);
 assert.deepEqual(settings.audio,DEFAULT_AUDIO);
 assert.deepEqual(sanitizeAudioSettings({master:0,axe:100,fire:31,owl:99}),
  {...DEFAULT_AUDIO,master:0,axe:100,fire:31});
 assert.deepEqual(sanitizeSettings({audio:{birds:0,crickets:87}}).audio,
  {...DEFAULT_AUDIO,birds:0,crickets:87});
});
test('audio layout matches registry, without loose or untracked runtime audio files',()=>{
 const root=new URL('../assets/audio/',import.meta.url);
 const walk=(dir,prefix='')=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const rel=prefix+entry.name;
  return entry.isDirectory()?walk(new URL(`${entry.name}/`,dir),`${rel}/`):
   /\.(mp3|wav)$/i.test(rel)?[rel]:[];
 });
 const actual=walk(root).sort();
 const registered=Object.values(AUDIO_FILES).sort();
 assert.deepEqual(actual,registered,'all bundled MP3/WAV files must be registered exactly once');
 assert.equal(registered.length,51);
 for(const file of registered){
  assert.ok(!file.startsWith('/')&&!file.split('/').includes('..'),`unsafe path: ${file}`);
  assert.ok(file.includes('/'),`audio not organized in a subfolder: ${file}`);
 }
 assert.equal(new Set(registered).size,registered.length);
});

test('night layer fades birds out, crickets in, and restores birds by morning',()=>{
 assert.equal(nightBlend(.1),0);
 assert.equal(nightBlend(.5),1);
 assert.equal(nightBlend(.9),0);
 assert.equal(nightBlend(.5,false),0);
 assert.ok(nightBlend(.3)>0 && nightBlend(.3)<1);
 assert.ok(nightBlend(.69)>0 && nightBlend(.69)<1);
});
test('fire requires a lit nearby source; water is localized at lake shores',()=>{
 const items=new Map([[1,{kind:'campfire',lit:false,x:0,z:0}],
  [2,{kind:'torch',lit:true,x:6,z:0}]]);
 assert.equal(nearestLitFire(items,0,0).item.kind,'torch');
 assert.equal(nearestLitFire(items,0,0).distance,6);
 items.get(2).lit=false;
 assert.equal(nearestLitFire(items,0,0),null);
 const terrain={waterDepthAt(x){return x>=6?.3:0;}};
 assert.equal(waterProximity(terrain,0,0),.4);
 assert.equal(waterProximity(terrain,-100,0),0);
});
test('footsteps choose wood, stone, water, mud and leaf surfaces',()=>{
 const world={collect:()=>[{kind:'log',shape:'capsule',axis:'x',y:.29,radius:.29,x:0,z:0}]};
 const ctx={px:0,pz:0,feetY:.58,terrain:{waterDepthAt:()=>0},collisionWorld:world};
 assert.equal(stepSurface(ctx),'wood');
 ctx.collisionWorld={collect:()=>[{kind:'rock',shape:'cylinder',x:0,z:0,y:.5,hy:.5,radius:1}]};
 ctx.feetY=1;
 assert.equal(stepSurface(ctx),'stone');
 ctx.collisionWorld={collect:()=>[]};ctx.feetY=0;
 assert.equal(stepSurface(ctx),'leaves');
 ctx.terrain={waterDepthAt(x){return x===3?.5:0;}};
 assert.equal(stepSurface(ctx),'mud');
 ctx.terrain={waterDepthAt:()=>.5};
 assert.equal(stepSurface(ctx),'water');
 assert.equal(stepClip('leaves',0),'step_leaves_1');
 assert.equal(stepClip('leaves',1),'step_leaves_2');
 assert.equal(stepClip('leaves',3),'step_leaves_2');
 assert.ok(!('step_grass_cozy' in AUDIO_FILES));
 assert.ok(!('axe_hit_2' in AUDIO_FILES));
 assert.ok(!('axe_hit_1' in AUDIO_FILES));
 assert.ok(!('axe_hoe_1' in AUDIO_FILES));
 assert.ok(!('owl' in AUDIO_FILES));
 assert.ok(!SOUND_CONTROLS.some(s=>s.key==='owl'));
 assert.equal(AXE_VARIANTS.length,7);
 for(const name of AXE_VARIANTS)assert.ok(name in AUDIO_FILES);
 assert.ok('hurt_female_3' in AUDIO_FILES);
 assert.ok(!('hurt_female_1' in AUDIO_FILES));
 assert.ok(!('hurt_female_24' in AUDIO_FILES));
 assert.equal(DEFAULT_AUDIO.jumpMale,58);
 assert.equal(DEFAULT_AUDIO.jumpFemale,58);
 assert.equal(DEFAULT_AUDIO.drop,30);
 assert.equal(AUDIO_FILES.drop,'inventory/drop.mp3');
 assert.ok(SOUND_CONTROLS.some(s=>s.key==='drop'));
 assert.equal(DEFAULT_AUDIO.fire,40);
 assert.equal(DEFAULT_AUDIO.water,40);
 assert.equal(DEFAULT_AUDIO.hurtFemale,78);
 assert.equal(DEFAULT_AUDIO.deathFemale,76);
 assert.equal(stepVolumeKey('mud'),'footstepsMud');
});

test('all requested voice variants exist and can be selected at either random boundary',()=>{
 assert.equal(VOICE_VARIANTS.hurtMale.length,7);
 assert.deepEqual(VOICE_VARIANTS.hurtFemale,['hurt_female_3','hurt_female_4','hurt_female_5','hurt_female_20']);
 assert.deepEqual(VOICE_VARIANTS.jumpFemale,[24,25,26,27,28].map(n=>`jump_female_${n}`));
 assert.deepEqual(VOICE_VARIANTS.jumpMale,['jump_male_1','jump_male_2']);
 assert.equal(VOICE_VARIANTS.deathMale.length,1);
 assert.equal(VOICE_VARIANTS.deathFemale.length,1);
 for(const [kind,set] of Object.entries(VOICE_VARIANTS)){
  for(const name of set){
   assert.equal(VOICE_CATEGORIES[name],kind);
   assert.ok(name in AUDIO_FILES);
  }
 }
 assert.equal(chooseVoiceClip('female','hurt',0),'hurt_female_3');
 assert.equal(chooseVoiceClip('female','hurt',.999999),'hurt_female_20');
 assert.equal(chooseVoiceClip('female','jump',0),'jump_female_24');
 assert.equal(chooseVoiceClip('female','jump',.999999),'jump_female_28');
 assert.equal(chooseVoiceClip('male','jump',0),'jump_male_1');
 assert.equal(chooseVoiceClip('male','jump',.999999),'jump_male_2');
 assert.equal(chooseVoiceClip('male','hurt',.999999),'hurt_male_7');
 assert.equal(chooseVoiceClip('male','death',.9),'death_male_1');
 assert.equal(chooseVoiceClip('female','death',.9),'death_female_1');
});

test('automatic female clips retain numbered timecodes for review and male death uses first take',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../assets/audio/metadata/VOICE_CUTS.json',import.meta.url)));
 const expected={hurt_male:7,hurt_female:4,jump_male:2,jump_female:5,death_male:1,death_female:1};
 for(const [group,count] of Object.entries(expected)){
  const clips=manifest.clips[group];
  assert.equal(clips.length,count);
  for(const [i,clip] of clips.entries()){
   const [type,gender]=group.split('_');
   const prefix=`${type}_${gender}_`;
   const sourceIndex=clip.source_take??i+1;
   assert.equal(clip.file,`voices/${gender}/${type}/${prefix}${sourceIndex}.mp3`);
   assert.ok(clip.duration>0,'never include silent zero-length segments');
   assert.ok(clip.end>clip.start);
   assert.ok(existsSync(new URL('../assets/audio/'+clip.file,import.meta.url)));
  }
 }
 assert.equal(manifest.clips.death_male[0].original,'15.wav');
 assert.equal(manifest.clips.hurt_male[0].original,'8.wav');
 assert.equal(manifest.clips.jump_male[0].original,'JumpSoundsMan/jumppp11.ogg');
 assert.equal(manifest.clips.jump_male[1].original,'JumpSoundsMan/jumppp22.ogg');
 assert.deepEqual(manifest.clips.hurt_female.map(c=>c.source_take),[3,4,5,20]);
 assert.deepEqual(manifest.clips.jump_female.map(c=>c.source_take),[24,25,26,27,28]);
});

test('selected choppingtree cutlist contains 10–15s at 1.3x tree fall and seven transient-aligned 16–25s hits',()=>{
 const cuts=JSON.parse(readFileSync(new URL('../assets/audio/metadata/CHOP_CUTS.json',import.meta.url)));
 assert.equal(cuts.source,'https://opengameart.org/sites/default/files/choppingtree.ogg');
 assert.equal(cuts.license,'CC BY 3.0');
 assert.deepEqual(cuts.cuts['chopping/tree_fall.mp3'],{start:10,end:15,speed:1.3,playback_duration:3.846154});
 assert.ok(Math.abs(cuts.cuts['chopping/tree_fall.mp3'].playback_duration-FALL_DURATION)<.00001,
   'tree animation duration must match the audio cut');
 assert.equal(Object.keys(cuts.cuts).length,8);
 for(let i=1;i<=7;i++){
  const name=`chopping/axe_chop_${i}.mp3`;
  const {start,end,peak}=cuts.cuts[name];
  assert.ok(start>=18&&end<=25&&end>start,name);
  assert.ok(peak>start+.045&&peak<start+.1,`impact must be near start of clip: ${name}`);
  assert.ok(end-start>=.4&&end-start<=.52,`full hit with tail, no long pauses: ${name}`);
  assert.ok(existsSync(new URL('../assets/audio/'+name,import.meta.url)));
 }
 assert.ok(!existsSync(new URL('../assets/audio/owl.mp3',import.meta.url)));
 assert.ok(!existsSync(new URL('../assets/audio/step_grass_cozy.mp3',import.meta.url)));
 for(const name of ['axe_hit_1.mp3','axe_hoe_1.mp3','axe_hoe_2.mp3'])
  assert.ok(!existsSync(new URL('../assets/audio/'+name,import.meta.url)),name);
});

test('seven approved hen WAVs are valid local PCM with preserved selection metadata',()=>{
 const metadata=JSON.parse(readFileSync(new URL('../assets/audio/metadata/HEN_VOICES.json',import.meta.url)));
 assert.equal(metadata.clips.length,7);
 for(const clip of metadata.clips){
  assert.equal(AUDIO_FILES[clip.id],clip.file);
  const data=readFileSync(new URL('../assets/audio/'+clip.file,import.meta.url));
  assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.toString('ascii',8,12),'WAVE');
  assert.equal(data.readUInt16LE(20),1);assert.equal(data.readUInt16LE(22),1);assert.equal(data.readUInt32LE(24),48000);assert.equal(data.readUInt16LE(34),16);
  assert.ok(clip.duration>.05&&clip.duration<1);assert.equal(clip.frames,Math.round(clip.duration*clip.sample_rate));
 }
 assert.equal(DEFAULT_AUDIO.henDeath,100);assert.equal(DEFAULT_AUDIO.henAlarm,100);assert.equal(DEFAULT_AUDIO.henClucks,100);
});
