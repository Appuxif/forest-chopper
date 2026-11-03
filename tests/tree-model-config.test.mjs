import test from 'node:test';
import assert from 'node:assert/strict';
import {SPRUCE_PRESET,BIRCH_PRESET} from '../src/tree-model-presets.js';
import {
  TREE_MODEL_KEY,GRAPHICS_KEY,SPRUCE_PROFILE_MIGRATION_KEY,BIRCH_PROFILE_MIGRATION_KEY,TREE_FIELDS,TREE_QUALITIES,
  defaultTreeModel,defaultTreeProfiles,sanitizeTreeModel,limitSpruceModelTriangles,limitTreeModelTriangles,
  sanitizeTreeProfiles,loadTreeProfiles,saveTreeProfiles,readActiveTreeConfig,
} from '../src/tree-model-config.js';
import {treeModelEditorMarkup} from '../src/tree-model-editor.js';
import {PERFORMANCE_PRESETS} from '../src/performance-presets.js';

function storage(){
  const records=new Map();
  return {
    records,
    getItem:key=>records.get(key)??null,
    setItem:(key,value)=>records.set(key,value),
  };
}
test('default UI presets mirror every active generator parameter',()=>{
  const spruce=defaultTreeModel('spruce'),birch=defaultTreeModel('birch');
  for(const [key,value] of Object.entries(SPRUCE_PRESET.params))
    if(key!=='trunkStyle')assert.deepEqual(spruce[key],value,'spruce '+key);
  for(const [key,value] of Object.entries(BIRCH_PRESET.params))
    assert.deepEqual(birch[key],value,'birch '+key);
  assert.deepEqual(Object.keys(TREE_FIELDS.spruce).sort(),Object.keys(spruce).sort());
  assert.deepEqual(Object.keys(TREE_FIELDS.birch).sort(),Object.keys(birch).sort());
  const profiles=defaultTreeProfiles();
  for(const quality of TREE_QUALITIES){
    assert.deepEqual(profiles[quality].spruce,spruce);
    assert.deepEqual(profiles[quality].birch,birch);
  }
  profiles.low.spruce.branchesPerWhorl[0]=0;
  assert.equal(profiles.high.spruce.branchesPerWhorl[0],6);
});
test('numeric, colors, booleans and branches array validate untrusted imported JSON',()=>{
  const spruce=sanitizeTreeModel('spruce',{
    whorls:12,cardCountPerBranch:0,generatorQuality:'high',
    barkColor:'#AbC123',cardCrossed:false,
    branchesPerWhorl:[0,3,10],
    maxTriangles:1e9,showFoliage:'false',
    seed:NaN,other:'unexpected',
  });
  assert.equal(spruce.whorls,12);
  assert.equal(spruce.cardCountPerBranch,SPRUCE_PRESET.params.cardCountPerBranch);
  assert.equal(spruce.generatorQuality,'high');
  assert.equal(spruce.barkColor,'#abc123');
  assert.equal(spruce.cardCrossed,false);
  assert.deepEqual(spruce.branchesPerWhorl,[0,3,10]);
  assert.equal(spruce.maxTriangles,5000);
  assert.equal(spruce.showFoliage,true);
  assert.equal(spruce.seed,7);
  assert.equal(spruce.other,undefined);
  assert.deepEqual(sanitizeTreeModel('birch',{branchCount:9999,seed:-1,leafColor:'red'}),
    defaultTreeModel('birch'));
  assert.deepEqual(sanitizeTreeModel('spruce',{branchesPerWhorl:[-1]}).branchesPerWhorl,
    SPRUCE_PRESET.params.branchesPerWhorl);
  assert.deepEqual(sanitizeTreeModel('birch',{showFoliage:false}).showFoliage,false);
});
test('editing Low does not change Balanced or High, active quality selects its own models',()=>{
  const local=storage();
  const profiles=loadTreeProfiles(local);
  profiles.low.spruce.whorls=10;
  profiles.low.spruce.generatorQuality='low';
  profiles.low.birch.branchCount=14;
  profiles.high.spruce.maxTriangles=30000;
  assert.equal(saveTreeProfiles(local,profiles),true);
  local.setItem(GRAPHICS_KEY,JSON.stringify({quality:'low',showFps:true}));
  let active=readActiveTreeConfig(local);
  assert.equal(active.quality,'low');
  assert.equal(active.models.spruce.whorls,10);
  assert.equal(active.models.birch.branchCount,14);
  local.setItem(GRAPHICS_KEY,JSON.stringify({quality:'balanced'}));
  active=readActiveTreeConfig(local);
  assert.equal(active.models.spruce.whorls,8);
  assert.equal(active.models.birch.branchCount,15);
  local.setItem(GRAPHICS_KEY,JSON.stringify({quality:'high'}));
  active=readActiveTreeConfig(local);
  assert.equal(active.models.spruce.maxTriangles,30000);
  assert.equal(active.models.spruce.whorls,8);
  assert.equal(local.records.has(TREE_MODEL_KEY),true);
  assert.deepEqual(sanitizeTreeProfiles({low:{spruce:{seed:42}}}).balanced,
    defaultTreeProfiles().balanced);
});
test('invalid JSON and unavailable storage restore safe original generator defaults',()=>{
  const local=storage();
  local.setItem(TREE_MODEL_KEY,'{broken');
  local.setItem(GRAPHICS_KEY,'{broken');
  assert.deepEqual(readActiveTreeConfig(local),{quality:'balanced',models:defaultTreeProfiles().balanced});
  assert.deepEqual(readActiveTreeConfig(null),{quality:'balanced',models:defaultTreeProfiles().balanced});
});
test('editor includes controls for all real keys, profiles, import/export and apply',()=>{
  const html=treeModelEditorMarkup();
  for(const species of ['spruce','birch']){
    assert.ok(html.includes('data-tree-species-panel="'+species+'"'));
    for(const key of Object.keys(TREE_FIELDS[species]))
      assert.ok(html.includes('data-tree-param="'+key+'"'),species+' '+key);
  }
  for(const quality of TREE_QUALITIES)
    assert.match(html,new RegExp('option value="'+quality+'"'));
  for(const action of ['apply','reset','copy','export','import'])
    assert.ok(html.includes('data-tree-action="'+action+'"'));
});


