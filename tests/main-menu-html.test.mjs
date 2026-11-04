import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

for(const filename of ['index.html','index_debug.html']){
 test(`${filename} ends with a complete module script and closes the document`,()=>{
  const html=readFileSync(new URL(`../${filename}`,import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script\b[^>]*>/g)];
  assert.equal(scripts.length,1,'exactly one entrypoint script');
  const src=scripts[0][0].match(/\bsrc="([^"]+)"/);
  assert.ok(src,'entrypoint must have a fully quoted src attribute');
  assert.match(scripts[0][0],/\btype="module"/);
  assert.match(src[1],/^\.\/src\/main-menu\.js\?v=[\w-]+$/);
  assert.ok(existsSync(new URL(`../${src[1].split('?')[0]}`,import.meta.url)),
    'entrypoint module must exist');
  assert.match(html,/<\/script>\s*<\/body>\s*<\/html>\s*$/i,
    'a truncated script tag silently leaves all main-menu buttons inert');
  const home=html.match(/<section[^>]*id="menu-home"[\s\S]*?<\/section>/)?.[0];
  assert.ok(home);assert.match(home,/Локальная игра/);
  assert.doesNotMatch(home,/id="menu-new"/);
  for(const id of ['menu-new-panel','menu-new-back','menu-saves','menu-saves-panel','menu-save-list','slots-export','slots-import','menu-online','menu-help',
    'menu-settings','menu-create','menu-join'])
   assert.ok(html.includes(`id="${id}"`),`${id} must be present`);
 });
}
