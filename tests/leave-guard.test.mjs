import test from 'node:test';
import assert from 'node:assert/strict';
import {installGameLeaveGuard} from '../src/leave-guard.js';

function fakeWindow(){
  const handlers=new Map();
  return {
    addEventListener(type,fn){handlers.set(type,fn);},
    removeEventListener(type,fn){if(handlers.get(type)===fn)handlers.delete(type);},
    unload(){
      let prevented=false;
      const event={returnValue:undefined,preventDefault(){prevented=true;}};
      handlers.get('beforeunload')?.(event);
      return {prevented,returnValue:event.returnValue};
    },
  };
}

test('warns on closing or refreshing an active game',()=>{
  const target=fakeWindow();
  const guard=installGameLeaveGuard(target);
  assert.deepEqual(target.unload(),{prevented:true,returnValue:true});
  assert.deepEqual(target.unload(),{prevented:true,returnValue:true});
  guard.dispose();
  assert.deepEqual(target.unload(),{prevented:false,returnValue:undefined});
});

test('intentional return to main menu does not show a second confirmation',()=>{
  const target=fakeWindow();
  const guard=installGameLeaveGuard(target);
  guard.allowIntentionalExit();
  assert.deepEqual(target.unload(),{prevented:false,returnValue:undefined});
  guard.dispose();
});

test('game capture blocks Ctrl/Cmd R and W while allowing normal game key processing',()=>{
 const handlers=new Map(),target={addEventListener:(t,fn)=>handlers.set(t,fn),removeEventListener:t=>handlers.delete(t)};
 const guard=installGameLeaveGuard(target);
 for(const event of [{code:'KeyR',ctrlKey:true},{code:'KeyW',ctrlKey:true},{key:'r',metaKey:true},{code:'KeyR',ctrlKey:true,shiftKey:true}]){
  let blocked=false;handlers.get('keydown')({...event,preventDefault(){blocked=true;},stopImmediatePropagation(){assert.fail('movement must remain usable');}});assert.equal(blocked,true);
 }
 for(const event of [{code:'KeyR'},{code:'KeyW'},{code:'KeyC',ctrlKey:true},{code:'KeyW',ctrlKey:true,altKey:true}]){
  handlers.get('keydown')({...event,preventDefault(){assert.fail('unrelated shortcut was blocked');}});
 }
 guard.dispose();assert.equal(handlers.has('keydown'),false);
});

test('fullscreen requests only R/W keyboard lock and releases it on exit or disposal',async()=>{
 const handlers=new Map(),doc={fullscreenElement:{},addEventListener:(t,f)=>handlers.set(t,f),removeEventListener:t=>handlers.delete(t)},calls=[];
 const keyboard={async lock(keys){calls.push(keys);},unlock(){calls.push('unlock');}};
 const target={addEventListener(){},removeEventListener(){}};
 const guard=installGameLeaveGuard(target,{doc,keyboard});await Promise.resolve();
 assert.deepEqual(calls,[['KeyR','KeyW']]);
 doc.fullscreenElement=null;await handlers.get('fullscreenchange')();assert.deepEqual(calls.at(-1),'unlock');
 doc.fullscreenElement={};await handlers.get('fullscreenchange')();
 guard.dispose();assert.deepEqual(calls.at(-1),'unlock');assert.equal(handlers.has('fullscreenchange'),false);
});

test('a rejected or late keyboard-lock request does not leave the keyboard captured',async()=>{
 const target={addEventListener(){},removeEventListener(){}},doc={fullscreenElement:{},addEventListener(){},removeEventListener(){}};
 let finish,unlocks=0;
 const guard=installGameLeaveGuard(target,{doc,keyboard:{lock:()=>new Promise(resolve=>finish=resolve),unlock:()=>unlocks++}});
 guard.dispose();finish();await Promise.resolve();assert.equal(unlocks,1);
 const rejected=installGameLeaveGuard(target,{doc,keyboard:{lock:async()=>{throw Error('permission denied');}}});
 await Promise.resolve();rejected.dispose();
});
