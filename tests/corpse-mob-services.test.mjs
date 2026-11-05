import test from 'node:test';
import assert from 'node:assert/strict';
import {createCorpseLootPanel} from '../src/corpse-loot-ui.js';
import {createCorpseLootActions} from '../src/corpse-loot-actions.js';
import {validMobPoses,captureMobPose,applyMobPose} from '../src/mob-pose.js';
import {createMobRagdoll} from '../src/mob-ragdoll.js';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.classes=new Set();this.classList={toggle:(n,on)=>on?this.classes.add(n):this.classes.delete(n)};}
 setAttribute(k,v){this.attributes[k]=v;}append(c){this.children.push(c);}replaceChildren(){this.children=[];}
}
test('generic corpse panel derives arbitrary loot rows and uses the record display name',()=>{
 const taken=[],ui=createCorpseLootPanel({doc:{createElement:t=>new Element(t)},onTake:(...x)=>taken.push(x),onClose(){},itemLabel:id=>id==='stone'?'🪨 Stone':id});
 ui.render({id:'mob-1',displayName:'Forest Spirit',loot:{stone:2,branch:1,empty:0}});
 assert.equal(ui.panel.children[0].textContent,'Forest Spirit');
 assert.deepEqual(ui.panel.children.filter(x=>x.dataset.item).map(x=>x.dataset.item),['stone','branch']);
 ui.cycle(1);ui.takeSelected();ui.takeAll();
 assert.deepEqual(taken,[['mob-1','branch'],['mob-1','stone'],['mob-1','branch']]);
 ui.render({id:'other',loot:{twig:3}});assert.equal(ui.panel.children[0].textContent,'Добыча');
});

test('generic loot actions use registered inventory IDs and injected online transport/receipt',()=>{
 let record={id:'corpse',hp:0,x:0,z:0,loot:{stone:2,branch:1}},added=[],sent=[],sounds=[];
 const state={canAdd:item=>['stone','branch'].includes(item.id),addItem:item=>added.push(item)};
 const ctx={px:0,pz:0,inventory:{state,render(){}},isOnline:()=>false,audio:{effect:s=>sounds.push(s)}};
 const actions=createCorpseLootActions(ctx,{getRecord:id=>id==='corpse'?record:null,world:()=>({take:(id,item,count,canAdd,add)=>{if(!canAdd(item,count))return 0;add(item,count);record.loot[item]=0;return count;}}),refresh(){}});
 assert.equal(actions.take('corpse','stone'),true);assert.deepEqual(added,[{id:'stone',count:2}]);assert.deepEqual(sounds,['pickup']);
 ctx.isOnline=()=>true;ctx.sendNet=packet=>sent.push(packet);
 assert.equal(actions.take('corpse','branch'),true);assert.deepEqual(sent,[{type:'corpse_take',id:'corpse',item:'branch'}]);
 actions.accept({corpse_loot:{id:'corpse',item:'branch',count:1}});actions.accept({corpse_loot:{id:'corpse',item:'branch',count:1}});
 assert.deepEqual(sounds,['pickup','pickup']);
});

test('generic mob pose helpers support a larger bounded skeleton and round trip transforms',()=>{
 const bones=Array.from({length:64},(_,i)=>({name:`bone-${i}`,isBone:true,position:{toArray:()=>[i/100,0,0],fromArray(v){this.value=v;}},quaternion:{toArray:()=>[0,0,0,1],fromArray(v){this.value=v;return this;},normalize(){return this;}}}));
 const visual={traverse:fn=>bones.forEach(fn),updateMatrixWorld(){}};
 const pose=captureMobPose('mob',visual);assert.equal(validMobPoses([pose]),true);assert.equal(validMobPoses([pose],{maxBones:32}),false);
 applyMobPose(visual,pose);assert.deepEqual(bones[63].position.value,[.63,0,0]);
});

const deps=process.env.HEN_PHYSICS_NODE_MODULES;
test('generic ragdoll builds a separate two-bone profile in real Rapier',{skip:!deps},async()=>{
 const T=await import(pathToFileURL(deps+'/three/build/three.module.js'));
 const {default:R}=await import(pathToFileURL(deps+'/@dimforge/rapier3d-compat/dist/rapier.mjs'));await R.init();
 const root=new T.Bone();root.name='Root';root.position.y=1;
 const tip=new T.Bone();tip.name='Tip';tip.position.y=.4;root.add(tip);
 const visual=new T.Group();visual.add(root);visual.updateMatrixWorld(true);
 const ctx={THREE:T,GRAVITY:9,collisionWorld:{revision:0,collect:()=>[],terrainMesh:()=>({vertices:new Float32Array([-50,0,-50,-50,0,50,50,0,50,50,0,-50]),indices:new Uint32Array([0,1,2,0,2,3])})}};
 const profile={root:'Root',segments:[{name:'Root',end:'Tip',radius:.12},{name:'Tip',radius:.09}],parents:{Tip:'Root'},joints:{Tip:{kind:'spherical'}},lifetime:.2};
 const rag=await createMobRagdoll(ctx,visual,{profile,loadPhysics:async()=>R});
 try{for(let i=0;i<12;i++)rag.tick(1/60);assert.ok(rag.elapsed>0);assert.ok(Number.isFinite(rag.position().y));}finally{rag.dispose();}
});