test('reviewed spruce generator settings are the identical default in all three model profiles',()=>{
 const reviewed={
  generatorQuality:'high',
  seed:7,trunkHeight:6,trunkRadius:0.3,barkColor:'#705238',
  branchStartHeight:2.5,whorls:8,
  branchesPerWhorl:[6,6,5,5,5,5,5,4],
  levels:2,crownRatio:0.98,basePitch:-25,topPitch:-10,
  level1Length:2.5,level2LengthFactor:0.5,
  secondaryBranchDensity:2,showSecondaryBranches:false,
  cardCountPerBranch:5,cardLengthScale:2,cardWidthScale:2,
  cardSpread:35,cardCrossed:true,cardAlphaTest:0.45,
  showFoliage:true,leafColor:'#245c36',leafAccent:'#44874d',
  maxTriangles:5000,
 };
 assert.deepEqual(defaultTreeModel('spruce'),reviewed);
 const profiles=defaultTreeProfiles();
 for(const quality of TREE_QUALITIES)
  assert.deepEqual(profiles[quality].spruce,reviewed,quality+' same spruce');
 assert.notStrictEqual(profiles.low.spruce,profiles.high.spruce,
  'profile copies are independently editable after initialization');
 assert.deepEqual(defaultTreeModel('birch'),profiles.low.birch,
  'birch generator remains unchanged');
});

test('migrating existing saved profiles updates all spruces once without touching birches',()=>{
 const local=storage();
 const legacy={
  low:{spruce:{whorls:13,generatorQuality:'low',maxTriangles:12000},
    birch:{branchCount:14}},
  balanced:{spruce:{whorls:13,generatorQuality:'balanced',maxTriangles:12000},
    birch:{branchCount:24}},
  high:{spruce:{whorls:13,generatorQuality:'high',maxTriangles:12000},
    birch:{branchCount:50}},
 };
 local.setItem(TREE_MODEL_KEY,JSON.stringify(legacy));
 local.setItem(BIRCH_PROFILE_MIGRATION_KEY,'1'); // isolate spruce migration
 assert.equal(local.getItem(SPRUCE_PROFILE_MIGRATION_KEY),null);
 const migrated=loadTreeProfiles(local);
 for(const quality of TREE_QUALITIES)
  assert.deepEqual(migrated[quality].spruce,defaultTreeModel('spruce'));
 assert.equal(migrated.low.birch.branchCount,14);
 assert.equal(migrated.balanced.birch.branchCount,24);
 assert.equal(migrated.high.birch.branchCount,50);
 assert.equal(local.getItem(SPRUCE_PROFILE_MIGRATION_KEY),'1');
 assert.deepEqual(JSON.parse(local.getItem(TREE_MODEL_KEY)),migrated);
 migrated.low.spruce.whorls=10;
 assert.equal(saveTreeProfiles(local,migrated),true);
 assert.equal(loadTreeProfiles(local).low.spruce.whorls,10,
  'subsequent user edits are kept, no repeated migration');
 assert.equal(readActiveTreeConfig(local).models.spruce.whorls,8,
  'without saved graphics quality, the balanced profile is active');
});


