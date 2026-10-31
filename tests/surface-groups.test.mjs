import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSurfaceGroups,surfaceColor} from '../characters/humanoid/surface-groups.js';

const mockBody=()=>{
  const names=['head','neck','torso','upperArm','forearm','hand',
               'pelvis','thighLower','calfUpper','foot'];
  const x=names.map(n=>n==='head'||n==='neck'||n==='torso'||n==='pelvis'?0:-.25);
  // One triangle per region, no reordering error or missing face.
  const positions=new Float32Array(names.flatMap((_,i)=>[x[i],i*.01,0]));
  const dominantZones=[...names];
  const indices=new Uint16Array(names.flatMap((_,i)=>[i,i,i]));
  return {positions,dominantZones,indices};
};
test('unclothed model is one skin material and all triangles survive',()=>{
  const z=mockBody();
  const out=compileSurfaceGroups(z,{});
  assert.deepEqual(out.chunks,[{owner:'skin',start:0,count:30}]);
  assert.deepEqual(Array.from(out.indices).sort((a,b)=>a-b),Array.from(z.indices).sort((a,b)=>a-b));
});
test('long sleeves and trousers replace internal body surfaces with fabric, never a hole',()=>{
  const z=mockBody();
  const out=compileSurfaceGroups(z,{top:'shirt',bottom:'jeans',shoes:'shoes'});
  assert.equal(out.indices.length,z.indices.length);
  assert.ok(out.chunks.some(x=>x.owner==='garment:shirt'));
  assert.ok(out.chunks.some(x=>x.owner==='garment:jeans'));
  assert.ok(out.chunks.some(x=>x.owner==='skin'));
  assert.ok(out.chunks.some(x=>x.owner==='garment:shoes'));
  assert.equal(out.chunks.reduce((a,c)=>a+c.count,0),out.indices.length);
  assert.equal(out.chunks[0].owner,'skin');
  assert.equal(out.assembly.owners.forearmL,'garment:shirt');
  assert.equal(out.assembly.owners.handL,'skin:handL');
});
test('short sleeves keep forearms as skin, shorts expose calves',()=>{
  const z=mockBody();
  const out=compileSurfaceGroups(z,{top:'tshirt',bottom:'shorts'});
  assert.equal(out.assembly.owners.forearmL,'skin:forearmL');
  assert.equal(out.assembly.owners.calfL,'skin:calfL');
  assert.equal(out.assembly.owners.sleeveL,'skin:sleeveL');
  assert.equal(out.assembly.owners.upperArmL,'skin:upperArmL');
  assert.equal(out.assembly.owners.thighL,'skin:thighL');
  assert.equal(out.indices.length,z.indices.length);
});
test('both outfit combinations have unique, stable material ownership',()=>{
  for(const top of ['shirt','tshirt'])
    for(const bottom of ['jeans','shorts']){
      const z=mockBody();
      const result=compileSurfaceGroups(z,{top,bottom});
      assert.ok(result.chunks.some(x=>x.owner==='garment:'+top));
      assert.ok(result.chunks.some(x=>x.owner==='garment:'+bottom));
      assert.equal(result.indices.length,z.indices.length);
    }
  assert.ok(surfaceColor('shirt')!==surfaceColor('tshirt'));
  assert.ok(surfaceColor('jeans')!==surfaceColor('shorts'));
});
