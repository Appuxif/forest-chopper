import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectPickupTarget,nearestPickupTarget,pickupCandidates,createPickupInteraction,
} from '../src/pickup-interaction.js';
import {aimState,updateCrosshair} from '../src/aim-state.js';

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
