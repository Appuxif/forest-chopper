import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Companion to the real browser viewport checks: keep both HTML entries in sync.
test('both game entrypoints keep the touch layout and cache-busted UI modules aligned',()=>{
  const normal=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const debug=readFileSync(new URL('../index_debug.html',import.meta.url),'utf8');
  for(const html of [normal,debug]){
    assert.match(html,/@media\(max-width:650px\)/);
    assert.match(html,/\.instructions\{display:none\}/);
    assert.match(html,/#nettoggle\{top:55px;right:12px\}/);
    assert.match(html,/#viewtoggle\{top:137px!important;right:12px!important/);
    assert.match(html,/main\.js\?v=20261030-mobile-ui1/);
    assert.match(html,/id="minimap"[^>]+role="button"/);
  }
  const settings=readFileSync(new URL('../src/settings.js',import.meta.url),'utf8');
  const progress=readFileSync(new URL('../src/progress.js',import.meta.url),'utf8');
  assert.match(settings,/\.fc-settings-toggle\{top:95px;right:12px/);
  assert.match(progress,/\.fc-progress-toggle\{top:180px;right:12px/);
  assert.match(progress,/\.fc-progress-panel\{top:222px;max-height:calc\(100dvh - 235px\)/);
});
