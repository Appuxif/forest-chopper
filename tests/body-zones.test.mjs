import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBodySkinZones,visibleBodyIndices} from '../characters/humanoid/body-zones.js';

// A mock SkinnedMesh with one skinned triangle per anatomical segment.
// All four weights are present, as they are in GLTFLoader's BufferAttributes.
function sampleBody(){
  const bones=['spine_03','upperarm_l','hand_l','thigh_l','foot_l','head'];
  const rows=[
    [0,1.12], // torso
    [1,1.28], // upper arm under short sleeve
    [2,1.03], // hand: must always be visible
    [3,.76],  // upper thigh under shorts/jeans
    [4,.05],  // foot inside shoes
    [5,1.6],  // face: must never vanish
  ];
  const vertices=rows.flatMap(([bone,y])=>[
    [bone,y,0],[bone,y+.001,.01],[bone,y-.001,-.01]
  ]);
  const array=new Uint16Array(vertices.map((_,i)=>i));
  const attr=(values)=>({
    count:values.length,
    getX:i=>values[i][0]??0,
    getY:i=>values[i][1]??0,
    getZ:i=>values[i][2]??0,
    getW:i=>values[i][3]??0
  });
  const skinIndices=vertices.map(([index])=>[index,0,0,0]);
  const skinWeights=vertices.map(()=>[1,0,0,0]);
  const positions=vertices.map(([_,y])=>[0,y,0]);
  return {geometry:{
    index:{array},
    getAttribute:key=>({position:attr(positions),skinIndex:attr(skinIndices),skinWeight:attr(skinWeights)})[key]
  },skeleton:{bones:bones.map(name=>({name}))}};
}
const covered=(name)=>[{hidesBodyZones:[name]}];

test('one-time zone classification preserves every naked triangle',()=>{
  const zones=makeBodySkinZones(sampleBody());
  assert.equal(zones.fullIndices.length/3,6);
  assert.equal(visibleBodyIndices(zones,[]).length/3,6);
  assert.equal(zones.regions.get('hand'),1);
  assert.equal(zones.regions.get('head'),1);
});
test('long-sleeved shirt hides body and upper arms, but not hands or face',()=>{
  const zones=makeBodySkinZones(sampleBody());
  const visible=visibleBodyIndices(zones,covered('shirt'));
  assert.deepEqual(Array.from(visible),[6,7,8,9,10,11,12,13,14,15,16,17]);
});
test('T-shirt leaves hands and forearms exposed',()=>{
  const zones=makeBodySkinZones(sampleBody());
  assert.deepEqual(
    Array.from(visibleBodyIndices(zones,covered('torso'))),
    [6,7,8,9,10,11,12,13,14,15,16,17]
  );
});
test('pants + boots mask only covered legs, leave head and hands',()=>{
  const zones=makeBodySkinZones(sampleBody());
  const visible=visibleBodyIndices(zones,[...covered('legs'),...covered('boots')]);
  assert.deepEqual(Array.from(visible),[0,1,2,3,4,5,6,7,8,15,16,17]);
});
test('underwear and bra do not create large holes around waist and chest',()=>{
  const zones=makeBodySkinZones(sampleBody());
  assert.equal(visibleBodyIndices(zones,covered('underwear_f')).length/3,6);
  assert.equal(visibleBodyIndices(zones,covered('underwear_m')).length/3,6);
  assert.equal(visibleBodyIndices(zones,covered('bra')).length/3,6);
});
test('layers recompute independently when one equipped garment is removed',()=>{
  const zones=makeBodySkinZones(sampleBody());
  const clothes=[...covered('shirt'),...covered('torso'),...covered('feet')];
  const first=visibleBodyIndices(zones,clothes);
  const noShirt=visibleBodyIndices(zones,clothes.slice(1));
  const naked=visibleBodyIndices(zones,[]);
  assert.equal(first.length/3,3);
  assert.equal(noShirt.length/3,3); // T-shirt still covers torso/upper arm top
  assert.equal(naked.length/3,6);
  assert.notEqual(first,zones.fullIndices);
  assert.equal(naked,zones.fullIndices);
});
