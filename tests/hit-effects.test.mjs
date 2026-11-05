import test from 'node:test';
import assert from 'node:assert/strict';
import {createChopping} from '../src/chopping.js';
import {createHitEffects} from '../src/hit-effects.js';

function setup(online=false) {
  const sent=[], damage=new Map(), sceneObjects=[], events=[];
  let canAim=true,aimTarget=null;
  class Mesh {
    constructor(geometry,material) {
      this.geometry=geometry;this.material=material;
      this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});}};
      this.rotation={x:0,y:0,z:0};
      this.scale={x:1,y:1,z:1};
    }
  }
  class Vector3 {
    constructor(x=0,y=0,z=0){this.set(x,y,z);}
    set(x,y,z){Object.assign(this,{x,y,z});return this;}
    copy(other){return this.set(other.x,other.y,other.z);}
    multiplyScalar(n){this.x*=n;this.y*=n;this.z*=n;return this;}
    add(other){this.x+=other.x;this.y+=other.y;this.z+=other.z;return this;}
    sub(other){this.x-=other.x;this.y-=other.y;this.z-=other.z;return this;}
    normalize(){const l=Math.hypot(this.x,this.y,this.z)||1;return this.multiplyScalar(1/l);}
  }
  class Raycaster {
    constructor(){this.ray={origin:new Vector3(),direction:new Vector3(0,0,-1)};}
    set() {}
    setFromCamera() {}
    intersectObjects(objects) {return canAim&&objects.length&&(!aimTarget||objects.includes(aimTarget)) ? [{distance:2}] : [];}
  }
  const material={name:'shared trunk material'};
  const trunk=new Mesh({},material);
  const tree={children:[trunk],position:{x:2,z:0},rotation:{x:0,y:0,z:0},
    userData:{id:'0,0:1',hp:5,maxHp:5,x:2,z:0}};
  const ctx={
    THREE:{Mesh,Raycaster,Vector3,Vector2:class {},BoxGeometry:class {},MeshLambertMaterial:class {}},
    thirdPerson:true,px:0,pz:0,yaw:0,pitch:0,
    trees:new Map([[tree.userData.id,tree]]),scene:{add(mesh){sceneObjects.push(mesh);}},
    particles:[],CHOP_SPEED:1,lastHit:-100000,swing:0,ownAvatar:null,
    actorChop(){events.push('swing');},buildMode:false,wood:0,cuts:0,
    audio:{effect:name=>events.push(name)},
    treeDamage:damage,isOnline:()=>online,sendNet:data=>sent.push(data),
    offlineSave:{markDirty(){}},
  };
  return {ctx,tree,trunk,material,sent,damage,sceneObjects,events,
    setAim(value){canAim=value;},setAimTarget(mesh){aimTarget=mesh;},chopping:createChopping(ctx)};
}

test('empty-space swing can land if player aims at a tree exactly on frame 18 (offline)',()=>{
 const f=setup();
 f.setAim(false);
 f.chopping.chop();
 assert.deepEqual(f.events,['swing'],'empty space launches animation without sound');
 assert.equal(f.ctx.particles.length,0);
 assert.equal(f.tree.userData.hp,5);
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+700),false);
 f.setAim(true);
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+715),true);
 assert.equal(f.tree.userData.hp,4);
 assert.equal(f.ctx.particles.length,7);
 assert.deepEqual(f.events,['swing','axe']);
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+1000),false,'impact occurs once');
});

test('empty-space swing never hits if there is no tree at contact',()=>{
 const f=setup();
 f.setAim(false);
 f.ctx.vitals={canChop:true,hit:()=>{throw Error('miss must not spend stamina')}};
 f.chopping.chop();
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+715),false);
 assert.equal(f.tree.userData.hp,5);
 assert.equal(f.ctx.particles.length,0);
 assert.deepEqual(f.events,['swing']);
 f.setAim(true);
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+1000),false,'late aiming cannot revive missed swing');
});

test('empty-space swing sends online hit only at contact, not before',()=>{
 const f=setup(true);
 f.setAim(false);
 f.chopping.chop();
 assert.deepEqual(f.sent,[]);
 f.setAim(true);
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+715),true);
 assert.deepEqual(f.sent,[{type:'hit',tree:f.tree.userData.id}]);
 assert.equal(f.tree.userData.hp,5,'HP remains server-authoritative');
 assert.equal(f.ctx.particles.length,7);
 assert.deepEqual(f.events,['swing','axe']);
});