test('spruce generator 5000-triangle cap is respected by High and Ultra graphics budgets',()=>{
 const spruce=defaultTreeModel('spruce');
 for(const quality of ['ultra','high','medium','low']){
  const graphicsBudget=PERFORMANCE_PRESETS[quality].treeTrianglesSpruce;
  const limited=limitSpruceModelTriangles(spruce,graphicsBudget);
  assert.equal(limited.maxTriangles,Math.min(5000,graphicsBudget),quality);
  assert.equal(limited.generatorQuality,'high','all profiles keep high branch geometry');
 }
 assert.equal(spruce.maxTriangles,5000,'source model is not mutated');
});


test('approved birch generator values are identical in every default model profile',()=>{
 const approved={
  seed:7,trunkHeight:7,trunkRadius:.23,trunkCurve:0,
  barkColor:'#dce0da',barkMarkColor:'#333b38',woodColor:'#514c40',
  branchStartHeight:2.5,branchCount:15,branchLength:2,
  branchPitch:21,branchTopPitch:35,branchDroop:.35,branchCurve:.3,
  shootsPerBranch:3,shootLength:1.4,shootDroop:.7,
  showShootWood:false,cardsPerShoot:3,cardLengthScale:2,
  cardWidthScale:1.5,cardTwist:35,cardCrossed:true,
  cardAlphaTest:.45,leafCount:30,showFoliage:true,
  leafColor:'#4f913e',leafAccent:'#99c965',maxTriangles:6500,
 };
 assert.deepEqual(defaultTreeModel('birch'),approved);
 for(const [quality,models] of Object.entries(defaultTreeProfiles()))
  assert.deepEqual(models.birch,approved,'birch defaults in '+quality);
 assert.deepEqual(sanitizeTreeModel('birch',approved),approved,
  'every supplied value survives sanitization exactly');
});

test('one-time birch migration updates all model profiles but preserves existing spruces',()=>{
 const local=storage();
 const saved=defaultTreeProfiles();
 saved.low.spruce.seed=99;
 saved.balanced.spruce.whorls=10;
 saved.high.spruce.maxTriangles=30000;
 for(const quality of TREE_QUALITIES){
  saved[quality].birch.branchCount=28;
  saved[quality].birch.trunkHeight=8;
  saved[quality].birch.cardAlphaTest=.38;
 }
 local.setItem(TREE_MODEL_KEY,JSON.stringify(saved));
 local.setItem(SPRUCE_PROFILE_MIGRATION_KEY,'1');
 const upgraded=loadTreeProfiles(local);
 for(const quality of TREE_QUALITIES){
  assert.deepEqual(upgraded[quality].birch,defaultTreeModel('birch'));
  assert.deepEqual(upgraded[quality].spruce,saved[quality].spruce,
   'birch migration leaves existing '+quality+' spruce alone');
 }
 assert.equal(local.getItem(BIRCH_PROFILE_MIGRATION_KEY),'1');
 upgraded.high.birch.leafCount=25;
 assert.equal(saveTreeProfiles(local,upgraded),true);
 assert.equal(loadTreeProfiles(local).high.birch.leafCount,25,
  'user changes after migration are not overwritten');
});

test('older browser profile can migrate spruce and birch in one pass',()=>{
 const local=storage();
 const previous=defaultTreeProfiles();
 previous.low.spruce.whorls=13;
 previous.balanced.birch.branchCount=28;
 local.setItem(TREE_MODEL_KEY,JSON.stringify(previous));
 const after=loadTreeProfiles(local);
 for(const quality of TREE_QUALITIES){
  assert.deepEqual(after[quality].spruce,defaultTreeModel('spruce'));
  assert.deepEqual(after[quality].birch,defaultTreeModel('birch'));
 }
 assert.equal(local.getItem(SPRUCE_PROFILE_MIGRATION_KEY),'1');
 assert.equal(local.getItem(BIRCH_PROFILE_MIGRATION_KEY),'1');
});

test('birch maxTriangles from generator remains a cap on every graphics preset',()=>{
 const birch=defaultTreeModel('birch');
 for(const preset of ['low','medium','high','ultra']){
  const graphicsBudget=PERFORMANCE_PRESETS[preset].treeTrianglesBirch;
  const result=limitTreeModelTriangles(birch,graphicsBudget);
  assert.equal(result.maxTriangles,Math.min(6500,graphicsBudget),preset);
 }
 assert.equal(birch.maxTriangles,6500);
});
