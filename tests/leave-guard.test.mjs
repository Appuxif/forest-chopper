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
