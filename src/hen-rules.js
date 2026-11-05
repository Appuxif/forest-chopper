// Compatibility adapter for saves/tests made before the mob registry.
import {createMobPopulation} from './mob-population.js';
import {CHICKEN_TYPE} from './mob-types.js';
export function createHenWorld(options={}){return createMobPopulation({...options,definition:CHICKEN_TYPE,legacySnapshot:true});}
export function validateHenSnapshot(value,expectedSeed=value?.seed){return !!value&&Number.isFinite(Number(expectedSeed))&&createHenWorld({seed:Number(expectedSeed)}).restore(value);}
const s=CHICKEN_TYPE.spawn,a=CHICKEN_TYPE.animations;
export const HEN_RULES=Object.freeze({CELL_SIZE:s.cellSize,HEN_RADIUS:s.activeRadius,MAX_ACTIVE:s.liveLimit,MAX_CORPSES:s.corpseLimit,RESPAWN_SECONDS:s.respawnSeconds,CORPSE_TTL_MS:s.corpseTTLSeconds*1000,SPEEDS:{[a.walk]:CHICKEN_TYPE.stats.speeds.walk,[a.fast]:CHICKEN_TYPE.stats.speeds.fast,[a.run]:CHICKEN_TYPE.stats.speeds.run},CLIPS:[a.idle,a.walk,a.fast,a.run,...a.forage,a.rest]});
