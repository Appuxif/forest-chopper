import test from 'node:test';
import assert from 'node:assert/strict';
import {applyQuality,pixelRatioForQuality} from '../src/quality.js';
import {sanitizeSettings} from '../src/settings.js';
test('render presets are validated and scale GPU pixels only',()=>{
  assert.equal(sanitizeSettings({}).quality,'high');
  assert.equal(sanitizeSettings({quality:'low'}).quality,'low');
  assert.equal(sanitizeSettings({quality:'high'}).quality,'high');
  assert.equal(sanitizeSettings({quality:'ultra'}).quality,'high');
  assert.equal(pixelRatioForQuality('low',3),.8);
  assert.equal(pixelRatioForQuality('balanced',3),1.25);
  assert.equal(pixelRatioForQuality('high',3),1.6);
  assert.equal(pixelRatioForQuality('high',1),1);
  assert.equal(pixelRatioForQuality('invalid',NaN),1);
});
test('presets update pixel ratio and viewport without rebuilding or mutating world state',()=>{
  const calls=[];
  const renderer={setPixelRatio(n){calls.push(['ratio',n])},setSize(w,h){calls.push(['size',w,h])}};
  const state={seed:12,trees:5,wood:3};
  assert.equal(applyQuality(renderer,'low',3,390,844),.8);
  assert.equal(applyQuality(renderer,'high',3,1366,768),1.6);
  assert.deepEqual(calls,[['ratio',.8],['size',390,844],['ratio',1.6],['size',1366,768]]);
  assert.deepEqual(state,{seed:12,trees:5,wood:3});
});
