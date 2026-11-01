import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Companion to the real browser viewport checks: keep both HTML entries in sync.
test('both game entrypoints keep the touch layout and cache-busted UI modules aligned',()=>{
  const normal=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const debug=readFileSync(new URL('../index_debug.html',import.meta.url),'utf8');
  for(const html of [normal,debug]){
    assert.match(html,/@media\(max-width:650px\)/);
    assert.doesNotMatch(html,/id="instructions"/,'the HUD must not overlap menu buttons with control tips');
    assert.match(html,/id="menu-help-panel"/,'control help remains accessible from the menu');
    assert.match(html,/<strong>K<\/strong>/,'the main menu documents the recipes hotkey');
    assert.match(html,/#nettoggle\{top:55px;right:12px\}/);
    assert.match(html,/#viewtoggle\{top:137px!important;right:12px!important/);
    assert.match(html,/main-menu\.js\?v=20\d{6}-[a-z0-9-]+/);
    assert.match(html,/<div id="game" hidden>/);
    assert.match(html,/id="menu-backgame"/);
    assert.match(html,/id="minimap"[^>]+role="button"/);
    assert.match(html,/id="pickup"[^>]+aria-label="Поднять предмет"/);
    assert.match(html,/#pickup\[hidden\]\{display:none!important\}/);

  }
  const settings=readFileSync(new URL('../src/settings.js',import.meta.url),'utf8');
  const progress=readFileSync(new URL('../src/progress.js',import.meta.url),'utf8');
  assert.match(settings,/Клавиши управления/);
  assert.match(settings,/K — книга рецептов/);
  assert.match(settings,/\.fc-settings-toggle\{top:95px;right:12px/);
  assert.match(progress,/\.fc-progress-toggle\{top:180px;right:12px/);
  assert.match(progress,/\.fc-progress-panel\{top:222px;max-height:calc\(100dvh - 235px\)/);
});


test('recipe book opens from inventory, with separate dialog and no floating HUD button',()=>{
  const inventory=readFileSync(new URL('../src/inventory-ui.js',import.meta.url),'utf8');
  const book=readFileSync(new URL('../src/recipe-book-ui.js',import.meta.url),'utf8');
  const controls=readFileSync(new URL('../src/controls.js',import.meta.url),'utf8');
  assert.match(inventory,/class="fc-recipe-button"[^>]+data-action="recipes">📖 Рецепты<\/button>/);
  assert.match(inventory,/if\(action==='recipes'\)recipeBook\?\.open\(\)/);
  assert.doesNotMatch(inventory,/class="fc-book-window"/,'recipe book must not be embedded in inventory markup');
  assert.match(book,/doc\.body\.append\(backdrop,book\)/,'book is its own dialog');
  assert.doesNotMatch(book,/fc-book-toggle/,'no permanent recipes HUD control');
  assert.match(controls,/e\.code==='KeyK'/,'keyboard shortcut still works');
});
