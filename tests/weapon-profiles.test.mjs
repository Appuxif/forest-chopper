import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AXE_STATS} from '../src/inventory.js';
import {SHARED_AXE_ASSET,CHARACTER_MODELS} from '../src/character-model-selection.js';
import {
 DEFAULT_WEAPON_ID,WEAPON_PROFILES,weaponProfile,
 weaponProfileForAnimation,weaponPlaybackSpeed,weaponCooldownMs,
 weaponDamage,equipWeaponGrips,
} from '../src/weapon-profiles.js';
import {chopContactClipTime,chopContactReached} from '../src/chop-timing.js';
import {CHOP_SPEED} from '../src/animations.js';

test('one immutable axe profile owns asset, socket, clip, timing, range and future arc',()=>{
 assert.equal(DEFAULT_WEAPON_ID,'axe');
 assert.deepEqual(Object.keys(WEAPON_PROFILES),['axe','axe_crescent']);
 const p=weaponProfile();
 assert.equal(p,WEAPON_PROFILES.axe);
 assert.equal(p.asset,SHARED_AXE_ASSET);
 assert.equal(p.socket,'handRight');
 assert.equal(p.gripNodePrefix,'AXE_GRIP');
 assert.equal(p.animation,'Chop2');
 assert.equal(p.basePlaybackRate,CHOP_SPEED);
 assert.equal(p.basePlaybackRate,1.6);
 assert.deepEqual(p.contact,{frame:25,fps:30});
 assert.equal(p.range,2);
 assert.equal(p.treeSearchRange,6);
 assert.equal(p.structureRange,2);
 assert.equal(p.structureHalfWidth,1.25);
 assert.equal(p.baseDamage,1);
 assert.equal(p.cooldownPaddingMs,35);
 assert.equal(p.swingEndPaddingMs,30);
 assert.ok(p.sectorHalfAngleDeg>0&&p.sectorHalfAngleDeg<=180);
 assert.ok(p.turnRateRadPerSecond>0);
 assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.contact));
 assert.equal(weaponProfileForAnimation(p.animation),p);
 assert.equal(weaponProfile('axe'),p);
 assert.equal(weaponProfile('nonexistent'),null);
 assert.equal(weaponProfile('__proto__'),null);
 assert.equal(weaponProfileForAnimation('Idle'),null);
 for(const model of CHARACTER_MODELS)assert.ok(['legacy','male','female'].includes(model));
});

test('serpentine crescent axe is a separate GLB/profile with damage 3 and unchanged reach',()=>{
 const original=weaponProfile('axe'),crescent=weaponProfile('axe_crescent');
 assert.notEqual(original,crescent);
 assert.equal(crescent.id,'axe_crescent');
 assert.match(crescent.asset,/characters\/humanoid\/game\/axe_crescent_low\.glb\?/);
 assert.ok(!crescent.asset.includes('/axe_crescent.glb'),
  'the actual game profile must load the LOW asset, not the HIGH one');
 assert.equal(crescent.socket,original.socket);
 assert.equal(crescent.gripNodePrefix,'AXE_GRIP_CRESCENT_LOW');
 assert.equal(crescent.animation,original.animation,'uses each actor own Chop2 bank');
 assert.equal(crescent.basePlaybackRate,original.basePlaybackRate);
 assert.deepEqual(crescent.contact,original.contact);
 assert.equal(crescent.range,original.range,'player does not need to step closer');
 assert.equal(crescent.range,2);
 assert.equal(crescent.structureRange,2);
 assert.equal(crescent.baseDamage,3);
 assert.equal(weaponDamage(crescent),3);
 assert.equal(weaponProfileForAnimation('Chop2'),original);
 assert.ok(Object.isFrozen(crescent)&&Object.isFrozen(crescent.contact));
});

