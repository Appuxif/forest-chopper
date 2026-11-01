import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPE_TABS,RECIPE_PAGES,recipeAvailable,recipeById} from '../src/recipe-book.js';
import {createInventoryModel} from '../src/inventory.js';
test('recipe book has category tabs, two executable recipes and future construction plans',()=>{
 assert.deepEqual(RECIPE_TABS.map(t=>t.id),['tools','alchemy','structures','free']);
 assert.deepEqual(RECIPE_PAGES.filter(r=>r.craftable).map(r=>r.id),['axe','bench','chest','rack','potion:health','potion:stamina','campfire','torch','table','fence','workbench']);
 assert.equal(RECIPE_PAGES.filter(r=>r.tab==='structures').length,9);
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
