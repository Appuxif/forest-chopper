import test from 'node:test';
import assert from 'node:assert/strict';
import {createChopping} from '../src/chopping.js';
import {createHitEffects} from '../src/hit-effects.js';

function setup(online=false) {
  const sent=[], damage=new Map(), sceneObjects=[];
  class Mesh {
    constructor(geometry,material) {
      this.geometry=geometry;this.material=material;
      this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});}};
      this.rotation={x:0,y:0,z:0};
      this.scale={x:1,y:1,z:1};
    }
  }
  class Raycaster {
    set() {}
    intersectObjects(objects) {return objects.length ? [{distance:2}] : [];}
  }
  class Vector3 {normalize() {return this;}}
  const material={name:'shared trunk material'};
  const trunk=new Mesh({},material);
  const tree={children:[trunk],position:{x:2,z:0},rotation:{x:0,y:0,z:0},
    userData:{id:'0,0:1',hp:5,maxHp:5,x:2,z:0}};
  const ctx={
    THREE:{Mesh,Raycaster,Vector3,BoxGeometry:class {},MeshLambertMaterial:class {}},
    thirdPerson:true,px:0,pz:0,yaw:0,pitch:0,
    trees:new Map([[tree.userData.id,tree]]),scene:{add(mesh){sceneObjects.push(mesh);}},
    particles:[],CHOP_SPEED:1,lastHit:-100000,swing:0,ownAvatar:null,
    actorChop(){},buildMode:false,wood:0,cuts:0,
    treeDamage:damage,isOnline:()=>online,sendNet:data=>sent.push(data),
    offlineSave:{markDirty(){}},
  };
  return {ctx,tree,trunk,material,sent,damage,sceneObjects, chopping:createChopping(ctx)};
}

test('offline successful chop keeps entire trunk material, scale and rotation constant',()=>{
  const f=setup();
  const {trunk,tree,material,ctx,chopping}=f;
  const originalTrunkScale={...trunk.scale};
  const originalTrunkRotation={...tree.rotation};
  chopping.chop();
  assert.equal(tree.userData.hp,4);
  assert.equal(tree.userData.scar,undefined,'no rectangular damage overlay');
  assert.equal(trunk.material,material,'no full-trunk flash');
  assert.deepEqual(trunk.scale,originalTrunkScale,'no full-trunk scaling');
  assert.deepEqual(tree.rotation,originalTrunkRotation,'no abrupt whole-tree tilt');
  assert.equal(ctx.particles.length,7,'wood chips still appear');
  assert.equal(f.damage.get('0,0:1'),4);
  assert.equal(chopping.tickHitEffects,undefined,'no per-frame flash animation');
});

test('online chop sends request but waits for authoritative tree_hit to show feedback',()=>{
  const f=setup(true);
  f.chopping.chop();
  assert.deepEqual(f.sent,[{type:'hit',tree:'0,0:1'}]);
  assert.equal(f.tree.userData.hp,5);
  assert.equal(f.tree.userData.scar,undefined);
  assert.equal(f.ctx.particles.length,0);
  assert.equal(f.trunk.material,f.material);
});

test('chip effects remain bounded and do not flash even with 100 rapid impacts',()=>{
  const f=setup();
  for(let i=0;i<100;i++)f.chopping.spawnChips(f.tree);
  assert.equal(f.ctx.particles.length,96);
  assert.equal(f.sceneObjects.length,96);
  assert.equal(f.trunk.material,f.material);
  assert.equal(f.tree.userData.scar,undefined);
});

test('previous cached hit effect API is inert for compatibility',()=>{
  const f=setup();
  const fx=createHitEffects(f.ctx);
  fx.pulse(f.tree);
  fx.tick(.075);
  fx.release(f.tree);
  assert.equal(f.trunk.material,f.material);
  assert.equal(f.tree.userData.scar,undefined);
  assert.equal(fx.activeCount,0);
});
