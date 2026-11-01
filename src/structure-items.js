import {CAMP_RECIPES} from './camp-rules.js';
export const STORAGE_RECIPES=Object.freeze({chest:{log:2,branch:4},rack:{log:2}});
export const STRUCTURE_RECIPES=Object.freeze({...CAMP_RECIPES,...STORAGE_RECIPES});
export const STRUCTURE_KINDS=Object.freeze(Object.keys(STRUCTURE_RECIPES));
export const isStructureItem=id=>Object.hasOwn(STRUCTURE_RECIPES,id);
export const STRUCTURE_WEIGHT=Object.freeze({
 campfire:18,torch:4,table:18,fence:12,workbench:25,chest:15,rack:16,
});
