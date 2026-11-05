import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectPickupTarget,nearestPickupTarget,pickupCandidates,worldInteractionCandidates,createPickupInteraction,
} from '../src/pickup-interaction.js';
import {aimState,updateCrosshair} from '../src/aim-state.js';
import {createGroundBoxes} from '../src/ground-boxes.js';
import {createInventoryModel} from '../src/inventory.js';

const resource=(id,x,dist,extra={})=>({
  type:'resource',id,x,y:0,z:0,distance:dist,maxDistance:2.4,label:'Ветка',...extra,
});
test('centered pickup changes crosshair and restores idle state after looking away',()=>{
  const item=resource('branch-1',1,1);
  const focused=selectPickupTarget([item],()=>({x:.04,y:.08,z:.4}));
  assert.equal(focused?.id,'branch-1');
  const state=aimState(false,null,'',focused);
  assert.equal(state.kind,'pickup');
  assert.match(state.label,/Ветка/);
  const el={dataset:{},setAttribute(name,value){this[name]=value;}};
  updateCrosshair(el,state);
  assert.equal(el.dataset.kind,'pickup');
  updateCrosshair(el,aimState(false,null));
  assert.equal(el.dataset.kind,'idle');
  assert.equal(el.textContent,'+');
});
test('reticle ignores distant/offscreen objects, prioritizes visual alignment',()=>{
  const aligned=resource('center',2,2);
  const nearby=resource('near',.8,.8);
  const outside=resource('out',4,4);
  const candidate=selectPickupTarget([nearby,aligned,outside],item=>({
    x:item.id==='center'?.01:item.id==='near'?.22:.001,
    y:0,z:.4,
  }));
  assert.equal(candidate.id,'center');
  assert.equal(selectPickupTarget([aligned],()=>({x:1,y:0,z:.4})),null);
  assert.equal(selectPickupTarget([aligned],()=>({x:.01,y:0,z:-2})),null);
  assert.equal(nearestPickupTarget([outside,aligned],[nearby]).id,'near');
});
test('boxes and forest items share the same reach checks',()=>{
  const ctx={
    px:0,pz:0,terrain:{heightAt:()=>1,waterDepthAt:()=>0},
    forestResources:{
      nodes:[
        {id:'branch:0',kind:'branch',x:1,z:0},
        {id:'hidden',kind:'flower:daisy',x:1.3,z:.2},
        {id:'far',kind:'stone',x:4,z:0},
      ],
      isVisible:id=>id!=='hidden',
    },
    groundBoxes:{boxes:[
      {id:7,x:1.8,z:0,item:{id:'stone',count:1}},
      {id:8,x:4,z:0,item:{id:'branch',count:2}},
    ]},
  };
  const {resources,boxes}=pickupCandidates(ctx);
  assert.deepEqual(resources.map(x=>x.id),['branch:0']);
  assert.deepEqual(boxes.map(x=>x.id),[7]);
  assert.equal(boxes[0].label,'Камень');
});
test('mobile pickup button picks the same aimed item; fallback works nearby',()=>{
  const oldMatch=globalThis.matchMedia;
  globalThis.matchMedia=()=>({matches:true});
  try{
    const actions=[];
    const listeners={};
    const btn={hidden:true,disabled:true,addEventListener:(name,fn)=>listeners[name]=fn,
      setAttribute(key,value){this[key]=value;}};
    class Vector3{
      set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
      project(){this.x=this.x===1?.03:this.x===2?.5:this.x;this.y=0;this.z=.5;return this;}
    }
    const nodes=[
      {id:'first',kind:'branch',x:1,z:0},
      {id:'second',kind:'stone',x:2,z:0},
    ];
    const ctx={
      $:id=>id==='pickup'?btn:null,
      THREE:{Vector3},camera:{},px:0,pz:0,buildMode:false,
      terrain:{waterDepthAt:()=>0,heightAt:()=>0},
      forestResources:{nodes,isVisible:()=>true,
        collect:id=>{actions.push(id);return true;}},
      groundBoxes:{boxes:[],pickup:id=>{actions.push(id);return true;}},
    };
    const picker=createPickupInteraction(ctx);
    assert.equal(picker.update().id,'first');
    assert.equal(btn.hidden,false);
    listeners.click({preventDefault(){},stopPropagation(){}});
    assert.deepEqual(actions,['first']);
    nodes.splice(0,1);
    assert.equal(picker.update(),null,'second is nearby but not aimed at');
    assert.equal(btn.hidden,false,'nearby pickup remains touch accessible');
    assert.equal(picker.pickup(),true);
    assert.deepEqual(actions,['first','second']);
    nodes.splice(0,1);
    assert.equal(picker.update(),null);
    assert.equal(btn.hidden,true);
  }finally{
    if(oldMatch===undefined)delete globalThis.matchMedia;
    else globalThis.matchMedia=oldMatch;
  }
});
test('building reticle wins and touch button does not overlap construction controls',()=>{
  const pickup=resource('test',1,1);
  assert.equal(aimState(true,null,'',pickup).kind,'build');
  assert.equal(aimState(true,null,'blocked',pickup).kind,'blocked');
  assert.equal(aimState(false,{userData:{hp:2,species:'birch'}},'',pickup).kind,'tree');
});


