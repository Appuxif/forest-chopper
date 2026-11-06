import test from 'node:test';
import assert from 'node:assert/strict';
import {flatTerrain} from './helpers/flat-terrain.mjs';
import {createCrafting} from '../src/crafting.js';
import {createPhysics} from '../src/physics.js';
import {createCollisionWorld} from '../src/collision-world.js';
import {createKinematicCollisionAdapter} from '../src/collision-kinematic.js';

function fixture(orientation=0){
  class Geometry{}
  class Material{}
  class Obj {
    constructor(){
      this.children=[];this.userData={};this.rotation={x:0,y:0,z:0};
      this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z})}};
      this.scale={x:1,y:1,z:1,set(x,y,z){Object.assign(this,{x,y,z})}};
    }
    add(...args){this.children.push(...args);}
  }
  class Mesh extends Obj{constructor(geometry,material){super();this.geometry=geometry;this.material=material;}}
  const ctx={
    THREE:{BoxGeometry:Geometry,CylinderGeometry:Geometry,MeshLambertMaterial:Material,Group:Obj,Mesh},
    terrain:flatTerrain(),
    scene:{add(){},remove(){}},
    $:()=>({append(){}}),trees:new Map(),placed:[],rockColliders:new Map(),chunkSize:24,
    logLength:3,logRadius:.29,PLAYER_RADIUS:.31,PLAYER_HEIGHT:1.7,
    GRAVITY:19,JUMP_SPEED:7.5,px:0,pz:0,feetY:0,verticalSpeed:0,
    jumpRequested:false,onGround:true,
  };
  ctx.crafting=createCrafting(ctx,{createElement:()=>({style:{}})});
  ctx.crafting.add({kind:'bench',id:1,x:0,z:0,orientation});
  return {ctx,physics:createPhysics(ctx),craft:ctx.crafting};
}

test('bench has fine-grained solids for seat, legs, backrest and arms, not a bounding cube',()=>{
  const {ctx,physics,craft}=fixture();
  const item=craft.items.get(1);
  const boxes=item.group.userData.collisionBoxes;
  assert.equal(boxes.length,item.group.children.filter(p=>p.name!=='Metal fastener').length);
  assert.ok(boxes.length>=20);
  assert.equal(physics.blocksPlayerAt(0,0,0),true,'the seat stops a standing avatar');
  assert.equal(physics.blocksPlayerAt(0,0,.7),false,'an avatar on top can move along the seat');
  assert.equal(physics.blocksPlayerAt(0,.44,.7),true,'the rear backrest stops movement');
  assert.equal(physics.blocksPlayerAt(.9,-.1,.7),true,'the left armrest stops movement');
  assert.equal(physics.blocksPlayerAt(1.5,-.9,0),false,'empty space beyond the bench stays open');
  assert.ok(item.group.children.find(p=>p.name==='Armrest').scale.x<=.12);
  assert.ok(item.group.children.find(p=>p.name==='Backrest slat 0').scale.y<=.095);
  assert.ok(item.group.children.find(p=>p.name==='Back upright').scale.x<=.10);
});

test('walking/sprinting cannot pass through bench, while axis sliding remains possible',()=>{
  const {ctx,physics}=fixture();
  ctx.pz=-1.5;
  physics.moveHorizontal(0,3);
  assert.ok(ctx.pz<-.65,'a large single movement cannot tunnel through the seat');
  ctx.pz=-1.5;
  physics.moveHorizontal(.95,3);
  assert.ok(ctx.pz<-.5,'diagonal movement must still collide with bench');
  assert.ok(ctx.px>.2,'tangential movement can slide along it');
});

test('player jumps onto the seat, stands, jumps again and falls off naturally',()=>{
  const {ctx,physics}=fixture();
  ctx.pz=-1.1;
  physics.requestJump();
  for(let i=0;i<7;i++)physics.simulateVertical(.04);
  assert.ok(ctx.feetY>.7,'jump clears the seat');
  physics.moveHorizontal(0,1.1);
  assert.equal(ctx.pz,0,'can move onto the seat in midair');
  for(let i=0;i<30;i++)physics.simulateVertical(.04);
  const seatTop=.525+.105/2;
  assert.ok(Math.abs(ctx.feetY-seatTop)<.001,'lands on the actual slat tops');
  assert.equal(ctx.onGround,true);
  physics.moveHorizontal(0,-.15);
  assert.equal(ctx.onGround,true);
  physics.simulateVertical(.04);
  assert.ok(Math.abs(ctx.feetY-seatTop)<.001,'stays supported while walking on it');
  physics.requestJump();
  physics.simulateVertical(.04);
  assert.ok(ctx.feetY>seatTop);
  for(let i=0;i<38;i++)physics.simulateVertical(.04);
  assert.ok(Math.abs(ctx.feetY-seatTop)<.001,'can land on the bench a second time');
  physics.moveHorizontal(0,-1.5);
  physics.simulateVertical(.04);
  assert.equal(ctx.onGround,false,'walking off the bench starts a fall');
  for(let i=0;i<35;i++)physics.simulateVertical(.04);
  assert.equal(ctx.feetY,0);
  assert.equal(ctx.onGround,true);
});

test('rotation, unloading and saved structure reconstruction share one collider model',()=>{
  const {ctx,physics,craft}=fixture(1);
  assert.equal(physics.blocksPlayerAt(.45,0,.7),true,
    'after quarter-turn the backrest faces the world +X side');
  assert.equal(physics.blocksPlayerAt(0,.45,.7),false,
    'rotated backrest no longer blocks original +Z side');
  assert.equal(physics.blocksPlayerAt(.9,0,0),false,
    'orientation rotates the long axis onto Z');
  const snap=craft.snapshot();
  craft.clear();
  assert.equal(physics.blocksPlayerAt(0,0,0),false,'removed bench has no ghost collision');
  craft.add({id:2,...snap[0]});
  assert.equal(physics.blocksPlayerAt(0,0,0),true,'restore rebuilds physics and render geometry');
});

test('future structures can register their own local collision boxes',()=>{
  const structures=[{x:6,z:4,orientation:3,group:{
    position:{y:1},userData:{collisionRadius:3,
      collisionBoxes:[{x:.9,y:.5,z:0,w:1,h:1,d:.4}]},
  }}];
  const context={terrain:flatTerrain(),crafting:{items:new Map([[1,structures[0]]])},
    rockColliders:new Map(),trees:new Map(),placed:[],chunkSize:24,logRadius:.29,
    PLAYER_RADIUS:.31,PLAYER_HEIGHT:1.7};
  const collision=createKinematicCollisionAdapter(createCollisionWorld(context),context);
  assert.equal(collision.blocked(6,4.9,1),true,
    'rotation turns +X-local into +Z-world');
  assert.equal(collision.blocked(7,4,1),false);
  assert.equal(collision.support(6,4.9,2,1),2);
  assert.ok(Math.abs(collision.ceiling(6,4.9,-.8,-.6)-(-.712))<1e-6);
});
