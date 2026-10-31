import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKIN_MASK_ZONES,skinZoneForBone,classifySkinTriangles,
  maskedBodyIndices,createDebugSkinMask
} from '../characters/humanoid/skin-mask-debug.js';

const names=['spine_02','head','neck_01','upperarm_l','lowerarm_r','hand_l','index_01_l','thigh_r','calf_l','foot_r'];
function mockActor(){
  const sourceIndices=new Uint16Array(names.flatMap((_,i)=>[i*3,i*3+1,i*3+2]));
  const vertices=names.length*3;
  const attributes={
    position:{count:vertices},
    skinIndex:{getX:i=>Math.floor(i/3),getY:()=>0,getZ:()=>0,getW:()=>0},
    skinWeight:{getX:()=>1,getY:()=>0,getZ:()=>0,getW:()=>0},
  };
  const geometry={
    index:{array:sourceIndices,count:sourceIndices.length},
    getIndex(){return this.index},
    getAttribute(name){return attributes[name]},
    clone(){return {...this,index:{...this.index,array:this.index.array.slice()}}},
    setIndex(arr){this.index={array:arr,count:arr.length}},
  };
  const body={name:'Body',geometry,skeleton:{bones:names.map(name=>({name}))},visible:true};
  const faceMeshes=['Eyes_1','Eyes_2','Eyebrows','Eyelashes'].map(name=>({name,visible:true}));
  const hair={name:'Equip.hair.short02',visible:true};
  const actor={meshes:[body,...faceMeshes],parts:new Map([['hair',hair]])};
  return {actor,body,faceMeshes,hair};
}
test('nine anatomy zones map to expected bones',()=>{
  assert.equal(SKIN_MASK_ZONES.length,9);
  const expected=['torso','head','neck','upperArms','forearms','hands','hands','thighs','calves','feet'];
  assert.deepEqual(names.map(skinZoneForBone),expected);
});
test('each triangle is classified once without creating new geometry',()=>{
 const {body}=mockActor();
 const data=classifySkinTriangles(body);
 assert.equal(data.triangles.length,10);
 assert.equal(Object.values(data.counts).reduce((a,b)=>a+b,0),10);
 for(const z of SKIN_MASK_ZONES)assert.ok(data.counts[z.id]>0,'missing '+z.id);
});
test('mask two zones and restore: no cached mesh corruption or missing faces',()=>{
 const {body}=mockActor();
 const original=classifySkinTriangles(body);
 const hidden=maskedBodyIndices(original,new Set(['torso','forearms']));
 assert.equal(hidden.length,8*3);
 const restored=maskedBodyIndices(original,[]);
 assert.deepEqual(Array.from(restored),Array.from(original.originalIndices));
 assert.notEqual(restored,original.originalIndices);
 assert.deepEqual(Array.from(body.geometry.index.array),Array.from(original.originalIndices));
});
test('debug mask hides floating face objects and hair when head is masked',()=>{
 const {actor,body,faceMeshes,hair}=mockActor();
 const mask=createDebugSkinMask(actor);
 assert.equal(mask.stats().total,10);
 assert.equal(mask.stats().hidden,0);
 assert.ok(mask.stats().byZone.head>0);
 mask.apply(['head','torso']);
 assert.equal(mask.stats().hidden,2);
 assert.ok(faceMeshes.every(x=>!x.visible));
 assert.equal(hair.visible,false);
 mask.apply(['hands']);
 assert.equal(mask.stats().hidden,2);
 assert.ok(faceMeshes.every(x=>x.visible));
 assert.equal(hair.visible,true);
 mask.apply([]);
 assert.equal(mask.stats().visible,10);
});
