import {SHARED_AXE_ASSET} from './character-model-selection.js';

// The animation bank belongs to each character, not to the weapon.
// A weapon profile selects the common *name* of that animation and the
// metadata needed to play it. Future weapon types can provide their own
// mesh, socket, contact timing and reach without creating a new actor rig.
//
// NOTE: sectorHalfAngleDeg/turnRateRadPerSecond are descriptors for ORI-06.
// They are deliberately NOT enforced by the current tree hit logic.
export const DEFAULT_WEAPON_ID='axe';

export const WEAPON_PROFILES=Object.freeze({
 axe:Object.freeze({
  id:'axe',
  asset:SHARED_AXE_ASSET,
  socket:'handRight',
  gripNodePrefix:'AXE_GRIP',
  animation:'Chop2',
  basePlaybackRate:1.6,
  fallbackClipDuration:46/30,
  contact:Object.freeze({frame:25,fps:30}),
  range:2,
  treeSearchRange:6,
  structureRange:2,
  structureHalfWidth:1.25,
  sectorHalfAngleDeg:60,
  turnRateRadPerSecond:2.5,
  baseDamage:1,
  cooldownPaddingMs:35,
  swingEndPaddingMs:30,
 }),
 axe_crescent:Object.freeze({
  id:'axe_crescent',
  asset:'characters/humanoid/game/axe_crescent.glb?v=20261105-head-180-1',
  socket:'handRight',
  gripNodePrefix:'AXE_GRIP_CRESCENT',
  animation:'Chop2',
  basePlaybackRate:1.6,
  fallbackClipDuration:46/30,
  contact:Object.freeze({frame:25,fps:30}),
  range:2,
  treeSearchRange:6,
  structureRange:2,
  structureHalfWidth:1.25,
  sectorHalfAngleDeg:60,
  turnRateRadPerSecond:2.5,
  baseDamage:3,
  cooldownPaddingMs:35,
  swingEndPaddingMs:30,
 }),
});

const PROFILES_BY_ANIMATION=new Map();
for(const profile of Object.values(WEAPON_PROFILES)){
 // Multiple weapon models may share their model-specific swing animation.
 // Keep the first matching profile as canonical for animation transitions.
 if(!PROFILES_BY_ANIMATION.has(profile.animation))
  PROFILES_BY_ANIMATION.set(profile.animation,profile);
}

export function weaponProfile(id=DEFAULT_WEAPON_ID){
 return Object.hasOwn(WEAPON_PROFILES,id)?WEAPON_PROFILES[id]:null;
}

export function weaponProfileForAnimation(name){
 return PROFILES_BY_ANIMATION.get(name)??null;
}

// Inventory upgrade tiers contribute multipliers; the base animation speed
// lives only in the profile. The optional base override preserves the old
// CHOP_SPEED injection hook used by game contexts and headless test fixtures.
export function weaponPlaybackSpeed(profile,tierSpeed=1,baseRate=profile.basePlaybackRate){
 const speed=Number.isFinite(tierSpeed)?Math.max(.1,tierSpeed):1;
 const rate=Number.isFinite(baseRate)&&baseRate>0?baseRate:profile.basePlaybackRate;
 return rate*speed;
}

export function weaponCooldownMs(
 profile,clipDuration=profile.fallbackClipDuration,tierSpeed=1,baseRate=profile.basePlaybackRate,
){
 const duration=Number.isFinite(clipDuration)&&clipDuration>0
  ?clipDuration:profile.fallbackClipDuration;
 return duration/weaponPlaybackSpeed(profile,tierSpeed,baseRate)*1000+
   profile.cooldownPaddingMs;
}

export function weaponDamage(profile,tierDamage=profile.baseDamage,multiplier=1){
 const damage=Number.isFinite(tierDamage)?tierDamage:profile.baseDamage;
 const scale=Number.isFinite(multiplier)?multiplier:1;
 return damage*scale;
}


// Equipment operates on named socket grips, not on mesh names or body types.
// This works for one axe now and for additional registered weapon models later.
export function equipWeaponGrips(grips,id){
 if(id!==null&&!grips.has(id))return false;
 for(const [weaponId,grip] of grips)grip.visible=weaponId===id;
 return true;
}
