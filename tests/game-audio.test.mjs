import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameAudio} from '../src/game-audio.js';
import {DEFAULT_AUDIO} from '../src/sound-rules.js';

function fixture(){
 const listeners=new Map(),sources=[],gains=[];
 const doc={addEventListener(type,fn){listeners.set(type,fn)},removeEventListener(type){listeners.delete(type)}};
 class FakeContext{
  constructor(){this.destination={};this.currentTime=1;this.state='running';}
  createGain(){const node={gain:{value:1,setTargetAtTime(v){this.value=v}},connect(){},disconnect(){}};gains.push(node);return node;}
  createBufferSource(){const source={loop:false,playbackRate:{value:1},connect(){},disconnect(){},start(){this.started=true},stop(){this.stopped=true}};sources.push(source);return source;}
  async decodeAudioData(){return {duration:1};}
  async close(){this.state='closed';}
 }
 const ctx={px:0,pz:0,onGround:true,sprinting:false,ragdoll:{active:false},
  settings:{audio:{...DEFAULT_AUDIO},dayCycleEnabled:true},
  dayCycle:{phaseAt:()=>.1},
  campStructures:{items:new Map([[1,{id:1,kind:'campfire',lit:true,x:1,z:0}]])},
  terrain:{waterDepthAt(){return 0}},collisionWorld:{collect(){return []}},
  deathSystem:{active:false}};
 const audio=createGameAudio(ctx,{doc,AudioContextClass:FakeContext,
  fetchAudio:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)}),random:()=>.99});
 return {ctx,audio,sources,gains,listeners};
}
test('WebAudio waits for user gesture, loads local files and creates looping ambience',async()=>{
 const f=fixture();
 assert.equal(f.sources.length,0);
 assert.equal(f.audio.unlocked,false);
 assert.ok(f.listeners.has('pointerdown'));
 f.listeners.get('pointerdown')();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.audio.unlocked,true);
 assert.equal(f.audio.activeLoops,5);
 assert.ok(f.audio.loaded>=20);
 f.audio.tick(1000);
 assert.equal(f.sources.filter(s=>s.loop&&s.started).length,5);
 assert.ok(f.gains.some(g=>g.gain.value>0));
 f.audio.dispose();
 assert.ok(f.sources.filter(s=>s.loop).every(s=>s.stopped));
 assert.equal(f.listeners.size,0);
});
test('live slider levels affect master and individual effects; zero mutes without reload',async()=>{
 const f=fixture();f.audio.unlock();
 await new Promise(resolve=>setImmediate(resolve));
 const before=f.sources.length;
 assert.equal(f.audio.effect('axe'),true);
 assert.equal(f.sources.length,before+1);
 f.ctx.settings.audio.axe=0;
 assert.equal(f.audio.effect('axe'),false);
 f.ctx.settings.audio.axe=100;
 assert.equal(f.audio.effect('axe'),true);
 f.ctx.settings.audio.master=0;
 f.audio.tick(1000);
 assert.equal(f.gains[0].gain.value,0);
 assert.equal(f.audio.hurt('female'),false,'master mute must suppress voices');
 f.ctx.settings.audio.master=70;
 assert.equal(f.audio.hurt('female'),true,'new female takes are enabled');
 assert.equal(f.audio.preview('hurtMale'),undefined);
 assert.equal(f.audio.effect('chat'),true);
 f.audio.dispose();
});
test('footsteps use traveled distance and stop during ragdoll; ambience changes with night',async()=>{
 const f=fixture();f.audio.unlock();await new Promise(resolve=>setImmediate(resolve));
 f.audio.tick(1000);
 const before=f.sources.length;
 f.ctx.pz=.32;f.audio.tick(1200);
 f.ctx.pz=.64;f.audio.tick(1400);
 assert.ok(f.sources.length>before,'step plays after moving beyond stride');
 const after=f.sources.length;
 f.ctx.ragdoll.active=true;
 f.ctx.pz=.95;f.audio.tick(1600);
 assert.equal(f.sources.length,after);
 f.ctx.dayCycle.phaseAt=()=>.5;f.audio.tick(1800);
 assert.equal(f.audio.activeLoops,5);
 f.audio.dispose();
});

test('tree fall sound plays once at fixed speed, matching animation duration',async()=>{
 const f=fixture();f.audio.unlock();await new Promise(resolve=>setImmediate(resolve));
 const old=f.sources.length;
 assert.equal(f.audio.effect('treeFall'),true);
 assert.equal(f.sources.length,old+1);
 assert.equal(f.sources.at(-1).playbackRate.value,1,
   'random playback speed would desynchronize tree animation and sound');
 f.audio.dispose();
});

