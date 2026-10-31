import test from 'node:test';
import assert from 'node:assert/strict';
import {SPRUCE_PRESET,BIRCH_PRESET} from '../src/tree-model-presets.js';
import {
  TREE_MODEL_KEY,GRAPHICS_KEY,TREE_FIELDS,TREE_QUALITIES,
  defaultTreeModel,defaultTreeProfiles,sanitizeTreeModel,
  sanitizeTreeProfiles,loadTreeProfiles,saveTreeProfiles,readActiveTreeConfig,
} from '../src/tree-model-config.js';
import {treeModelEditorMarkup} from '../src/tree-model-editor.js';

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
  assert.equal(profiles.high.spruce.branchesPerWhorl[0],7);
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
  assert.equal(spruce.maxTriangles,12000);
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
  profiles.low.spruce.whorls=8;
  profiles.low.spruce.generatorQuality='low';
  profiles.low.birch.branchCount=14;
  profiles.high.spruce.maxTriangles=30000;
  assert.equal(saveTreeProfiles(local,profiles),true);
  local.setItem(GRAPHICS_KEY,JSON.stringify({quality:'low',showFps:true}));
  let active=readActiveTreeConfig(local);
  assert.equal(active.quality,'low');
  assert.equal(active.models.spruce.whorls,8);
  assert.equal(active.models.birch.branchCount,14);
  local.setItem(GRAPHICS_KEY,JSON.stringify({quality:'balanced'}));
  active=readActiveTreeConfig(local);
  assert.equal(active.models.spruce.whorls,13);
  assert.equal(active.models.birch.branchCount,28);
  local.setItem(GRAPHICS_KEY,JSON.stringify({quality:'high'}));
  active=readActiveTreeConfig(local);
  assert.equal(active.models.spruce.maxTriangles,30000);
  assert.equal(active.models.spruce.whorls,13);
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