test('real dropped-box model is visible to the shared picker and E/touch collects it over dense grass',()=>{
  const oldMatch=globalThis.matchMedia;
  globalThis.matchMedia=()=>({matches:true});
  try{
    class Geometry{dispose(){}}
    class Material{dispose(){}}
    class Object3D{
      constructor(){this.children=[];this.position={set(x,y,z){Object.assign(this,{x,y,z});}};}
      add(...items){this.children.push(...items);}
    }
    class Mesh extends Object3D{}
    class Vector3{
      set(x,y,z){Object.assign(this,{x,y,z});return this;}
      project(){this.x=this.z < -1 ? 0:.07;this.y=.01;this.z=.4;return this;}
    }
    const elements={};
    const pickupButton={hidden:true,disabled:true,handlers:{},setAttribute(k,v){this[k]=v;},
      addEventListener(k,fn){this.handlers[k]=fn;}};
    const state=createInventoryModel();
    const collectedResources=[];
    assert.equal(state.addItem({id:'log',count:1}),true);
    const world=new Set();
    const ctx={
      THREE:{BoxGeometry:Geometry,MeshLambertMaterial:Material,Group:Object3D,Mesh,Vector3},
      scene:{add:obj=>world.add(obj),remove:obj=>world.delete(obj)},
      terrain:{heightAt:()=>0,waterDepthAt:()=>0},px:0,pz:0,yaw:0,
      inventory:{state,render(){}},offlineSave:{markDirty(){}},isOnline:()=>false,
      forestResources:{
        nodes:[{id:'grass',kind:'dry_grass',x:0,z:-.5}],
        isVisible:()=>true,collect(id){collectedResources.push(id);return true;}
      },
      $:id=>id==='pickup'?pickupButton:null,
      buildMode:false,camera:{},notify(){},
    };
    const doc={createElement(){return {className:'',style:{},remove(){}};},
      body:{append(){}}};
    ctx.groundBoxes=createGroundBoxes(ctx,doc);
    const picker=createPickupInteraction(ctx);
    assert.equal(ctx.groundBoxes.dropSlot(1),true,'drop an actual log stack');
    assert.equal(state.count('log'),0);
    assert.equal(ctx.groundBoxes.count,1);
    const box=ctx.groundBoxes.snapshot()[0];
    assert.equal([...ctx.groundBoxes.boxes].length,1,
      'live box iterator must expose the just-dropped box without creating a snapshot');
    assert.deepEqual(pickupCandidates(ctx).boxes.map(b=>b.id),[box.id]);
    assert.equal(picker.update()?.id,box.id,'box wins when grass is nearer');
    assert.equal(pickupButton.hidden,false,'mobile pickup is available');
    assert.match(pickupButton.title,/Бревно/);
    pickupButton.handlers.click({preventDefault(){},stopPropagation(){}});
    assert.equal(ctx.groundBoxes.count,0,'box is removed from the world');
    assert.equal(state.count('log'),1,'full dropped stack is recovered');
    assert.equal([...ctx.groundBoxes.boxes].length,0,'live iterator reflects removal');
    assert.deepEqual(collectedResources,[],'the box pickup never reaches the grass handler');
    assert.equal(picker.pickup(),true,'the remaining grass resource can still be collected');
    assert.deepEqual(collectedResources,['grass']);
    ctx.groundBoxes.dispose();
  }finally{
    if(oldMatch===undefined)delete globalThis.matchMedia;
    else globalThis.matchMedia=oldMatch;
  }
});

test('dropped boxes win fallback pickup when grass has shorter world distance',()=>{
  const resources=[resource('dry-grass',.3,.3)];
  const boxes=[{type:'box',id:17,x:1.5,y:.28,z:0,distance:1.5,maxDistance:2.8,label:'Бревно'}];
  // Intentional dropped items are prioritized over the ubiquitous grass tufts.
  const focusedBox=selectPickupTarget(boxes,()=>({x:.01,y:.02,z:.4}));
  assert.equal(focusedBox.id,17);
  assert.equal(nearestPickupTarget([],boxes).id,17);
  assert.equal(nearestPickupTarget(resources,[]).id,'dry-grass');
});

