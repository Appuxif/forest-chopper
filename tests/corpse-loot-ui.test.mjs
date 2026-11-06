import test from 'node:test';
import assert from 'node:assert/strict';
import {createCorpseLootPanel} from '../src/corpse-loot-ui.js';
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}
 setAttribute(k,v){this.attributes[k]=v;}
 append(child){this.children.push(child);}
 replaceChildren(){this.children=[];}
}
const fixture=()=>{
 const taken=[];const ui=createCorpseLootPanel({doc:{createElement:tag=>new Element(tag)},onTake:(...args)=>taken.push(args),onClose:()=>{}});
 const record={id:'hen',loot:{chicken_meat:2,feather:4}};ui.render(record);return {ui,record,taken};
};
test('loot rows have stable selection, wrap with wheel and only take the selected item',()=>{
 const {ui,record,taken}=fixture();assert.equal(ui.selected,'chicken_meat');
 const rows=ui.panel.children.filter(c=>c.dataset.item);assert.equal(rows.length,2);
 assert.equal(rows[0].attributes['aria-selected'],'true');
 ui.cycle(1);assert.equal(ui.selected,'feather');assert.equal(rows[1].attributes['aria-selected'],'true');
 ui.takeSelected();assert.deepEqual(taken,[['hen','feather']]);
 ui.render({...record,loot:{chicken_meat:1,feather:3}});assert.equal(ui.selected,'feather');
 ui.cycle(1);assert.equal(ui.selected,'chicken_meat');ui.cycle(-1);assert.equal(ui.selected,'feather');
});
test('pointer and touch click target the indicated row; taking all snapshots both item IDs',()=>{
 const {ui,taken}=fixture();const rows=ui.panel.children.filter(c=>c.dataset.item);
 rows[1].onpointerenter();assert.equal(ui.selected,'feather');rows[1].onclick();
 assert.deepEqual(taken,[['hen','feather']]);ui.takeAll();
 assert.deepEqual(taken.slice(1),[['hen','chicken_meat'],['hen','feather']]);
});
test('empty bodies cannot take anything and missing rows are replaced by remaining loot',()=>{
 const {ui,record,taken}=fixture();ui.render({...record,loot:{chicken_meat:0,feather:1}});assert.equal(ui.selected,'feather');
 ui.render({...record,loot:{chicken_meat:0,feather:0}});assert.equal(ui.selected,null);ui.takeSelected();ui.takeAll();assert.deepEqual(taken,[]);
});
