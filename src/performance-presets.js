// Graphics-only settings: never mutate world seed, gameplay, inventory or camera controls.
export const PERFORMANCE_PRESETS=Object.freeze({
  ultra:{quality:'high',maxFps:0,renderScale:110,treeShadowsEnabled:true,
    shadowDistance:250,shadowRefreshSeconds:0,shadowMapSize:2048,shadowContrast:100,characterShadowsEnabled:true,
    characterShadowDistance:55,windEnabled:true,spruceFoliageVisible:true,spruceFoliageShadows:true,treeTrianglesSpruce:18000,
    treeTrianglesBirch:9000,spruceFoliageDensity:100,
    grassDensity:30,grassClusterBlades:3,grassDistance:100,grassTriangles:6,grassInteraction:true,grassMinSize:2.5,grassMaxSize:5.5,grassWidth:1,grassFullDensityDistance:10,grassFarDensityPercent:0,grassFarWidthBonus:30,grassDensitySharpness:.0001,grassDensityCoefficient:0,grassDensityOffset:30,grassTurnMin:-30,grassTurnMax:30,grassFarFacingEnabled:false,grassFarFacingStrength:80,grassFarFacingDistance:20,
    detailedTreeRadius:4,farForestDistance:200,viewDistance:320,
    lakeForestMode:'full',lakeVisibility:true,lakeViewDistance:450,
    farTreeDensity:100,farSpruceTriangles:3000,farBirchTriangles:1500,
    terrainSegments:48,waterQuality:'high',decorDensity:100,antialias:true},
  high:{quality:'high',maxFps:0,renderScale:95,treeShadowsEnabled:true,
    shadowDistance:60,shadowRefreshSeconds:20,shadowMapSize:2048,shadowContrast:100,characterShadowsEnabled:true,
    characterShadowDistance:62,windEnabled:true,spruceFoliageVisible:true,spruceFoliageShadows:true,treeTrianglesSpruce:10000,
    treeTrianglesBirch:6500,spruceFoliageDensity:100,
    grassDensity:30,grassClusterBlades:2,grassDistance:100,grassTriangles:6,grassInteraction:true,grassMinSize:2.5,grassMaxSize:5.5,grassWidth:1,grassFullDensityDistance:10,grassFarDensityPercent:0,grassFarWidthBonus:30,grassDensitySharpness:.000001,grassDensityCoefficient:0,grassDensityOffset:30,grassTurnMin:-30,grassTurnMax:30,grassFarFacingEnabled:true,grassFarFacingStrength:80,grassFarFacingDistance:20,
    detailedTreeRadius:2,farForestDistance:160,viewDistance:280,
    lakeForestMode:'shore',lakeVisibility:true,lakeViewDistance:380,
    farTreeDensity:50,farSpruceTriangles:2000,farBirchTriangles:1200,
    terrainSegments:48,waterQuality:'high',decorDensity:50,antialias:false},
  medium:{quality:'low',maxFps:60,renderScale:80,treeShadowsEnabled:true,
    shadowDistance:90,shadowRefreshSeconds:5,shadowMapSize:512,shadowContrast:100,characterShadowsEnabled:true,
    characterShadowDistance:25,windEnabled:true,spruceFoliageVisible:true,spruceFoliageShadows:true,treeTrianglesSpruce:6000,
    treeTrianglesBirch:3000,spruceFoliageDensity:70,
    grassDensity:25,grassClusterBlades:1,grassDistance:60,grassTriangles:3,grassInteraction:true,grassMinSize:2.5,grassMaxSize:5.5,grassWidth:1,grassFullDensityDistance:10,grassFarDensityPercent:0,grassFarWidthBonus:30,grassDensitySharpness:.000001,grassDensityCoefficient:0,grassDensityOffset:30,grassTurnMin:-30,grassTurnMax:30,grassFarFacingEnabled:true,grassFarFacingStrength:80,grassFarFacingDistance:20,
    detailedTreeRadius:3,farForestDistance:140,viewDistance:230,
    lakeForestMode:'off',lakeVisibility:false,lakeViewDistance:230,
    farTreeDensity:75,farSpruceTriangles:1500,farBirchTriangles:1200,
    terrainSegments:32,waterQuality:'simple',decorDensity:75,antialias:false},
  low:{quality:'low',maxFps:30,renderScale:65,treeShadowsEnabled:false,
    shadowDistance:60,shadowRefreshSeconds:5,shadowMapSize:512,shadowContrast:100,characterShadowsEnabled:false,
    characterShadowDistance:10,windEnabled:false,spruceFoliageVisible:true,spruceFoliageShadows:false,treeTrianglesSpruce:2000,
    treeTrianglesBirch:1200,spruceFoliageDensity:40,
    grassDensity:20,grassClusterBlades:1,grassDistance:30,grassTriangles:1,grassInteraction:false,grassMinSize:2.5,grassMaxSize:5.5,grassWidth:1,grassFullDensityDistance:10,grassFarDensityPercent:0,grassFarWidthBonus:30,grassDensitySharpness:.000001,grassDensityCoefficient:0,grassDensityOffset:30,grassTurnMin:-30,grassTurnMax:30,grassFarFacingEnabled:true,grassFarFacingStrength:80,grassFarFacingDistance:20,
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


// Per-preset lighting overrides are kept separate from PERFORMANCE_KEYS, so
// selecting another graphics preset retains its historical lighting behaviour.
// High contains the user's reviewed render, light and shadow configuration.
export const PERFORMANCE_LIGHTING_PRESETS=Object.freeze({
 high:Object.freeze({
  dayAmbient:1.2,daySun:2,nightAmbient:0,nightMoon:0,nightViewDistance:60,
  fireShadowLimit:4,
  sunNearShadowDistance:20,sunNearShadowMapSize:2048,
  sunCascadeBlendDistance:10,sunCascadeCasterOverlap:4,
  sunNearShadowSoftness:1,sunFarShadowSoftness:1,
  campfireDayIntensity:5,campfireNightIntensity:10,
  campfireDayRadius:7,campfireNightRadius:7,
  campfireShadowVisibilityDistance:60,campfireVisibilityDistance:30,
  campfireActivationDistance:60,campfireDecay:1,campfireLightHeight:1.5,
  torchDayIntensity:5,torchNightIntensity:8,
  torchDayRadius:3,torchNightRadius:9,
  torchShadowVisibilityDistance:60,torchVisibilityDistance:30,
  torchActivationDistance:60,torchDecay:1,torchLightHeight:2.8,
  flameShader:true,flameBillboard:false,
  fireShadows:true,nightDisableMoonShadows:true,
 }),
});
