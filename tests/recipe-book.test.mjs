import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPE_TABS,RECIPE_PAGES,recipeAvailable,recipeById} from '../src/recipe-book.js';
import {createInventoryModel} from '../src/inventory.js';
test('recipe book has category tabs, two executable recipes and future construction plans',()=>{
 assert.deepEqual(RECIPE_TABS.map(t=>t.id),['tools','alchemy','food','structures','free']);
 assert.deepEqual(RECIPE_PAGES.filter(r=>r.craftable).map(r=>r.id),['axe','bench','chest','rack','potion:health','potion:stamina','potion:lumberjack','potion:light_feet','potion:night_vision','food:mushroom_stew','food:herbal_mushroom_stew','alchemy_table','bed','campfire','torch','table','fence','workbench']);
 assert.equal(RECIPE_PAGES.filter(r=>r.tab==='structures').length,11);
 assert.equal(RECIPE_PAGES.filter(r=>r.guide).length,5);
 assert.ok(RECIPE_PAGES.every(r=>r.name&&r.description&&r.icon));
 assert.equal(recipeById('missing'),null);
});
test('recipes react to player material quantities; unavailable entries never craft',()=>{
 const inv=createInventoryModel();
 assert.equal(recipeAvailable(recipeById('bench'),inv),false);
 assert.equal(recipeAvailable(recipeById('campfire'),inv),false);
 inv.addLogs(3);
 assert.equal(recipeAvailable(recipeById('bench'),inv),true);
});

test('potions reward crafting and stamina recipe uses blue plus pink flowers',()=>{
 const health=recipeById('potion:health');
 assert.deepEqual(health.ingredients,{'flower:daisy':2,'mushroom:boletus':1});
 assert.match(health.description,/3 жизни/);
 assert.match(health.description,/1 единицу голода/);
 const stamina=recipeById('potion:stamina');
 assert.deepEqual(stamina.ingredients,{'flower:blue_wildflower':2,'flower:pink_wildflower':2});
 assert.match(stamina.description,/30 секунд/);
 assert.match(stamina.effects.join(' '),/×2/);
 const inventory=createInventoryModel();
 assert.equal(inventory.addItem({id:'flower:blue_wildflower',count:2}),true);
 assert.equal(inventory.addItem({id:'dry_grass',count:2}),true);
 assert.equal(recipeAvailable(stamina,inventory),false,'dry grass is not a reagent');
 assert.equal(inventory.addItem({id:'flower:pink_wildflower',count:2}),true);
 assert.equal(recipeAvailable(stamina,inventory),true,'two blue and two pink flowers craft a potion');
});

test('three experimental potions have required reagents and are locked to alchemy',()=>{
 const specs=[
 ['potion:lumberjack',{'mushroom:fly_agaric':1,'flower:pink_wildflower':2,'flower:daisy':1}],
 ['potion:light_feet',{'flower:blue_wildflower':2,'flower:pink_wildflower':1,'flower:buttercup':1}],
 ['potion:night_vision',{'mushroom:fly_agaric':1,'flower:blue_wildflower':1,'flower:buttercup':1}],
 ];
 for(const [id,reagents] of specs){
  const recipe=recipeById(id);
  assert.equal(recipe.tab,'alchemy');
  assert.equal(recipe.craftable,true);
  assert.deepEqual(recipe.ingredients,reagents);
  assert.ok(recipe.effects.length===2);
 }
});

test('bed recipe uses dry grass and carries a respawn ability',()=>{
 const bed=recipeById('bed');
 assert.deepEqual(bed.ingredients,{log:3,branch:4,dry_grass:5});
 assert.equal(bed.placement,true);
 assert.ok(bed.effects.join(' ').includes('возрождения'));
});
