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
test('an aimed living mob uses the pickup reticle shape and an accessible attack state',()=>{
 const mob={hp:1,displayName:'Курица'},pickup={label:'Ветка'},tree={userData:{hp:2}};
 const state=aimState(false,tree,'',pickup,mob);
 assert.equal(state.kind,'mob');assert.equal(state.text,aimState(false,null,'',pickup).text);
 assert.equal(state.label,'Можно атаковать: Курица');
 assert.equal(aimState(true,null,'',pickup,mob).kind,'build');
 assert.equal(aimState(false,null,'',pickup,{...mob,hp:0}).kind,'pickup');
 const element={dataset:{},setAttribute(){}};
 updateCrosshair(element,state);assert.equal(element.dataset.kind,'mob');
 updateCrosshair(element,aimState(false,null));assert.equal(element.dataset.kind,'idle');assert.equal(element.textContent,'+');
 assert.equal(mob.hp,1,'target indication does not damage the mob');
});

test('mob color is applied by the updater even without a mob CSS rule and cleared on exit',()=>{
 const el={dataset:{},style:{},setAttribute(){}};
 updateCrosshair(el,aimState(false,null,'',null,{hp:1,displayName:'Курица'}));
 assert.equal(el.style.color,'#ff7979');assert.equal(el.style.transition,'none');assert.equal(el.style.scale,'1.35');
 updateCrosshair(el,aimState(false,null,'',null,null,{ui:{inside:true,actionable:true,label:'Забрать'}}));
 assert.equal(el.style.zIndex,'1003');assert.equal(el.style.pointerEvents,'none');
 updateCrosshair(el,aimState(false,null));
 assert.equal(el.style.zIndex,'');assert.equal(el.style.pointerEvents,'none');
 assert.equal(el.style.color,'');assert.equal(el.style.textShadow,'');assert.equal(el.style.transition,'');
});
test('pursuit suppresses world-target coloring while exact mob aim and building retain priority',()=>{
 const item={label:'Ветка'},tree={userData:{hp:3}},options={pursuing:true};
 assert.equal(aimState(false,tree,'',item,null,options).kind,'idle');
 assert.equal(aimState(false,null,'',item,{hp:1},options).kind,'mob');
 assert.equal(aimState(true,null,'',item,null,options).kind,'build');
 assert.equal(aimState(false,null,'',item,null,{pursuing:false}).kind,'pickup');
});
