import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {itemIconKey,benchIconModel} from '../src/item-icons.js';

test('the same species shares an icon across all stacks and hotbar slots',()=>{
 assert.equal(itemIconKey({id:'stone',count:3}),itemIconKey({id:'stone',count:10}));
 assert.equal(itemIconKey({id:'mushroom:boletus',count:5}),'mushroom:boletus');
 assert.equal(itemIconKey({id:'flower:daisy',count:1}),'flower:daisy');
 assert.equal(itemIconKey(null),undefined);
});

test('all four axe tiers have distinct rendered icon keys',()=>{
 const keys=new Set([0,1,2,3].map(tier=>itemIconKey({id:'axe',tier})));
 assert.equal(keys.size,4);
 assert.deepEqual([...keys],['axe:0','axe:1','axe:2','axe:3']);
});

test('icon preview uses cached images rather than live 3D viewports inside slots',()=>{
 const ui=readFileSync(new URL('../src/inventory-ui.js',import.meta.url),'utf8');
 assert.match(ui,/new Map\(\)/);
 assert.match(ui,/renderItemIcons\(ctx,doc\)/);
 assert.match(ui,/icons\.get\(itemIconKey\(item\)\)/);
 assert.match(ui,/createElement\('img'\)/);
});

test('bench icon faces opposite direction without rotating placed world bench',()=>{
 const worldBench={rotation:{y:0}},snapshot={rotation:{y:0}};
 const ctx={crafting:{createIconModel:()=>snapshot}};
 assert.equal(benchIconModel(ctx),snapshot);
 assert.equal(snapshot.rotation.y,Math.PI);
 assert.equal(worldBench.rotation.y,0,'only the icon model changes');
});