test('aimed flower wins over nearby chest and E uses the same single visible target',()=>{
 const oldMatch=globalThis.matchMedia;
 globalThis.matchMedia=()=>({matches:false});
 try{
  let facing='flower';
  const actions=[];
  class Vector3{
   set(x,y,z){Object.assign(this,{x,y,z});return this;}
   project(){
    const flower=this.x===1;
    const centered=facing==='flower'?flower:!flower;
    this.x=centered?.01:.54;this.y=.02;this.z=.5;return this;
   }
  }
  const button={hidden:true,disabled:true,addEventListener(){},setAttribute(){}};
  const chest={id:6,kind:'chest',name:'Инструменты',x:2,z:0};
  const ctx={
   $:id=>id==='pickup'?button:null,THREE:{Vector3},camera:{},
   px:0,pz:0,buildMode:false,
   terrain:{heightAt:()=>0,waterDepthAt:()=>0},
   storages:{structures:new Map([[6,chest]]),open:id=>{actions.push('open:'+id);return true;}},
   campStructures:{items:new Map(),toggle:id=>{actions.push('toggle:'+id);return true;}},
   forestResources:{nodes:[{id:'rose',kind:'flower:pink_wildflower',x:1,z:0}],
     isVisible:()=>true,collect:id=>{actions.push('collect:'+id);return true;}},
   groundBoxes:{boxes:[]},
  };
  assert.equal(worldInteractionCandidates(ctx).storages[0].id,6);
  const picker=createPickupInteraction(ctx);
  assert.equal(picker.update()?.id,'rose');
  assert.equal(picker.current.label,'Розовый полевой цветок');
  assert.equal(picker.interact(),true);
  assert.deepEqual(actions,['collect:rose'],'the E action matches the focused flower');
  facing='chest';
  assert.equal(picker.update()?.id,6);
  assert.equal(picker.current.label,'Сундук');
  assert.equal(aimState(false,null,'',picker.current).kind,'pickup');
  assert.equal(picker.interact(),true);
  assert.deepEqual(actions,['collect:rose','open:6'],'the E action now matches the focused chest');
  ctx.forestResources.nodes.length=0;
  ctx.storages.structures.clear();
  assert.equal(picker.update(),null);
  assert.equal(picker.current,null);
 }finally{
  if(oldMatch===undefined)delete globalThis.matchMedia;
  else globalThis.matchMedia=oldMatch;
 }
});

test('reticle and E use the same camp interaction as for a pickup',()=>{
 const oldMatch=globalThis.matchMedia;
 globalThis.matchMedia=()=>({matches:false});
 try{
  let toggled=-1;
  class Vector3{
   set(x,y,z){Object.assign(this,{x,y,z});return this;}
   project(){this.x=.01;this.y=.03;this.z=.3;return this;}
  }
  const ctx={
   $:()=>null,THREE:{Vector3},camera:{},px:0,pz:0,buildMode:false,
   terrain:{heightAt:()=>0,waterDepthAt:()=>0},
   campStructures:{items:new Map([[4,{id:4,kind:'campfire',x:1,z:0,lit:false}]]),
    toggle(id){toggled=id;return true;}},
   forestResources:{nodes:[]},groundBoxes:{boxes:[]},
  };
  const picker=createPickupInteraction(ctx);
  assert.equal(picker.update().label,'Костёр');
  assert.equal(picker.current.verb,'Зажечь');
  assert.equal(picker.interact(),true);
  assert.equal(toggled,4);
 }finally{
  if(oldMatch===undefined)delete globalThis.matchMedia;
  else globalThis.matchMedia=oldMatch;
 }
});

test('an empty corpse shows a neutral hint, disables touch opening and consumes E without ground pickup',()=>{
 const previous=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:true});
 try{
  let opened=0,collected=0;
  class Vector3{set(){return this;}project(){Object.assign(this,{x:0,y:0,z:.5});return this;}}
  const button={addEventListener(){},setAttribute(){}};
  const corpse={type:'corpse',id:'empty',x:0,y:0,z:0,distance:1,maxDistance:2.8,label:'Курица',verb:'Пусто',empty:true};
  const ctx={THREE:{Vector3},camera:{},$:()=>button,px:0,pz:0,
   terrain:{heightAt:()=>0,waterDepthAt:()=>0},mobs:{candidate:()=>corpse,open:()=>opened++},
   forestResources:{nodes:[{id:'branch',kind:'branch',x:.2,z:0}],collect:()=>collected++},groundBoxes:{boxes:[]}};
  const picker=createPickupInteraction(ctx);assert.equal(picker.update()?.verb,'Пусто');assert.equal(button.disabled,true);
  assert.equal(aimState(false,null,'',picker.current).kind,'empty');
  assert.equal(aimState(false,{userData:{hp:3}},'',picker.current).kind,'empty','a tree behind the empty corpse must not replace its hint');
  assert.equal(picker.interact(),true);assert.equal(opened,0);assert.equal(collected,0);
 }finally{if(previous===undefined)delete globalThis.matchMedia;else globalThis.matchMedia=previous;}
});
