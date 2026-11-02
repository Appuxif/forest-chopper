import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {outfitMaskNames, BODY_MASK_SLOTS} from '../characters/humanoid/skin-mask-matrix.js';
const root=new URL('../characters/humanoid/',import.meta.url);
const matrix=JSON.parse(readFileSync(new URL('masks/clothing-matrix.json',root),'utf8'));
const manifest=JSON.parse(readFileSync(new URL('masks/manifest.json',root),'utf8'));

test('every assigned item mask exists in the saved PNG library, both genders',()=>{
 for(const gender of ['male','female']){
  const available=new Set(manifest.masks[gender]);
  for(const [item,assigned] of Object.entries(matrix[gender])){
   assert.ok(Array.isArray(assigned));
   for(const name of assigned){
    assert.ok(available.has(name),`Missing PNG ${gender}/${name} for ${item}`);
    const png=readFileSync(new URL(`masks/${gender}/${name}.png`,root));
    assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16),1024);
    assert.equal(png.readUInt32BE(20),1024);
   }
  }
 }
});
test('shirt and dress apply exactly the authors saved masks and never whole arm-zone heuristics',()=>{
 assert.deepEqual(outfitMaskNames(matrix,'male',{top:'shirt'}),
   ['butt','left-upper-shoulder','right-upper-shoulder']);
 assert.deepEqual(outfitMaskNames(matrix,'male',{top:'dress'}),
   ['butt','front-chest','left-upper-shoulder','right-upper-shoulder']);
 assert.deepEqual(outfitMaskNames(matrix,'female',{top:'dress'}),[]);
 assert.deepEqual(outfitMaskNames(matrix,'male',{top:null}),[]);
});
test('multiple clothing items combine authored names once and ignore hair',()=>{
 const got=outfitMaskNames(matrix,'male',
  {top:'shirt',bottom:'jeans',shoes:'shoes',hair:'short02'});
 assert.ok(got.includes('left-knee') && got.includes('right-sock'));
 assert.equal(got.filter(x=>x==='butt').length,1);
 assert.ok(!BODY_MASK_SLOTS.includes('hair'));
 assert.throws(()=>outfitMaskNames({male:{shirt:['<bad>']}},'male',{top:'shirt'}),/Invalid mask name/);
});
test('runtime and editor use the same authored matrix without geometry/deformation masking',()=>{
 const actor=readFileSync(new URL('humanoid-lite.js',root),'utf8');
 const preview=readFileSync(new URL('preview-lite.html',root),'utf8');
 const runtime=readFileSync(new URL('body-mask-runtime.js',root),'utf8');
 assert.match(actor,/await applyBodyMaskFromOutfit\(actor\)/);
 assert.match(preview,/outfitMaskNames\(matrix,cfg\.body,outfit\)/);
 assert.match(runtime,/material\.alphaMap=texture/);
 for(const hack of ['insetBodyPositions','makeBodySkinZones','applyClothingLayerMask','setClothingLayerMaskEnabled', 'updateBodyVisibility']){
  assert.ok(!actor.includes(hack),hack);
 }
 assert.ok(!preview.includes('autoClothingLayers'));
 assert.ok(!actor.includes('position.setXYZ('));
});
