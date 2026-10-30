import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldSprint} from '../src/movement-preferences.js';
import {sanitizeSettings} from '../src/settings.js';

test('keyboard Shift sprint still works with preference disabled',()=>{
  assert.equal(shouldSprint({},false,true),false);
  assert.equal(shouldSprint({ShiftLeft:true},false,true),true);
  assert.equal(shouldSprint({ShiftRight:true},false,true),true);
  assert.equal(shouldSprint({ShiftRight:false,ShiftLeft:false},false,false),false);
});
test('opt-in auto sprint runs only while actively walking, including touch joystick',()=>{
  assert.equal(shouldSprint({},true,true),true);
  assert.equal(shouldSprint({},true,false),false);
  assert.equal(shouldSprint({KeyW:true},true,true),true);
  assert.equal(shouldSprint({ShiftLeft:true},true,false),true);
  assert.equal(shouldSprint({},false,true),false,'turning preference off immediately returns to walking');
  assert.equal(sanitizeSettings({}).autoSprint,false,'existing saves should not enable sprint');
  assert.equal(sanitizeSettings({autoSprint:true}).autoSprint,true);
  assert.equal(sanitizeSettings({autoSprint:'true'}).autoSprint,false);
});
