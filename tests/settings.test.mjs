import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeSettings,createSettings} from '../src/settings.js';

test('settings defaults and rejects invalid or corrupted saved values',()=>{
  assert.deepEqual(sanitizeSettings(null), {mouseSensitivity:1,showFps:false,windEnabled:true,fov:75,dayCycleEnabled:false,autoSprint:false,quality:'balanced'});
  assert.deepEqual(sanitizeSettings([]), {mouseSensitivity:1,showFps:false,windEnabled:true,fov:75,dayCycleEnabled:false,autoSprint:false,quality:'balanced'});
  assert.deepEqual(sanitizeSettings({mouseSensitivity:999,showFps:'true'}), {mouseSensitivity:1,showFps:false,windEnabled:true,fov:75,dayCycleEnabled:false,autoSprint:false,quality:'balanced'});
  assert.deepEqual(sanitizeSettings({mouseSensitivity:0,showFps:true}), {mouseSensitivity:1,showFps:true,windEnabled:true,fov:75,dayCycleEnabled:false,autoSprint:false,quality:'balanced'});
  assert.deepEqual(sanitizeSettings({mouseSensitivity:'NaN',showFps:1}), {mouseSensitivity:1,showFps:false,windEnabled:true,fov:75,dayCycleEnabled:false,autoSprint:false,quality:'balanced'});
  assert.deepEqual(sanitizeSettings({mouseSensitivity:'1.24',showFps:true}), {mouseSensitivity:1.2,showFps:true,windEnabled:true,fov:75,dayCycleEnabled:false,autoSprint:false,quality:'balanced'});
});
test('sensitivity boundaries are inclusive and persistence stays independent of world state',()=>{
  assert.equal(sanitizeSettings({mouseSensitivity:.4}).mouseSensitivity,.4);
  assert.equal(sanitizeSettings({mouseSensitivity:2.5}).mouseSensitivity,2.5);
  assert.equal(sanitizeSettings({mouseSensitivity:2.6}).mouseSensitivity,1);
  assert.equal(sanitizeSettings({windEnabled:false}).windEnabled,false);
  assert.equal(sanitizeSettings({windEnabled:0}).windEnabled,true);
  assert.equal(sanitizeSettings({dayCycleEnabled:true}).dayCycleEnabled,true);
  assert.equal(sanitizeSettings({dayCycleEnabled:'true'}).dayCycleEnabled,false);
  assert.equal(sanitizeSettings({autoSprint:true}).autoSprint,true);
  assert.equal(sanitizeSettings({autoSprint:'true'}).autoSprint,false);
  assert.equal(sanitizeSettings({fov:65}).fov,65);
  assert.equal(sanitizeSettings({fov:95}).fov,95);
  assert.equal(sanitizeSettings({fov:62}).fov,75);
  assert.equal(sanitizeSettings({fov:1000}).fov,75);
  assert.equal(sanitizeSettings({fov:82}).fov,80);
  assert.deepEqual(Object.keys(sanitizeSettings({seed:123,logs:[1]})),['mouseSensitivity','showFps','windEnabled','dayCycleEnabled','autoSprint','quality','fov']);
});

test('FOV is restored, applied live and reset without affecting world saves',()=>{
  const elements=new Map();
  function element(id){
    if(!elements.has(id))elements.set(id,{value:'',checked:false,textContent:'',style:{},
      setAttribute(){},querySelector:element});
    return elements.get(id);
  }
  const doc={
    createElement:tag=>({tag,hidden:false,setAttribute(){},querySelector:element}),
    head:{append(){}},body:{append(){}},
  };
  const updates=[],writes=[];
  const storage={
    getItem(){return JSON.stringify({mouseSensitivity:1,showFps:false,windEnabled:true,fov:85})},
    setItem(k,v){writes.push([k,JSON.parse(v)])},
  };
  const settings=createSettings(doc,storage,fov=>updates.push(fov));
  assert.equal(settings.fov,85);
  assert.deepEqual(updates,[85]);
  const input=element('#fc-fov');
  assert.equal(input.value,'85');
  input.value='95';
  input.oninput();
  assert.equal(settings.fov,95);
  assert.deepEqual(updates,[85,95]);
  assert.equal(element('#fc-fov-value').textContent,'95');
  assert.equal(writes.at(-1)[1].fov,95);
  assert.equal(writes.at(-1)[1].seed,undefined);
  element('#fc-reset-settings').onclick();
  assert.equal(settings.fov,75);
  assert.deepEqual(updates,[85,95,75]);
  assert.equal(writes.at(-1)[1].fov,75);
  const day=element('#fc-day-cycle');
  day.checked=true;
  day.onchange();
  assert.equal(settings.dayCycleEnabled,true);
  assert.equal(writes.at(-1)[1].dayCycleEnabled,true);
  element('#fc-reset-settings').onclick();
  assert.equal(settings.dayCycleEnabled,false);
  const sprint=element('#fc-auto-sprint');
  sprint.checked=true;
  sprint.onchange();
  assert.equal(settings.autoSprint,true);
  assert.equal(writes.at(-1)[1].autoSprint,true);
  element('#fc-reset-settings').onclick();
  assert.equal(settings.autoSprint,false);
});
