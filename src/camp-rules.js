// Reusable, server-validated campsite objects. Ingredient costs match Python.
export const CAMP_RECIPES=Object.freeze({
  campfire:{log:2,stone:3},
  torch:{branch:1,stone:3,dry_grass:1},
  table:{log:3},
  fence:{log:2,branch:2},
  workbench:{log:4,stone:2},
});
export const MAX_CAMP_STRUCTURES=100;
export const validCampStructure=item=>!!item&&Number.isSafeInteger(item.id)&&
  Math.abs(item.id)<=2147483647&&item.id!==0&&Object.hasOwn(CAMP_RECIPES,item.kind)&&
  Number.isFinite(item.x)&&Number.isFinite(item.z)&&Math.abs(item.x)<=240000&&Math.abs(item.z)<=240000&&
  [0,1,2,3].includes(item.orientation)&&typeof item.lit==='boolean'&&
  (['campfire','torch'].includes(item.kind)||item.lit===false);
export const isFireKind=kind=>kind==='campfire'||kind==='torch';
