// Character selection is independent of WebGL and applies to any world launch.
export const CHARACTER_MODEL_KEY='forest-chopper:character-model:v1';
// Single data registry for saved character selection, body GLBs, outfit
// capabilities and attachment meshes. New characters only add metadata and
// a 53-bone body; they do not add animation/gameplay model branches.
// Every playable character uses exactly one weapon asset and one handRight
// attachment contract. Per-body profiles only describe body/appearance.
export const SHARED_AXE_ASSET='characters/humanoid/game/axe_shared.glb?v=20261105-shared-axe1';
export const CHARACTER_PROFILES=Object.freeze({
  legacy:Object.freeze({
    file:'game/body_legacy.glb?v=20261105-chop-1812',
    outfit:false,
    // Bone-local, model-authored handRight socket correction for the SAME
    // shared axe. Calibrated against the original 13-bone lumberjack Idle:
    // shaft upright, blade pointing forward, handle seated in the palm.
    // This is socket data, not a model-specific animation/weapon branch.
    handRight:Object.freeze({
      position:Object.freeze([0.01644859,0.08944230,-0.12033857]),
      quaternion:Object.freeze([0.07184081,0.59831154,0.67304476,0.42880417]),
    }),
  }),
  male:Object.freeze({
    file:'game/body_male.glb?v=fc-backrun-root-20261104',
    outfit:true,
  }),
  female:Object.freeze({
    file:'game/body_female.glb?v=fc-backrun-root-20261104',
    outfit:true,
  }),
});
export const CHARACTER_MODELS=Object.freeze(Object.keys(CHARACTER_PROFILES));
export function normalizeCharacterModel(value){
  return CHARACTER_MODELS.includes(value)?value:'legacy';
}
export function readCharacterModel(storage){
  try{return normalizeCharacterModel(storage?.getItem(CHARACTER_MODEL_KEY));}
  catch{return 'legacy';}
}
export function saveCharacterModel(storage,value){
  const model=normalizeCharacterModel(value);
  try{storage?.setItem(CHARACTER_MODEL_KEY,model);}catch{}
  return model;
}
