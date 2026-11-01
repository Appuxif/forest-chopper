// Character selection is independent of WebGL and applies to any world launch.
export const CHARACTER_MODEL_KEY='forest-chopper:character-model:v1';
export const CHARACTER_MODELS=Object.freeze(['legacy','male','female']);
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
