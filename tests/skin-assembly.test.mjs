import test from 'node:test';
import assert from 'node:assert/strict';
import {BODY_PARTS,SKIN_DEFAULTS,resolveSkinAssembly} from '../characters/humanoid/skin-assembly.js';

test('bare avatar exposes every skin region and no garment owners',()=>{
 const a=resolveSkinAssembly({});
 assert.deepEqual(a.exposedSkin,BODY_PARTS);
 assert.deepEqual(a.owners,SKIN_DEFAULTS);
});
test('long sleeves replace forearms, while neck/hands remain skin',()=>{
 const a=resolveSkinAssembly({top:'shirt'});
 for(const p of ['torso','upperArmL','upperArmR','forearmL','forearmR'])
   assert.equal(a.owners[p],'garment:shirt');
 for(const p of ['head','neck','handL','handR','pelvis'])
   assert.equal(a.owners[p],'skin:'+p);
 assert.deepEqual(a.joints.top,['neck','wristL','wristR','waist']);
});
test('T-shirt leaves both forearms exposed',()=>{
 const a=resolveSkinAssembly({top:'tshirt'});
 assert.equal(a.owners.forearmL,'skin:forearmL');
 assert.equal(a.owners.forearmR,'skin:forearmR');
 assert.equal(a.owners.upperArmL,'garment:tshirt');
});
test('pants and shoes replace all lower-body skin while leaving upper-body skin',()=>{
 const a=resolveSkinAssembly({bottom:'jeans',shoes:'shoes'});
 for(const p of ['pelvis','thighL','thighR','calfL','calfR','footL','footR'])
   assert.ok(a.owners[p].startsWith('garment:'));
 assert.equal(a.owners.torso,'skin:torso');
});
test('outside jacket does not cause competing torso surface ownership',()=>{
 const a=resolveSkinAssembly({top:'shirt',outerwear:'jacket'});
 assert.equal(a.owners.torso,'garment:shirt');
 assert.deepEqual(a.joints.outerwear,['neck','wristL','wristR','waist']);
});
test('overlapping full replacements are an invalid kit, not two layers of skin',()=>{
 assert.throws(()=>resolveSkinAssembly({top:'shirt',extra:'hoodie'}),/Overlapping surface replacement/);
});
