import test from 'node:test';
import assert from 'node:assert/strict';
import {ITEM_DISPLAY_NAMES,ITEM_DISPLAY_ICONS,itemDisplayName,itemDisplayIcon} from '../src/item-display.js';
import {DECOR_ITEM_NAMES,DECOR_ITEM_IDS} from '../src/collectible-decor.js';
import {ITEM_STACK} from '../src/inventory.js';
import {ITEM_NAMES} from '../src/ground-boxes.js';
import {RECIPE_TABS,RECIPE_PAGES} from '../src/recipe-book.js';
import {RECIPES_PER_SPREAD,recipeSpread} from '../src/recipe-book-ui.js';

test('all collectible and craftable items have Russian display names and icons',()=>{
 for(const id of [...DECOR_ITEM_IDS,...Object.keys(ITEM_STACK)]){
  assert.equal(typeof ITEM_DISPLAY_NAMES[id],'string',id);
  assert.ok(ITEM_DISPLAY_ICONS[id],id);
  assert.ok(!itemDisplayName(id).includes(':'),id);
 }
 for(const [id,name] of Object.entries(DECOR_ITEM_NAMES))
  assert.equal(itemDisplayName(id),name);
 assert.equal(itemDisplayName('flower:daisy'),'Ромашка');
 assert.equal(itemDisplayName('mushroom:boletus'),'Боровик');
 assert.equal(itemDisplayName('flower:blue_wildflower'),'Синий полевой цветок');
 assert.equal(itemDisplayName('potion:health'),'Зелье здоровья');
 assert.equal(itemDisplayName('potion:stamina'),'Зелье выносливости');
 assert.equal(ITEM_NAMES['mushroom:boletus'],itemDisplayName('mushroom:boletus'));
 assert.equal(itemDisplayIcon('flower:daisy'),'🌼');
 assert.equal(itemDisplayName('unexpected:id'),'Неизвестный предмет');
});
test('every recipe ingredient has a Russian label; each spread has at most five recipes',()=>{
 assert.equal(RECIPES_PER_SPREAD,5);
 for(const r of RECIPE_PAGES)
  for(const id of Object.keys(r.ingredients??{}))
   assert.notEqual(itemDisplayName(id),'Неизвестный предмет',r.id+' '+id);
 for(const tab of RECIPE_TABS){
  const entries=RECIPE_PAGES.filter(r=>r.tab===tab.id);
  const pages=Array.from({length:Math.ceil(entries.length/RECIPES_PER_SPREAD)},(_,i)=>recipeSpread(entries,i));
  assert.ok(pages.every(page=>page.length>0&&page.length<=5),tab.id);
  assert.deepEqual(pages.flat(),entries);
  assert.deepEqual(recipeSpread(entries,pages.length),[]);
 }
 const buildings=RECIPE_PAGES.filter(r=>r.tab==='structures');
 assert.equal(buildings.length,9);
 assert.deepEqual(recipeSpread(buildings,0).map(x=>x.id),['bench','chest','rack','campfire','torch']);
 assert.deepEqual(recipeSpread(buildings,1).map(x=>x.id),['table','fence','workbench','signpost']);
});
