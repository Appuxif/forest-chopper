import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeSettings} from '../src/settings.js';

test('settings defaults and rejects invalid or corrupted saved values',()=>{
  assert.deepEqual(sanitizeSettings(null), {mouseSensitivity:1,showFps:false});
  assert.deepEqual(sanitizeSettings([]), {mouseSensitivity:1,showFps:false});
  assert.deepEqual(sanitizeSettings({mouseSensitivity:999,showFps:'true'}), {mouseSensitivity:1,showFps:false});
  assert.deepEqual(sanitizeSettings({mouseSensitivity:0,showFps:true}), {mouseSensitivity:1,showFps:true});
  assert.deepEqual(sanitizeSettings({mouseSensitivity:'NaN',showFps:1}), {mouseSensitivity:1,showFps:false});
  assert.deepEqual(sanitizeSettings({mouseSensitivity:'1.24',showFps:true}), {mouseSensitivity:1.2,showFps:true});
});
test('sensitivity boundaries are inclusive and persistence stays independent of world state',()=>{
  assert.equal(sanitizeSettings({mouseSensitivity:.4}).mouseSensitivity,.4);
  assert.equal(sanitizeSettings({mouseSensitivity:2.5}).mouseSensitivity,2.5);
  assert.equal(sanitizeSettings({mouseSensitivity:2.6}).mouseSensitivity,1);
  assert.deepEqual(Object.keys(sanitizeSettings({seed:123,logs:[1]})),['mouseSensitivity','showFps']);
});
