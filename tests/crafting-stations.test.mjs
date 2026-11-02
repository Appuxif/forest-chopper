import test from 'node:test';
import assert from 'node:assert/strict';
import {CRAFT_STATION_RADIUS,recipeStationKind,nearbyCraftStation,canCraftAtStation} from '../src/crafting-stations.js';
import {recipeById,RECIPE_PAGES,RECIPE_TABS,recipeAvailable} from '../src/recipe-book.js';
import {FOOD_EFFECTS,eatEffect} from '../src/vitals.js';
import {createInventoryModel} from '../src/inventory.js';
import {CAMP_RECIPES,validCampStructure} from '../src/camp-rules.js';

test('all food/alchemy recipes inherit the appropriate 10m workbench requirement',()=>{
 assert.equal(CRAFT_STATION_RADIUS,10);
 assert.deepEqual(RECIPE_TABS.map(x=>x.id),['tools','alchemy','food','structures','free']);
 for(const entry of RECIPE_PAGES.filter(e=>e.tab==='food'))
  assert.equal(recipeStationKind(entry),'campfire',entry.id);
 for(const entry of RECIPE_PAGES.filter(e=>e.tab==='alchemy'))
  assert.equal(recipeStationKind(entry),'alchemy_table',entry.id);
 for(const entry of RECIPE_PAGES.filter(e=>!['food','alchemy'].includes(e.tab)))
  assert.equal(recipeStationKind(entry),null,entry.id);
});

test('station distance uses inclusive circular radius, matches kind, follows player movement',()=>{
 const camp=new Map([[1,{kind:'campfire',x:0,z:0}],[2,{kind:'alchemy_table',x:20,z:0}]]);
 const ctx={px:0,pz:0,campStructures:{items:camp}};
 const stew=recipeById('food:mushroom_stew'),potion=recipeById('potion:health');
 assert.equal(canCraftAtStation(ctx,stew),true);
 assert.equal(canCraftAtStation(ctx,potion),false);
 ctx.px=10;ctx.pz=0;
 assert.equal(canCraftAtStation(ctx,stew),true,'10 m is allowed');
 assert.equal(canCraftAtStation(ctx,potion),true,'10 m is allowed');
 ctx.pz=.001;
 assert.equal(canCraftAtStation(ctx,stew),false,'just beyond 10 m is blocked');
 assert.equal(canCraftAtStation(ctx,potion),false);
 assert.equal(nearbyCraftStation(camp,'torch',0,0),false,'torch is not a campfire');
 ctx.px=20;ctx.pz=0;
 assert.equal(canCraftAtStation(ctx,stew),false);
 assert.equal(canCraftAtStation(ctx,potion),true);
 camp.delete(2);
 assert.equal(canCraftAtStation(ctx,potion),false,'dismantled station immediately loses access');
 assert.equal(canCraftAtStation(ctx,recipeById('campfire')),true,'ordinary structures have no station');
});

test('mushroom stew costs boletus and milkcap, has no health bonus and is strictly better for hunger',()=>{
 const recipe=recipeById('food:mushroom_stew');
 assert.deepEqual(recipe.ingredients,{'mushroom:boletus':1,'mushroom:milkcap':1});
 assert.deepEqual(FOOD_EFFECTS[recipe.id],{health:0,hunger:3});
 assert.deepEqual(eatEffect(2,0,recipe.id),{health:2,hunger:3});
 assert.deepEqual(eatEffect(2,4,recipe.id),{health:2,hunger:5});
 const bag=createInventoryModel();
 bag.addItem({id:'mushroom:boletus',count:1});
 bag.addItem({id:'mushroom:milkcap',count:1});
 assert.equal(recipeAvailable(recipe,bag),true);
 bag.spend('mushroom:milkcap',1);
 assert.equal(recipeAvailable(recipe,bag),false);
 assert.equal(bag.addItem({id:recipe.id,count:1}),true);
 assert.equal(bag.consumeAt(2,recipe.id),true);
 assert.equal(bag.count(recipe.id),0);
});

test('alchemy table has full material bill, valid save schema and collision-friendly workstation geometry',()=>{
 const recipe=recipeById('alchemy_table');
 const expected={log:3,stone:5,branch:5,'flower:daisy':3,
  'flower:pink_wildflower':2,'flower:blue_wildflower':3,'mushroom:fly_agaric':1};
 assert.deepEqual(recipe.ingredients,expected);
 assert.deepEqual(CAMP_RECIPES.alchemy_table,expected);
 assert.equal(validCampStructure({kind:'alchemy_table',id:1,x:0,z:0,orientation:0,lit:false}),true);
 assert.equal(validCampStructure({kind:'alchemy_table',id:1,x:0,z:0,orientation:0,lit:true}),false);
});

test('herbal mushroom stew uses one blue wildflower and restores +1 health and +3 hunger',()=>{
 const normal=recipeById('food:mushroom_stew');
 const herbal=recipeById('food:herbal_mushroom_stew');
 assert.deepEqual(herbal.ingredients,{
  'mushroom:boletus':1,'mushroom:milkcap':1,'flower:blue_wildflower':1,
 });
 assert.equal(herbal.tab,'food');
 assert.equal(recipeStationKind(herbal),recipeStationKind(normal));
 assert.deepEqual(FOOD_EFFECTS[herbal.id],{health:1,hunger:3});
 assert.deepEqual(eatEffect(2,0,herbal.id),{health:3,hunger:3});
 assert.deepEqual(eatEffect(5,4,herbal.id),{health:5,hunger:5});
 const bag=createInventoryModel();
 bag.addItem({id:'mushroom:boletus',count:1});
 bag.addItem({id:'mushroom:milkcap',count:1});
 assert.equal(recipeAvailable(normal,bag),true);
 assert.equal(recipeAvailable(herbal,bag),false,'flower is required for herbal version');
 bag.addItem({id:'flower:blue_wildflower',count:1});
 assert.equal(recipeAvailable(herbal,bag),true);
 const ctx={px:0,pz:0,campStructures:{items:new Map()}};
 assert.equal(canCraftAtStation(ctx,herbal),false);
 ctx.campStructures.items.set(1,{kind:'campfire',x:10,z:0,lit:false});
 assert.equal(canCraftAtStation(ctx,herbal),true);
 ctx.px=-.01;
 assert.equal(canCraftAtStation(ctx,herbal),false);
});