test('audition plays the full multi-second tree-fall and replaces previous preview',async()=>{
 const f=fixture();f.audio.unlock();await new Promise(resolve=>setImmediate(resolve));
 const originalCount=f.sources.length;
 f.audio.preview('treeFall');
 const first=f.sources.at(-1);
 assert.equal(f.sources.length,originalCount+1);
 assert.ok(first.started);
 assert.equal(first.stopped,true);
 f.audio.preview('water');
 const second=f.sources.at(-1);
 assert.notEqual(first,second);
 assert.ok(second.started);
 f.audio.dispose();
});

test('all voice sets can be played by category and single numbered take',async()=>{
 const f=fixture();f.audio.unlock();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.audio.hurt('male'),true);
 assert.equal(f.audio.hurt('female'),true);
 assert.equal(f.audio.death('male'),true);
 assert.equal(f.audio.death('female'),true);
 assert.equal(f.audio.previewClip('hurt_female_20'),true);
 assert.equal(f.audio.previewClip('hurt_female_37'),false);
 assert.equal(f.audio.previewClip('jump_female_28'),true);
 assert.equal(f.audio.previewClip('jump_male_2'),true);
 assert.equal(f.audio.previewClip('hurt_male_7'),true);
 assert.equal(f.audio.previewClip('death_male_1'),true);
 assert.equal(f.audio.previewClip('death_female_1'),true);
 assert.equal(f.audio.previewClip('axe_chop_7'),true);
 assert.equal(f.audio.previewClip('owl'),false);
 assert.equal(f.audio.previewClip('does_not_exist'),false);
 const after=f.sources.length;
 f.ctx.deathSystem.active=true;
 assert.equal(f.audio.hurt('male'),false,'normal hurt cannot overlap death');
 assert.equal(f.sources.length,after);
 f.audio.dispose();
});

test('axe uses only seven transient-aligned choppingtree hits and never triggers owl ambience',async()=>{
 const f=fixture();f.audio.unlock();await new Promise(resolve=>setImmediate(resolve));
 for(let i=0;i<15;i++)assert.equal(f.audio.effect('axe'),true);
 assert.equal(f.audio.previewClip('axe_chop_1'),true);
 assert.equal(f.audio.previewClip('axe_chop_7'),true);
 assert.equal(f.audio.preview('owl'),undefined);
 f.ctx.dayCycle.phaseAt=()=>.5;
 f.audio.tick(1000);f.audio.tick(55000);
 assert.equal(f.audio.activeLoops,5,'night ambience is crickets only');
 f.audio.dispose();
});

test('reversed pickup has an independent drop volume and preview',async()=>{
 const f=fixture();f.audio.unlock();await new Promise(resolve=>setImmediate(resolve));
 const before=f.sources.length;
 assert.equal(f.audio.effect('drop'),true);
 assert.equal(f.sources.length,before+1);
 f.ctx.settings.audio.drop=0;
 assert.equal(f.audio.effect('drop'),false);
 assert.equal(f.audio.effect('pickup'),true,'pickup slider remains independent');
 f.ctx.settings.audio.drop=42;
 const previous=f.sources.length;
 f.audio.preview('drop');
 assert.equal(f.sources.length,previous+1);
 f.audio.dispose();
});

test('jump vocal selection uses gender and independent volume, without using hurt clips',async()=>{
 const f=fixture();f.audio.unlock();await new Promise(resolve=>setImmediate(resolve));
 const old=f.sources.length;
 assert.equal(f.audio.jump('male'),true);
 assert.equal(f.sources.length,old+1);
 assert.equal(f.audio.jump('female'),true);
 assert.equal(f.sources.length,old+2);
 f.ctx.settings.audio.jumpFemale=0;
 assert.equal(f.audio.jump('female'),false);
 assert.equal(f.audio.hurt('female'),true,'hurt remains independent from jump mute');
 f.ctx.settings.audio.jumpMale=0;
 assert.equal(f.audio.jump('male'),false);
 f.ctx.settings.audio.jumpFemale=100;
 assert.equal(f.audio.preview('jumpFemale'),undefined);
 assert.equal(f.audio.previewClip('jump_female_24'),true);
 f.ctx.deathSystem.active=true;
 assert.equal(f.audio.jump('female'),false,'dead characters cannot play jump vocals');
 f.audio.dispose();
});