test('all upgrade tiers preserve the current damage, swing and cooldown formulas',()=>{
 const p=WEAPON_PROFILES.axe;
 for(const tier of AXE_STATS){
  const actualRate=weaponPlaybackSpeed(p,tier.speed);
  assert.equal(actualRate,1.6*tier.speed);
  assert.equal(weaponDamage(p,tier.damage),tier.damage);
  assert.equal(weaponDamage(p,tier.damage,1.25),tier.damage*1.25);
  const expected=(46/30)/(1.6*tier.speed)*1000+35;
  assert.ok(Math.abs(weaponCooldownMs(p,46/30,tier.speed)-expected)<1e-7);
  assert.ok(Math.abs(weaponCooldownMs(p,undefined,tier.speed)-expected)<1e-7);
 }
 assert.ok(Math.abs(weaponPlaybackSpeed(p,.01)-.16)<1e-12,'legacy minimum animation multiplier');
 assert.equal(weaponPlaybackSpeed(p,1,1),1,'headless/legacy CHOP_SPEED override');
 assert.equal(weaponDamage(p),1);
 assert.equal(weaponCooldownMs(p,0,1),weaponCooldownMs(p,undefined,1));
});

test('a different attack profile works without assuming Chop2 or 30 FPS',()=>{
 const mock=Object.freeze({
  id:'sword',animation:'Slash',contact:Object.freeze({frame:10,fps:20}),
  fallbackClipDuration:1.2,basePlaybackRate:1.25,baseDamage:3,
  cooldownPaddingMs:80,
 });
 assert.equal(chopContactClipTime(mock),.5);
 assert.equal(chopContactReached({time:.499},0,9999,1.25,mock),false);
 assert.equal(chopContactReached({time:.5},0,0,1.25,mock),true);
 assert.equal(chopContactReached(null,1000,1399,1.25,mock),false);
 assert.equal(chopContactReached(null,1000,1400,1.25,mock),true);
 assert.equal(weaponPlaybackSpeed(mock,1.4),1.75);
 assert.equal(weaponCooldownMs(mock,2,1.4),2/1.75*1000+80);
 assert.equal(weaponDamage(mock,4,1.5),6);
});

test('generic equip switches grip nodes, supports holstering and refuses unknown gear',()=>{
 const axe={visible:false},future={visible:false};
 const grips=new Map([['axe',axe],['sword',future]]);
 assert.equal(equipWeaponGrips(grips,'axe'),true);
 assert.deepEqual([axe.visible,future.visible],[true,false]);
 assert.equal(equipWeaponGrips(grips,'sword'),true);
 assert.deepEqual([axe.visible,future.visible],[false,true]);
 assert.equal(equipWeaponGrips(grips,'missing'),false);
 assert.deepEqual([axe.visible,future.visible],[false,true],'invalid equip does not alter current gear');
 assert.equal(equipWeaponGrips(grips,null),true);
 assert.deepEqual([axe.visible,future.visible],[false,false]);
});