test('offline successful chop keeps entire trunk material, scale and rotation constant',()=>{
  const f=setup();
  const {trunk,tree,material,ctx,chopping}=f;
  const originalTrunkScale={...trunk.scale};
  const originalTrunkRotation={...tree.rotation};
  chopping.chop();
  assert.equal(tree.userData.hp,5,'click itself does not damage');
  assert.equal(ctx.particles.length,0,'click itself does not spawn chips');
  assert.equal(chopping.tickImpact(ctx.lastHit+700),false,'before frame 18');
  assert.equal(chopping.tickImpact(ctx.lastHit+715),true,'frame 18 collision');
  assert.equal(tree.userData.hp,4);
  assert.deepEqual(f.events,['swing','axe']);
  assert.equal(chopping.tickImpact(ctx.lastHit+2000),false,'frame 18 cannot apply twice');
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
  assert.deepEqual(f.sent,[],'server receives nothing until contact');
  assert.equal(f.chopping.tickImpact(f.ctx.lastHit+715),true);
  assert.deepEqual(f.sent,[{type:'hit',tree:'0,0:1'}]);
  assert.deepEqual(f.events,['swing','axe']);
  assert.equal(f.ctx.particles.length,7,'predicted local chips appear on frame 18');
  assert.equal(f.tree.userData.hp,5);
  assert.equal(f.tree.userData.scar,undefined);
  assert.equal(f.ctx.particles.length,7,'online local player sees one burst at impact');
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

test('aiming away at frame 18 is a complete miss: no sound, stamina, damage or chips',()=>{
 const f=setup();
 f.ctx.vitals={canChop:true,hit:()=>{throw Error('miss spends stamina')}};
 f.chopping.chop();
 f.setAim(false);
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+500),false);
 assert.equal(f.tree.userData.hp,5);
 assert.equal(f.ctx.particles.length,0);
 assert.deepEqual(f.events,['swing']);
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+600),false);
});

test('aiming from tree A to B before frame 18 damages only B',()=>{
 const f=setup(),a=f.tree;
 const bMesh=new f.ctx.THREE.Mesh({},f.material);
 const b={children:[bMesh],position:{x:2.2,z:0},rotation:{x:0,y:0,z:0},
   userData:{id:'0,0:2',hp:6,maxHp:6,x:2.2,z:0}};
 f.ctx.trees.set(b.userData.id,b);
 f.setAimTarget(f.trunk);
 f.chopping.chop();
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+700),false);
 f.setAimTarget(bMesh);
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+715),true);
 assert.equal(a.userData.hp,5,'original target A remains untouched');
 assert.equal(b.userData.hp,5,'current target B receives exactly one hit');
 assert.equal(f.damage.get(b.userData.id),5);
 assert.equal(f.damage.has(a.userData.id),false);
 assert.equal(f.ctx.particles.length,7);
 assert.deepEqual(f.events,['swing','axe']);
});

test('empty-space swing can aim at B instead of A by contact frame',()=>{
 const f=setup();
 const bMesh=new f.ctx.THREE.Mesh({},f.material);
 const b={children:[bMesh],position:{x:2.2,z:0},rotation:{x:0,y:0,z:0},
   userData:{id:'0,0:2',hp:6,maxHp:6,x:2.2,z:0}};
 f.ctx.trees.set(b.userData.id,b);
 f.setAim(false);
 f.chopping.chop();
 f.setAim(true);f.setAimTarget(bMesh);
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+715),true);
 assert.equal(f.tree.userData.hp,5);
 assert.equal(b.userData.hp,5);
 assert.deepEqual(f.events,['swing','axe']);
});


test('ragdoll or death before contact cancels pending impact permanently',()=>{
 for(const status of ['ragdoll','death']){
  const f=setup();f.chopping.chop();
  if(status==='ragdoll')f.ctx.ragdoll={active:true};
  else f.ctx.deathSystem={active:true};
  assert.equal(f.chopping.tickImpact(f.ctx.lastHit+500),false);
  delete f.ctx.ragdoll;delete f.ctx.deathSystem;
  assert.equal(f.chopping.tickImpact(f.ctx.lastHit+1200),false);
  assert.equal(f.tree.userData.hp,5);
  assert.deepEqual(f.events,['swing']);
 }
});

