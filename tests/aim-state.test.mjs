import test from 'node:test';
import assert from 'node:assert/strict';
import {aimState,updateCrosshair} from '../src/aim-state.js';
test('crosshair is neutral with no target and exposes accessible interaction state',()=>{
  assert.deepEqual(aimState(false,null),{kind:'idle',text:'+',label:'Прицел'});
  assert.equal(aimState(false,{userData:{hp:2,species:'birch'}}).kind,'tree');
  assert.match(aimState(false,{userData:{hp:2,species:'birch'}}).label,/берёзе/);
  assert.equal(aimState(false,{userData:{hp:0}}).kind,'idle');
  assert.equal(aimState(true,null,'').kind,'build');
  assert.equal(aimState(true,null,'Недостаточно древесины').kind,'blocked');
});
test('crosshair mutations are deduplicated and never change gameplay state',()=>{
  const element={dataset:{},textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v}};
  const tree={userData:{hp:6,maxHp:9,id:'0,0:1'}};
  updateCrosshair(element,aimState(false,tree));
  assert.equal(element.dataset.kind,'tree');
  assert.equal(element.textContent,'✳');
  assert.equal(tree.userData.hp,6);
  updateCrosshair(element,aimState(true,null,'нет брёвен'));
  assert.equal(element.dataset.kind,'blocked');
  assert.equal(element.attributes['aria-label'],'Нельзя установить бревно');
});
