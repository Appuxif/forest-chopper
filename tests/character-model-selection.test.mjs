import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTER_MODELS,CHARACTER_MODEL_KEY,normalizeCharacterModel,
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