test('impact uses actual mixer time, not wall-clock, and supports fast axes',()=>{
 const f=setup();
 const action={time:0,getClip(){return {duration:1.7916667}}};
 f.ctx.ownAvatar={upper:{Chop2:action},actions:{Chop2:action}};
 f.ctx.CHOP_SPEED=1.6;
 f.ctx.inventory={selected:'axe',equipped:true,axe:{speed:1.5,damage:2},
  state:{selectedQuick:0,quickItem(){return {id:'axe'}}}};
 f.chopping.chop();
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+5000),false,'mixer not yet at impact');
 action.time=17/24-.001;
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+5000),false);
 action.time=17/24;
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+5000),true);
 assert.equal(f.tree.userData.hp,3);
 assert.deepEqual(f.events,['swing','axe']);
});

test('server confirms locally predicted chips once; remote hits remain visible',()=>{
 const f=setup(true);
 f.ctx.myId=11;
 f.chopping.chop();
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+715),true);
 assert.equal(f.ctx.particles.length,7);
 assert.equal(f.chopping.acknowledgeLocalChop('0,0:1',12),false,
  'other player hits must not consume local prediction');
 assert.equal(f.chopping.acknowledgeLocalChop('0,0:1',11),true);
 assert.equal(f.chopping.acknowledgeLocalChop('0,0:1',11),false,'at-most-once acknowledgement');
 f.chopping.resetChop();
});

test('a temporary aim deviation recovers if crosshair returns by the contact frame',()=>{
 const f=setup();
 f.chopping.chop();
 f.setAim(false);
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+400),false);
 f.setAim(true);
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+715),true);
 assert.equal(f.tree.userData.hp,4);
 assert.deepEqual(f.events,['swing','axe']);
});

test('hen target is acquired only at the Chop2 contact frame and cannot receive the same swing twice',()=>{
 const f=setup(false);const hits=[];let hen=null;
 f.ctx.hens={aimed:()=>hen?{record:hen}:null,hit:r=>{hits.push(r.id);return true;}};
 f.setAim(false);f.chopping.chop();
 assert.deepEqual(hits,[]);
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+100),false);
 hen={id:'hen:test',hp:1};
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+715),true);
 assert.deepEqual(hits,['hen:test']);
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+1500),false);
 assert.deepEqual(hits,['hen:test']);
});
test('death before the contact frame cancels an attack against a hen',()=>{
 const f=setup(false);let hits=0;
 f.ctx.hens={aimed:()=>({record:{id:'hen:test'}}),hit:()=>{hits++;return true;}};
 f.setAim(false);f.chopping.chop();f.ctx.deathSystem={active:true};
 assert.equal(f.chopping.tickImpact(f.ctx.lastHit+715),false);assert.equal(hits,0);
});

test('contact consumes the same current-frame mob target shown by the reticle without a second query',()=>{
 for(const acquired of [true,false]){
  const f=setup(false),hits=[];f.setAim(false);f.chopping.chop();
  f.ctx.mobs={aimed:()=>assert.fail('frame target must not be resolved twice'),hit:r=>{hits.push(r.id);return true;}};
  const target=acquired?{record:{id:'hen:current-frame',hp:1}}:null;
  assert.equal(f.chopping.tickImpact(f.ctx.lastHit+715,target),acquired);
  assert.deepEqual(hits,acquired?['hen:current-frame']:[]);
 }
});

test('an open corpse UI prevents a new swing and cancels an already pending impact',()=>{
 const f=setup(false);f.ctx.mobs={opened:'corpse'};
 f.chopping.chop();assert.deepEqual(f.events,[]);
 f.ctx.mobs.opened=null;f.chopping.chop();assert.deepEqual(f.events,['swing']);
 f.ctx.mobs.opened='corpse';assert.equal(f.chopping.tickImpact(f.ctx.lastHit+715),false);
 f.ctx.mobs.opened=null;assert.equal(f.chopping.tickImpact(f.ctx.lastHit+1000),false);
 assert.equal(f.tree.userData.hp,5);
});