test('gameplay consumes profile descriptors without enabling ORI-06 sector validation',()=>{
 const animation=readFileSync(new URL('../src/animations.js',import.meta.url),'utf8');
 const chopping=readFileSync(new URL('../src/chopping.js',import.meta.url),'utf8');
 assert.match(animation,/for\(const profile of Object\.values\(WEAPON_PROFILES\)\)/);
 assert.match(animation,/loadWeaponAsset\(profile\)/);
 assert.match(animation,/human\.attach\(profile\.socket,grip\.clone\(true\),/);
 assert.match(animation,/setEquippedWeapon\(id\)/);
 assert.match(animation,/weaponPlaybackSpeed\(profile,axeSpeed\)/);
 assert.match(chopping,/weaponCooldownMs\(profile,clipDuration,axeSpeed,ctx\.CHOP_SPEED\)/);
 assert.match(chopping,/chopContactReached\(action,swing\.startedAt,now,swing\.playbackSpeed,swing\.profile\)/);
 assert.match(chopping,/weaponDamage\(swing\.profile,ctx\.inventory\?\.axe\?\.damage,ctx\.vitals\?\.damageMultiplier\)/);
 assert.match(chopping,/dist=profile\.range/);
 assert.doesNotMatch(chopping,/sectorHalfAngleDeg|turnRateRadPerSecond/);
});


test('exported crescent GLB reflects edited Blender scene: no swept razor edge objects',()=>{
 const asset=readFileSync(new URL('../characters/humanoid/game/axe_crescent.glb',import.meta.url));
 assert.equal(asset.toString('ascii',0,4),'glTF');
 const jsonLength=asset.readUInt32LE(12);
 const gltf=JSON.parse(asset.toString('utf8',20,20+jsonLength));
 assert.equal(gltf.skins?.length??0,0);
 assert.equal(gltf.animations?.length??0,0);
 assert.ok(gltf.meshes.length>20);
 assert.equal(gltf.nodes.filter(n=>n.name?.startsWith('AXE_GRIP_CRESCENT')).length,1);
 assert.ok(gltf.nodes.every(n=>!n.name?.includes('Blade | sweeping razor edge')),
  'Deleted edge objects must not be exported back into the game');
 const tris=gltf.meshes.reduce((sum,mesh)=>sum+mesh.primitives.reduce((subtotal,primitive)=>{
  assert.equal(primitive.mode??4,4,'axe meshes must use triangle primitives');
  return subtotal+gltf.accessors[primitive.indices].count/3;
 },0),0);
 assert.equal(tris,21156,'uniform resizing must preserve authored geometry');
 assert.equal(gltf.meshes.length,34);
 const original=readFileSync(new URL('../characters/humanoid/game/axe_shared.glb',import.meta.url));
 const originalSize=original.readUInt32LE(12);
 const source=JSON.parse(original.toString('utf8',20,20+originalSize));
 const parent=gltf.nodes.find(n=>n.name?.startsWith('AXE_GRIP_CRESCENT'));
 const reference=source.nodes.find(n=>n.name?.startsWith('AXE_GRIP'));
 assert.equal(parent.scale.length,3);
 for(const axis of parent.scale)
  assert.ok(Math.abs(axis-.81/1.06)<1e-6,
   'the detailed axe handle must measure ~0.81m');
 assert.equal(reference.scale.every(axis=>Math.abs(axis-1)<1e-6),true,
  'regular axe must retain original scale');
 for(const field of ['rotation','translation']){
  assert.equal(parent[field].length,reference[field].length);
  parent[field].forEach((value,i)=>
   assert.ok(Math.abs(value-reference[field][i])<1e-5,
    'identical grip transform ensures same socket mounting'));
 }
});


test('crescent steel head is flipped 180 degrees relative to unchanged wooden handle',()=>{
 const raw=readFileSync(new URL('../characters/humanoid/game/axe_crescent.glb',import.meta.url));
 const jsonLength=raw.readUInt32LE(12);
 const gltf=JSON.parse(raw.toString('utf8',20,20+jsonLength));
 const node=name=>gltf.nodes.find(n=>n.name===name);
 const blade=node('Crescent blade | one-piece forged steel');
 const head=node('Head | blackened forged socket');
 const handle=node('Handle | sculpted dark ash');
 const grip=node('AXE_GRIP_CRESCENT');
 assert.ok(blade?.rotation);
 // 180° quaternion has scalar component w≈0.
 assert.ok(Math.abs(blade.rotation[3])<1e-5,
  'the blade must rotate 180 degrees around the shaft');
 assert.ok(Math.abs(Math.hypot(...blade.rotation.slice(0,3))-1)<1e-5);
 assert.deepEqual(head.rotation,blade.rotation,
  'head socket and its blade must rotate as one assembly');
 assert.equal(handle?.rotation,undefined,
  'the wooden handle must not rotate with the steel head');
 assert.ok(grip,'shared hand attachment is unchanged');
});


test('the equipped crescent model uses the latest saved low-poly GLB',()=>{
 const profile=weaponProfile('axe_crescent');
 const cleanPath=profile.asset.split('?')[0];
 const actual=readFileSync(new URL('../'+cleanPath,import.meta.url));
 const authored=readFileSync(
  new URL('../characters/humanoid/weapons/axe_crescent_low.glb',import.meta.url));
 assert.ok(actual.equals(authored),'the shipped GLB must match the latest authored LOW export');
 assert.ok(actual.byteLength<100000,'the production GLB should be much smaller than high poly');
 const jsonLength=actual.readUInt32LE(12);
 const gltf=JSON.parse(actual.toString('utf8',20,20+jsonLength));
 const triangles=gltf.meshes.reduce((sum,mesh)=>
  sum+mesh.primitives.reduce((n,p)=>n+gltf.accessors[p.indices].count/3,0),0);
 assert.equal(triangles,1752);
 assert.ok(triangles<=2000);
 assert.equal(gltf.meshes.length,34);
 assert.ok(gltf.nodes.some(n=>n.name==='AXE_GRIP_CRESCENT_LOW'));
 assert.ok(gltf.nodes.some(n=>n.name==='GEOMETRY_AXES_Y_HANDLE_X_BLADE_LOW'));
 assert.ok(gltf.nodes.every(n=>n.name!=='AXE_GRIP_CRESCENT'),
  'game asset must not accidentally include the detailed axe');
});

test('low-poly crescent axe keeps details and original socket under 2k triangles',()=>{
 const raw=readFileSync(new URL('../characters/humanoid/weapons/axe_crescent_low.glb',import.meta.url));
 assert.equal(raw.toString('ascii',0,4),'glTF');
 const len=raw.readUInt32LE(12);
 const gltf=JSON.parse(raw.toString('utf8',20,20+len));
 const total=gltf.meshes.reduce((count,m)=>count+m.primitives.reduce((sum,p)=>{
  assert.equal(p.mode??4,4,'triangle-only meshes');
  return sum+gltf.accessors[p.indices].count/3;
 },0),0);
 assert.equal(total,1752);
 assert.ok(total<=2000,'low-poly budget must be respected by the exported GLB');
 const smallBlade=gltf.meshes.find(m=>m.name.startsWith('Poll | compact hammered counterweight'));
 assert.ok(smallBlade,'the lower secondary blade must be exported');
 const secondaryBladeTris=smallBlade.primitives.reduce(
  (total,part)=>total+gltf.accessors[part.indices].count/3,0);
 assert.ok(secondaryBladeTris>=100,
  'small blade must retain its connecting bevel geometry in the GLB');
 assert.equal(gltf.meshes.length,34);
 assert.equal(gltf.skins?.length??0,0);
 assert.equal(gltf.animations?.length??0,0);
 assert.ok(gltf.nodes.every(n=>!n.name?.includes('Blade | sweeping razor edge')));
 const root=gltf.nodes.find(n=>n.name==='AXE_GRIP_CRESCENT_LOW');
 assert.ok(root,'editable low-poly grip root must exist');
 assert.ok(root.scale.every(v=>Math.abs(v-.81/1.06)<1e-5));
 const hi=readFileSync(new URL('../characters/humanoid/game/axe_crescent.glb',import.meta.url));
 const high=JSON.parse(hi.toString('utf8',20,20+hi.readUInt32LE(12)));
 const hiRoot=high.nodes.find(n=>n.name==='AXE_GRIP_CRESCENT');
 assert.ok(hiRoot,'high-poly grip must still be exportable');
 assert.ok(hiRoot.scale.every((v,i)=>Math.abs(v-root.scale[i])<1e-5));
 for(const field of ['translation','rotation']){
  assert.deepEqual(root[field].map(v=>Math.round(v*1e4)),
   hiRoot[field].map(v=>Math.round(v*1e4)),
   'both variants must share hand socket placement and orientation');
 }
 assert.ok(raw.byteLength<hi.byteLength/2,
  'the low-poly GLB should be significantly smaller');
});
