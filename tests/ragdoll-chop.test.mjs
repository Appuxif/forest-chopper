import test from 'node:test';
import assert from 'node:assert/strict';
import {createChopping} from '../src/chopping.js';

test('mouse click during ragdoll cannot launch Chop2 or use items',()=>{
 const calls=[];
 class Noop{}
 const ctx={
  THREE:{Raycaster:Noop,Vector2:Noop,Vector3:Noop,
    BoxGeometry:Noop,MeshLambertMaterial:Noop},
  ragdoll:{active:true},ragdollControls:{mode:'manual',busy:false},
  actorChop(){calls.push('Chop2');},
  inventory:{get selected(){calls.push('inventory');return 'log';}},
 };
 const {chop}=createChopping(ctx);
 chop();
 assert.deepEqual(calls,[]);
 ctx.ragdoll.active=false;
 ctx.ragdollControls.mode='sleep';
 chop();
 assert.deepEqual(calls,[]);
 ctx.ragdollControls.mode='none';ctx.ragdollControls.busy=true;
 chop();
 assert.deepEqual(calls,[]);
});
