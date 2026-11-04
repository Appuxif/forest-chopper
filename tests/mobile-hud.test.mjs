import test from 'node:test';
import assert from 'node:assert/strict';
import {createMobileHud} from '../src/mobile-hud.js';

for(const initial of [false,true])test(`diagnostics menu toggles the shared FPS setting from ${initial}`,()=>{
 const mounted=[];
 const node=()=>({children:[],attributes:{},hidden:false,append(...items){this.children.push(...items)},setAttribute(k,v){this.attributes[k]=v},contains(){return false},focus(){}});
 const doc={createElement:node,location:{pathname:'/index.html'},addEventListener(){},body:{append(...items){mounted.push(...items)}}};
 const calls=[];
 const settings={showFps:initial,setShowFps(value){calls.push(value);this.showFps=value;}};
 createMobileHud(doc,settings);
 const [toggle,panel]=mounted,diagnostics=panel.children.find(item=>item.textContent==='FPS / диагностика');
 toggle.onclick();assert.equal(panel.hidden,false);assert.equal(diagnostics.attributes['aria-pressed'],String(initial));
 diagnostics.onclick();assert.deepEqual(calls,[!initial]);assert.equal(panel.hidden,true);assert.equal(diagnostics.attributes['aria-pressed'],String(!initial));
 toggle.onclick();diagnostics.onclick();assert.deepEqual(calls,[!initial,initial]);
});
