import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmotes,EMOTE_LABELS} from '../src/emotes.js';

function fixture(){
  const allocated={textures:0,materials:0};
  class CanvasTexture {constructor(){allocated.textures++}}
  class SpriteMaterial {constructor(o){Object.assign(this,o);allocated.materials++}}
  class Sprite {
    constructor(material){this.material=material;this.position={set(){}};
      this.scale={set(){}};}
  }
  const group=()=>({children:[],add(x){this.children.push(x)},remove(x){
    this.children=this.children.filter(child=>child!==x)}});
  const self=group(), remote=group();
  const network={children:[],append(x){this.children.push(x)}};
  const doc={createElement(type){
    if(type==='canvas')return {width:0,height:0,getContext(){return {fillText(){}}}};
    return {type,children:[],style:{},append(...a){this.children.push(...a)},setAttribute(){}};
  }};
  const ctx={THREE:{CanvasTexture,SpriteMaterial,Sprite,SRGBColorSpace:'srgb'},
    myId:1,ownAvatar:{group:self},avatars:new Map([[2,{group:remote}]]),
    $:id=>id==='network'?network:null,isOnline:()=>true,notify(){},sendEmote(){}};
  return {ctx,doc,allocated,self,remote};
}
test('emote glyphs are reused for repeat events, then removed with no GPU allocations',()=>{
 const f=fixture();const emotes=createEmotes(f.ctx,f.doc,{lifetimeMs:2500});
 assert.deepEqual(Object.keys(EMOTE_LABELS),['wave','thumbs_up']);
 assert.deepEqual(f.allocated,{textures:2,materials:2});
 assert.equal(f.ctx.$('network').children.length,1);
 assert.equal(emotes.receive({by:2,kind:'wave'},0),true);
 assert.equal(f.remote.children.length,1);
 const first=f.remote.children[0];
 assert.equal(emotes.receive({by:2,kind:'thumbs_up'},300),true);
 assert.equal(f.remote.children.length,1);
 assert.notEqual(f.remote.children[0],first);
 assert.equal(emotes.receive({by:1,kind:'wave'},300),true);
 assert.equal(f.self.children.length,1);
 assert.equal(emotes.receive({by:2,kind:'dance'},300),false);
 assert.equal(emotes.receive({by:999,kind:'wave'},300),false);
 emotes.tick(2801);
 assert.equal(f.remote.children.length,0);
 assert.equal(f.self.children.length,0);
 assert.equal(emotes.count,0);
 assert.deepEqual(f.allocated,{textures:2,materials:2});
});
test('disconnected user emote is cleaned without leaving sprites on old avatars',()=>{
 const f=fixture();const e=createEmotes(f.ctx,f.doc);
 e.receive({by:2,kind:'wave'},0);
 f.ctx.avatars.clear();
 e.tick(1);
 assert.equal(f.remote.children.length,0);
 e.receive({by:1,kind:'thumbs_up'},5);
 e.clear();
 assert.equal(f.self.children.length,0);
});
