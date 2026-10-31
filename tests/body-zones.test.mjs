import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBodySkinZones,insetBodyPositions} from '../characters/humanoid/body-zones.js';

// 53-bone source GLB simplified to six representative disconnected body
// patches. Geometry never changes connectivity, even under a loose shirt.
function sampleBody(){
  const bones=['spine_03','upperarm_l','hand_l','thigh_l','foot_l','head','lowerarm_l','neck_01'];
  const samples=[
    [0,1.12], // torso
    [1,1.28], // upper arm under sleeve
    [2,1.03], // hand (exposed)
    [3,.76],  // upper thigh (covered by shorts)
    [4,.05],  // foot (inside shoes)
    [5,1.61], // head (always exposed)
    [6,1.08], // forearm (exposed under T-shirt)
    [7,1.43], // neck (always exposed)
    [0,1.39], // upper chest / collar fade
  ];
  const vertices=samples.flatMap(([bone,y],n)=>[
    [bone,y,0.1*n],[bone,y+.001,0.1*n+.01],[bone,y-.001,0.1*n-.01]
  ]);
  const arr=new Uint16Array(vertices.map((_,i)=>i));
  const attr=(values)=>({
    count:values.length,
    array:new Float32Array(values.flat()),
    getX:i=>values[i][0]??0,
    getY:i=>values[i][1]??0,
    getZ:i=>values[i][2]??0,
    getW:i=>values[i][3]??0,
  });
  const position=attr(vertices.map(([_,y,z])=>[0,y,z]));
  const skinIndex=attr(vertices.map(([bone])=>[bone,0,0,0]));
  const skinWeight=attr(vertices.map(()=>[1,0,0,0]));
  const normal=attr(vertices.map(()=>[1,0,0]));
  return {
    geometry:{index:{array:arr},getAttribute:k=>({position,skinIndex,skinWeight,normal})[k]},
    skeleton:{bones:bones.map(name=>({name}))}
  };
}
const covered=(name)=>[{hidesBodyZones:[name]}];
const count=data=>data.length/3;
const dx=(data,original,vertex)=>original[3*vertex]-data[3*vertex];

test('all body triangles remain indexed under any clothes (no open neck/hem/cuff)',()=>{
  const z=makeBodySkinZones(sampleBody());
  const shirt=insetBodyPositions(z,covered('shirt'));
  assert.equal(count(shirt),27);
  assert.equal(z.indices.length,27);
  assert.equal(shirt.length,z.positions.length);
  assert.deepEqual(Array.from(z.indices),Array.from({length:27},(_,i)=>i));
});

test('shirt moves covered torso and sleeves inside without touching face or hands',()=>{
  const z=makeBodySkinZones(sampleBody());
  const p=insetBodyPositions(z,covered('shirt'));
  assert.ok(dx(p,z.positions,0)>.023,'torso inset >= 2.3 cm');
  assert.ok(dx(p,z.positions,3)>.023,'upper arm inset');
  assert.equal(dx(p,z.positions,6),0,'hand remains as-is');
  assert.equal(dx(p,z.positions,15),0,'head remains as-is');
  assert.equal(dx(p,z.positions,21),0,'neck remains as-is');
  assert.ok(dx(p,z.positions,24)<dx(p,z.positions,0),
    'near the collar is softly feathered');
});

test('short-sleeved T-shirt preserves exposed forearms, hands, face and neck',()=>{
  const z=makeBodySkinZones(sampleBody());
  const p=insetBodyPositions(z,covered('torso'));
  assert.ok(dx(p,z.positions,3)>.023);
  assert.equal(dx(p,z.positions,18),0,'forearms stay exposed');
  assert.equal(dx(p,z.positions,6),0);
  assert.equal(dx(p,z.positions,15),0);
  assert.equal(dx(p,z.positions,21),0);
});

test('shorts do not inset calf/feet and shoes do not inset thighs',()=>{
  const z=makeBodySkinZones(sampleBody());
  const shorts=insetBodyPositions(z,covered('shorts'));
  const shoes=insetBodyPositions(z,covered('feet'));
  assert.ok(dx(shorts,z.positions,9)>.020);
  assert.equal(dx(shorts,z.positions,12),0);
  assert.equal(dx(shoes,z.positions,9),0);
  assert.ok(dx(shoes,z.positions,12)>.023);
});

test('bare body and lingerie have unchanged positions and indexes',()=>{
  const z=makeBodySkinZones(sampleBody());
  for(const items of [[],covered('underwear_m'),covered('underwear_f'),covered('bra')]){
    const p=insetBodyPositions(z,items);
    assert.deepEqual(Array.from(p),Array.from(z.positions));
    assert.equal(z.indices.length,27);
  }
});

test('equip/unequip is stateless; changing one avatar never changes another',()=>{
  const z=makeBodySkinZones(sampleBody());
  const original=z.positions.slice();
  const dressedA=insetBodyPositions(z,[...covered('shirt'),...covered('legs'),...covered('feet')]);
  const dressedB=insetBodyPositions(z,[...covered('torso'),...covered('shorts')]);
  const naked=insetBodyPositions(z,[]);
  assert.notDeepEqual(Array.from(dressedA),Array.from(dressedB));
  assert.deepEqual(Array.from(naked),Array.from(original));
  assert.deepEqual(Array.from(z.positions),Array.from(original));
  assert.equal(z.indices.length,27);
});
