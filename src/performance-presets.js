// Graphics-only settings: never mutate world seed, gameplay, inventory or camera controls.
export const PERFORMANCE_PRESETS=Object.freeze({
  ultra:{quality:'high',maxFps:0,renderScale:110,treeShadowsEnabled:true,
    shadowDistance:100,shadowRefreshSeconds:0,shadowMapSize:2048,shadowContrast:70,characterShadowsEnabled:true,
    characterShadowDistance:55,windEnabled:true,spruceFoliageVisible:true,spruceFoliageShadows:true,treeTrianglesSpruce:18000,
    treeTrianglesBirch:9000,spruceFoliageDensity:100,
    grassDensity:30,grassDistance:100,grassTriangles:6,grassInteraction:true,grassMinSize:2.5,grassMaxSize:5.5,grassWidth:1,grassTurnMin:-30,grassTurnMax:30,
    detailedTreeRadius:4,farForestDistance:200,viewDistance:320,
    lakeForestMode:'full',lakeVisibility:true,lakeViewDistance:450,
    farTreeDensity:100,farSpruceTriangles:3000,farBirchTriangles:1500,
    terrainSegments:48,waterQuality:'high',decorDensity:100,antialias:true},
  high:{quality:'balanced',maxFps:60,renderScale:100,treeShadowsEnabled:true,
    shadowDistance:60,shadowRefreshSeconds:1,shadowMapSize:1024,shadowContrast:70,characterShadowsEnabled:true,
    characterShadowDistance:30,windEnabled:true,spruceFoliageVisible:true,spruceFoliageShadows:true,treeTrianglesSpruce:12000,
    treeTrianglesBirch:6500,spruceFoliageDensity:100,
    grassDensity:30,grassDistance:70,grassTriangles:6,grassInteraction:true,grassMinSize:2.5,grassMaxSize:5.5,grassWidth:1,grassTurnMin:-30,grassTurnMax:30,
    detailedTreeRadius:3,farForestDistance:165,viewDistance:280,
    lakeForestMode:'shore',lakeVisibility:true,lakeViewDistance:380,
    farTreeDensity:100,farSpruceTriangles:2000,farBirchTriangles:1200,
    terrainSegments:48,waterQuality:'high',decorDensity:100,antialias:true},
  medium:{quality:'low',maxFps:60,renderScale:80,treeShadowsEnabled:true,
    shadowDistance:40,shadowRefreshSeconds:5,shadowMapSize:512,shadowContrast:70,characterShadowsEnabled:true,
    characterShadowDistance:25,windEnabled:true,spruceFoliageVisible:true,spruceFoliageShadows:true,treeTrianglesSpruce:6000,
    treeTrianglesBirch:3000,spruceFoliageDensity:70,
    grassDensity:20,grassDistance:50,grassTriangles:3,grassInteraction:true,grassMinSize:2.5,grassMaxSize:5.5,grassWidth:1,grassTurnMin:-30,grassTurnMax:30,
    detailedTreeRadius:3,farForestDistance:140,viewDistance:230,
    lakeForestMode:'off',lakeVisibility:false,lakeViewDistance:230,
    farTreeDensity:75,farSpruceTriangles:1500,farBirchTriangles:1200,
    terrainSegments:32,waterQuality:'simple',decorDensity:75,antialias:false},
  low:{quality:'low',maxFps:30,renderScale:65,treeShadowsEnabled:false,
    shadowDistance:20,shadowRefreshSeconds:5,shadowMapSize:512,shadowContrast:70,characterShadowsEnabled:false,
    characterShadowDistance:10,windEnabled:false,spruceFoliageVisible:true,spruceFoliageShadows:false,treeTrianglesSpruce:2000,
    treeTrianglesBirch:1200,spruceFoliageDensity:40,
    grassDensity:10,grassDistance:30,grassTriangles:1,grassInteraction:false,grassMinSize:2.5,grassMaxSize:5.5,grassWidth:1,grassTurnMin:-30,grassTurnMax:30,
    detailedTreeRadius:2,farForestDistance:110,viewDistance:180,
    lakeForestMode:'off',lakeVisibility:false,lakeViewDistance:180,
    farTreeDensity:50,farSpruceTriangles:1000,farBirchTriangles:800,
    terrainSegments:24,waterQuality:'simple',decorDensity:50,antialias:false},
});
export const PERFORMANCE_KEYS=Object.freeze(Object.keys(PERFORMANCE_PRESETS.high));
export const PERFORMANCE_DEFAULTS=PERFORMANCE_PRESETS.high;
export function presetSettings(name){
  return PERFORMANCE_PRESETS[name] ? {...PERFORMANCE_PRESETS[name]} : null;
}
