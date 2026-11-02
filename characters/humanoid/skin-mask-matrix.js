/** The only body-skin visibility rule: item id -> authored UV PNG mask names.
 * White = visible, black = hidden. Missing assignment => fully visible.
 * Pure helpers shared with the browser renderer and unit tests.
 */
export const BODY_MASK_SLOTS=Object.freeze(['underwear','bra','top','bottom','shoes','outerwear']);
export function outfitMaskNames(matrix,gender,equipped){
  if(!['male','female'].includes(gender))throw Error(`Unknown skin mask gender: ${gender}`);
  const perGender=matrix?.[gender]??{};
  const names=new Set();
  for(const slot of BODY_MASK_SLOTS){
    const id=equipped?.[slot];
    if(!id)continue;
    const assigned=perGender[id]??[];
    if(!Array.isArray(assigned))throw Error(`Invalid mask matrix entry: ${gender}/${id}`);
    for(const name of assigned){
      if(typeof name!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name))
        throw Error(`Invalid mask name in ${gender}/${id}`);
      names.add(name);
    }
  }
  return [...names].sort();
}
