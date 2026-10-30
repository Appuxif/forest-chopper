import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerList} from '../src/player-list.js';
function elem(){
  return {children:[],style:{},hidden:false,textContent:'',attributes:{},
    setAttribute(k,v){this.attributes[k]=v;},
    append(...children){this.children.push(...children)},
    replaceChildren(...children){this.children=children},
  };
}
test('player list uses confirmed avatars, safe plain-text names and clears on disconnect',()=>{
  const network=elem(),doc={createElement:elem};
  const ctx={
    $:id=>id==='network'?network:{value:'You'},
    isOnline:()=>ctx.online,myId:10,online:false,
    avatars:new Map([[18,{name:'Guest <script>alert(1)</script>'}],[12,{name:'Friend'}]]),
  };
  const panel=createPlayerList(ctx,doc);
  assert.deepEqual(panel.members(),[]);
  panel.render();
  assert.equal(network.children.length,1);
  const [button,list]=network.children[0].children;
  assert.match(button.textContent,/\(0\)/);
  button.onclick();
  assert.equal(list.children[0].textContent,'Сначала подключитесь к комнате');
  ctx.online=true;panel.render();
  assert.equal(list.children.length,3);
  assert.deepEqual(panel.members().map(p=>p.id),[10,12,18]);
  assert.match(list.children[0].textContent,/You \(вы\)/);
  assert.match(list.children[2].textContent,/Guest <script>/);
  ctx.avatars.delete(18);panel.render();
  assert.equal(list.children.length,2);
  ctx.online=false;ctx.avatars.clear();panel.render();
  assert.equal(list.children.length,1);
  panel.close();
  assert.equal(panel.expanded,false);
  assert.equal(button.attributes['aria-expanded'],'false');
});
