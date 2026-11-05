import test from 'node:test';
import assert from 'node:assert/strict';
import {createCorpseLootPanel} from '../src/corpse-loot-ui.js';
import {createCorpseLootPointer} from '../src/corpse-loot-pointer.js';
import {createCorpseLootActions} from '../src/corpse-loot-actions.js';
import {createInventoryModel} from '../src/inventory.js';
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}
 setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}
 append(child){child.parent=this;this.children.push(child);}replaceChildren(){for(const c of this.children)c.parent=null;this.children=[];}
 contains(node){for(;node;node=node.parent)if(node===this)return true;return false;}
 closest(tag){for(let n=this;n;n=n.parent)if(n.tag===tag)return n;return null;}
 click(){if(!this.disabled)this.onclick?.();}
}
function fixture(){
 let hit=null,coordinates,closed=0,positioned=0;const canvas={},state=createInventoryModel(),sounds=[],warnings=[];
 const record={id:'corpse',hp:0,x:0,z:0,loot:{chicken_meat:2,feather:4}};
 const ctx={renderer:{domElement:canvas},px:0,pz:0,inventory:{state,render(){}},isOnline:()=>false,audio:{effect:id=>sounds.push(id)},notify:m=>warnings.push(m)};
 const actions=createCorpseLootActions(ctx,{getRecord:()=>record,world:()=>({take(id,item,n,canAdd,add){if(!canAdd(item,n))return 0;add(item,n);record.loot[item]-=n;return n;}}),refresh:()=>ui.render(record)});
 const doc={pointerLockElement:canvas,createElement:tag=>new Element(tag),elementFromPoint(x,y){coordinates=[x,y];return hit;}};
 const ui=createCorpseLootPanel({doc,onTake:actions.take,onClose(){closed++;ui.panel.hidden=true;pointer.clear();}});
 ui.render(record);ui.panel.hidden=false;
 const pointer=createCorpseLootPointer(ctx,ui,{doc,viewport:()=>({width:800,height:600}),positionPanel:()=>positioned++});
 function click(button=0,pointerType='mouse'){
  let prevented=false,stopped=false;
  const consumed=pointer.handlePointer({button,pointerType,preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
  return {consumed,prevented,stopped};
 }
 return {ui,pointer,doc,state,sounds,warnings,click,hit:n=>hit=n,get coordinates(){return coordinates;},get closed(){return closed;},get positioned(){return positioned;}};
}
test('crosshair selects a row and uses the same inventory transfer and pickup sound as a click',()=>{
 const f=fixture(),row=f.ui.panel.children.find(n=>n.dataset.item==='feather'),label=new Element('span');row.append(label);f.hit(label);
 assert.equal(f.pointer.update().actionable,true);assert.deepEqual(f.coordinates,[400,300]);assert.equal(f.positioned,1);
 assert.equal(f.ui.selected,'feather');assert.equal(row.classes.has('crosshair-hover'),true);
 assert.deepEqual(f.click(),{consumed:true,prevented:true,stopped:true});
 assert.equal(f.state.count('feather'),4);assert.deepEqual(f.sounds,['pickup']);
});
test('panel background, disabled buttons and right click consume input without an action',()=>{
 const f=fixture(),title=f.ui.panel.children[0];f.hit(title);
 assert.equal(f.pointer.update().actionable,false);assert.equal(f.pointer.aimed,true);
 assert.equal(f.click().consumed,true);assert.deepEqual(f.sounds,[]);
 const close=f.ui.panel.children.at(-1);f.hit(close);assert.equal(f.click(2).consumed,true);assert.equal(f.closed,0);
 close.disabled=true;assert.equal(f.click().consumed,true);assert.equal(f.closed,0);
});
test('crosshair can take all or close; closing consumes its click even though the panel disappears',()=>{
 const f=fixture(),all=f.ui.panel.children.find(n=>n.textContent==='Забрать всё · R');f.hit(all);
 assert.equal(f.click().consumed,true);assert.equal(f.state.count('chicken_meat'),2);assert.equal(f.state.count('feather'),4);assert.deepEqual(f.sounds,['pickup','pickup']);
 f.hit(f.ui.panel.children.at(-1));assert.equal(f.click().consumed,true);assert.equal(f.closed,1);assert.equal(f.pointer.aimed,false);
 assert.equal(f.click().consumed,false);
});
test('full-bag reticle clicks give normal feedback, stay silent and remain consumed',()=>{
 const f=fixture();for(let i=0;i<11;i++)assert.equal(f.state.addItem({id:'axe',tier:0}),true);
 f.hit(f.ui.panel.children.find(n=>n.dataset.item==='chicken_meat'));
 assert.equal(f.click().consumed,true);assert.deepEqual(f.warnings,['В сумке нет места']);assert.deepEqual(f.sounds,[]);
});
test('outside or covered panel does not consume attacks; unlocked cursor and touch keep normal row clicks',()=>{
 const f=fixture();f.hit(new Element('div'));assert.equal(f.click().consumed,false);
 const row=f.ui.panel.children.find(n=>n.dataset.item==='feather');f.hit(row);f.pointer.update();
 f.doc.pointerLockElement=null;assert.equal(f.click().consumed,false);assert.equal(f.pointer.aimed,false);assert.equal(row.classes.has('crosshair-hover'),false);
 assert.equal(f.click(0,'touch').consumed,false);row.click();assert.equal(f.state.count('feather'),4);
});
test('wheel selection survives stationary crosshair hover and updates again when aiming at another row',()=>{
 const f=fixture(),rows=f.ui.panel.children.filter(n=>n.dataset.item);f.hit(rows[0]);f.pointer.update();
 f.ui.cycle(1);f.pointer.update();assert.equal(f.ui.selected,'feather');
 f.hit(f.ui.panel.children[0]);f.pointer.update();f.hit(rows[0]);f.pointer.update();assert.equal(f.ui.selected,'chicken_meat');
});
