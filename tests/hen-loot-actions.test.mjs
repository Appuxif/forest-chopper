import test from 'node:test';
import assert from 'node:assert/strict';
import {createHenLootActions} from '../src/hen-loot-actions.js';
import {createHenLootPanel} from '../src/hen-loot-ui.js';
import {createPickupInteraction} from '../src/pickup-interaction.js';
import {createInventoryModel} from '../src/inventory.js';
import {createHenWorld} from '../src/hen-rules.js';
class Element{
 constructor(){this.dataset={};this.children=[];this.classList={toggle(){}};}
 setAttribute(){} append(child){this.children.push(child);} replaceChildren(){this.children=[];}
}
function fixture(online=false){
 const state=createInventoryModel(),sounds=[],warnings=[],sent=[];
 const model=createHenWorld({seed:1});const bird=model.tick(0,[{x:0,z:0}])[0];model.hit(bird.id);
 let corpse=model.tick(0,[{x:0,z:0}]).find(r=>r.id===bird.id);
 const ctx={px:corpse.x,pz:corpse.z,inventory:{state,render(){}},isOnline:()=>online,
  audio:{effect:id=>sounds.push(id)},notify:message=>warnings.push(message),sendNet:packet=>sent.push(packet)};
 const actions=createHenLootActions(ctx,{getRecord:id=>id===corpse.id?corpse:null,world:()=>model,
  refresh(){corpse=model.tick(0,[{x:ctx.px,z:ctx.pz}]).find(r=>r.id===bird.id);ui.render(corpse);}});
 const ui=createHenLootPanel({doc:{createElement:()=>new Element()},onTake:actions.take,onClose(){}});
 ui.render(corpse);return {ctx,state,ui,actions,sounds,warnings,sent,get corpse(){return corpse;}};
}
test('explicit E opens first; subsequent E and row clicks use identical full-bag feedback without ground pickup',()=>{
 const f=fixture();for(let i=0;i<11;i++)assert.equal(f.state.addItem({id:'axe',tier:0}),true);
 class Vector3{set(){return this;}project(){return {x:0,y:0,z:.4};}}
 f.ctx.THREE={Vector3};f.ctx.$=()=>null;f.ctx.camera={};f.ctx.buildMode=false;
 f.ctx.hens={opened:null,candidate:()=>({type:'hen',id:f.corpse.id,x:f.ctx.px,y:0,z:f.ctx.pz,distance:0,maxDistance:2.8}),
  open(id){this.opened=id;},takeSelected:()=>f.ui.takeSelected()};
 const picker=createPickupInteraction(f.ctx);
 assert.equal(picker.interact(),true);assert.equal(f.ctx.hens.opened,f.corpse.id);assert.deepEqual(f.warnings,[]);
 // Any attempt to calculate/collect a ground target now fails the test.
 f.ctx.forestResources={get nodes(){assert.fail('E must not inspect resources while a corpse window is open');}};
 assert.equal(picker.interact(),true);assert.deepEqual(f.warnings,['В сумке нет места']);
 f.ui.panel.children.find(e=>e.dataset.item).onclick();
 assert.deepEqual(f.warnings,['В сумке нет места','В сумке нет места']);assert.deepEqual(f.sounds,[]);
});
test('E, mouse/tap and take-all play pickup only on successful offline transfer',()=>{
 for(const mode of ['E','click','all']){
  const f=fixture();if(mode==='E')f.ui.takeSelected();else if(mode==='click')f.ui.panel.children.find(e=>e.dataset.item).onclick();else f.ui.takeAll();
  assert.equal(f.sounds.length,mode==='all'?2:1);assert.ok(f.sounds.every(s=>s==='pickup'));assert.ok(f.state.count('chicken_meat')>0);
 }
});
test('online pickup is silent until a matching server receipt and never repeats on duplicate ack',()=>{
 const f=fixture(true);f.ui.takeSelected();assert.equal(f.sent.length,1);assert.deepEqual(f.sounds,[]);
 f.actions.accept({});assert.deepEqual(f.sounds,[]);
 const ack={hen_loot:{id:f.corpse.id,item:'chicken_meat',count:1}};
 f.actions.accept(ack);f.actions.accept(ack);assert.deepEqual(f.sounds,['pickup']);
});
