import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {
  CHARACTER_MODELS,CHARACTER_PROFILES,SHARED_AXE_ASSET,CHARACTER_MODEL_KEY,normalizeCharacterModel,
  readCharacterModel,saveCharacterModel
} from '../src/character-model-selection.js';

test('only classic, male and female are selectable',()=>{
  assert.deepEqual(CHARACTER_MODELS,['legacy','male','female']);
  for(const value of CHARACTER_MODELS)assert.equal(normalizeCharacterModel(value),value);
  for(const value of [null,undefined,'female-ish','custom','morph','',42,{},'__proto__']){
    assert.equal(normalizeCharacterModel(value),'legacy');
  }
});

test('model choice persists across menu reloads and is not bound to a world',()=>{
  const data=new Map();
  const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  assert.equal(readCharacterModel(storage),'legacy');
  assert.equal(saveCharacterModel(storage,'female'),'female');
  assert.equal(data.get(CHARACTER_MODEL_KEY),'female');
  assert.equal(readCharacterModel(storage),'female');
  assert.equal(saveCharacterModel(storage,'male'),'male');
  assert.equal(readCharacterModel(storage),'male');
  assert.equal(saveCharacterModel(storage,'invalid'),'legacy');
  assert.equal(readCharacterModel(storage),'legacy');
});
test('storage restrictions fall back safely',()=>{
  const storage={getItem(){throw Error('privacy')},setItem(){throw Error('privacy')}};
  assert.equal(readCharacterModel(storage),'legacy');
  assert.equal(saveCharacterModel(storage,'male'),'male');
});


test('one asset registry covers all menu models and their body/axe GLBs',()=>{
 assert.deepEqual(Object.keys(CHARACTER_PROFILES),CHARACTER_MODELS);
 for(const [name,profile] of Object.entries(CHARACTER_PROFILES)){
  assert.ok(Object.isFrozen(profile),'profile immutable: '+name);
  assert.match(profile.file,/^game\/body_(male|female|legacy)\.glb/);
  assert.equal(profile.file.split('?')[0],'game/body_'+name+'.glb');
  assert.ok(existsSync(new URL('../characters/humanoid/'+profile.file.split('?')[0],
    import.meta.url)),name+' game body asset missing');
  assert.equal(Object.hasOwn(profile,'axe'),false,
    name+' must not override the shared axe asset');
 }
 assert.equal(SHARED_AXE_ASSET.split('?')[0],
  'characters/humanoid/game/axe_shared.glb');
 assert.ok(existsSync(new URL('../'+SHARED_AXE_ASSET.split('?')[0],import.meta.url)),
  'shared axe GLB missing');
 assert.equal(CHARACTER_PROFILES.legacy.outfit,false);
 const classicGrip=CHARACTER_PROFILES.legacy.handRight;
 assert.ok(Object.isFrozen(classicGrip));
 assert.equal(classicGrip.position.length,3);
 assert.equal(classicGrip.quaternion.length,4);
 assert.ok(Math.abs(Math.hypot(...classicGrip.quaternion)-1)<1e-6,
   'socket correction quaternion must be normalized');
 assert.equal(CHARACTER_PROFILES.male.handRight,undefined,
   'male keeps its original unmodified socket');
 assert.equal(CHARACTER_PROFILES.female.handRight,undefined,
   'female keeps its original unmodified socket');
 assert.equal(CHARACTER_PROFILES.male.outfit,true);
 assert.equal(CHARACTER_PROFILES.female.outfit,true);
});
