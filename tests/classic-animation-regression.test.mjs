import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  canTransitionUpperBody,transitionLayer,CHOP_SPEED,runtimeClipName,
} from '../src/animations.js';

function readGLB(file){
 const data=readFileSync(new URL(file,import.meta.url));
 assert.equal(data.toString('ascii',0,4),'glTF');
 const size=data.readUInt32LE(12);
 return JSON.parse(data.toString('utf8',20,20+size));
}

test('classic saved selection is now the same 53-joint animation model',()=>{
 const standard=readGLB('../characters/humanoid/game/body_male.glb');
 const legacy=readGLB('../characters/humanoid/game/body_legacy.glb');
 assert.equal(standard.skins[0].joints.length,53);
 assert.equal(legacy.skins[0].joints.length,53);
 assert.equal(legacy.animations.length,14);
 assert.equal(new Set(legacy.animations.map(a=>a.name)).size,14);
 const old=readGLB('../lumberjack/lumberjack.glb');
 assert.equal(old.skins[0].joints.length,13,'historical source GLB remains untouched');
});

test('all three GLBs map to the exact same canonical 14 action names',()=>{
 const names=new Map();
 for(const model of ['legacy','male','female']){
  const data=readGLB('../characters/humanoid/game/body_'+model+'.glb');
  const mapped=data.animations.map(a=>runtimeClipName(model,a.name));
  assert.equal(mapped.length,14);
  assert.equal(new Set(mapped).size,14,'duplicate after renaming: '+model);
  names.set(model,mapped.sort());
 }
 assert.deepEqual(names.get('legacy'),names.get('male'));
 assert.deepEqual(names.get('female'),names.get('male'));
 for(const mandatory of ['Idle','Walk','WalkBackward','Run','RunBackward',
    'StrafeLeft','StrafeRight','Jump','Fall','Land','Chop2']){
  assert.ok(names.get('legacy').includes(mandatory),mandatory);
 }
});

test('same runtime action name mapping for all three model IDs',()=>{
 for(const model of ['legacy','male','female']){
  for(const [source,expected] of Object.entries({
   idle:'Idle',walk:'Walk',walk_back:'WalkBackward',
   walk_backward:'WalkBackward',run:'Run',run_backward:'RunBackward',
   strafe_left:'StrafeLeft',strafe_right:'StrafeRight',
   jump:'Jump',fall:'Fall',land:'Land',Chop:'Chop2',
  }))assert.equal(runtimeClipName(model,source),expected,model+' '+source);
  assert.equal(runtimeClipName(model,'Chop2'),'Chop2');
 }
});

function fakeAction(duration=46/30){
 return {
  time:0,scale:1,duration,playCount:0,
  getClip(){return {duration:this.duration};},
  getEffectiveTimeScale(){return this.scale;},
  setEffectiveTimeScale(value){this.scale=value;return this;},
  setEffectiveWeight(){return this;},
  reset(){this.time=0;return this;},
  fadeIn(){return this;},fadeOut(){return this;},
  play(){this.playCount++;return this;},
 };
}

test('upper and lower locomotion use the same playback rate for every body',()=>{
 for(const model of ['legacy','male','female']){
  const a={model,lower:{Run:fakeAction()},upper:{Run:fakeAction()},
   lowerState:'',upperState:'',rmTimes:{}};
  transitionLayer(null,a,'lower','Run',1.2);
  transitionLayer(null,a,'upper','Run',1.2);
  assert.equal(a.lower.Run.scale,1.2);
  assert.equal(a.upper.Run.scale,1.2);
  transitionLayer(null,a,'upper','Run',1.5);
  assert.equal(a.upper.Run.scale,1.5);
 }
});

test('all three axe swings use the same clock and contact rate',()=>{
 assert.equal(CHOP_SPEED,1.6);
 for(const model of ['legacy','male','female']){
  const actor={model,upperState:'Chop2',upper:{Chop2:fakeAction()},chopEnd:750};
  assert.equal(canTransitionUpperBody(actor,749),false);
  assert.equal(canTransitionUpperBody(actor,750),true);
  actor.upperState='Walk';
  assert.equal(canTransitionUpperBody(actor,0),true);
 }
});

test('movement, animation, and ragdoll source no longer branch on the legacy model',()=>{
 for(const file of ['../src/player.js','../src/animations.js','../src/ragdoll.js']){
  const source=readFileSync(new URL(file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/\.model\s*[!=]==?\s*['"]legacy['"]/,
   file+' still contains a legacy-model branch');
 }
 const animation=readFileSync(new URL('../src/animations.js',import.meta.url),'utf8');
 assert.doesNotMatch(animation,/lumberjack\/lumberjack\.glb/);
 assert.match(animation,/human\.attach\(profile\.socket,grip\.clone\(true\),/);
});


test('every character attaches the same cached axe GLB through handRight',()=>{
 const animation=readFileSync(new URL('../src/animations.js',import.meta.url),'utf8');
 const selection=readFileSync(new URL('../src/character-model-selection.js',import.meta.url),'utf8');
 const inventory=readFileSync(new URL('../src/inventory-ui.js',import.meta.url),'utf8');
 const multiplayer=readFileSync(new URL('../src/multiplayer.js',import.meta.url),'utf8');
 assert.match(selection,/export const SHARED_AXE_ASSET='characters\/humanoid\/game\/axe_shared\.glb/);
 assert.doesNotMatch(selection,/axe:'lumberjack\/|axe:'characters\/humanoid\/lite/);
 assert.match(animation,/const weaponAssetPromises=new Map\(\)/);
 assert.match(animation,/loader\.loadAsync\('\.\/'\+profile\.asset\)/);
 assert.match(animation,/const handle=human\.attach\(profile\.socket,grip\.clone\(true\),/);
 assert.match(animation,/CHARACTER_BODY_ASSETS\[model\]\[profile\.socket\]/);
 assert.match(animation,/setAxeEquipped\(equipped\)/);
 assert.match(animation,/return this\.setEquippedWeapon\(equipped\?DEFAULT_WEAPON_ID:null\)/);
 assert.match(inventory,/ctx\.ownAvatar\?\.setEquippedWeapon\?\.\(state\.equipped\(\)\?state\.selected\(\):null\)/);
 assert.match(multiplayer,/actor\.setAxeEquipped\(avatar\.axeEquipped\)/);
 assert.match(multiplayer,/avatar\.axeEquipped=d\.axe_equipped===true/);
 assert.match(multiplayer,/avatar\.actor\?\.setAxeEquipped\(avatar\.axeEquipped\)/);
 assert.doesNotMatch(multiplayer, /\/\^Axe \(blade\|handle\)/,
  'online inventory must no longer inspect old weapon mesh names');
});
