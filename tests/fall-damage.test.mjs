import test from 'node:test';
import assert from 'node:assert/strict';
import {createFallTracker,fallDamageForHeight,applyFallImpact} from '../src/fall-damage.js';
import {createVitals} from '../src/vitals.js';
import {createPhysics} from '../src/physics.js';
import {flatTerrain} from './helpers/flat-terrain.mjs';

test('3m means 2 hearts, 4m 3 hearts, 5m immediate death; lower falls safe',()=>{
 for(const [height,damage] of [[0,0],[2.99,0],[3,2],[3.99,2],
  [4,3],[4.99,3],[5,5],[15,5]])
  assert.equal(fallDamageForHeight(height),damage,`height ${height}`);
 assert.equal(fallDamageForHeight(NaN),0);
});
test('track peak after a jump and apply height difference from landing support',()=>{
 const tracker=createFallTracker();
 tracker.observe(5,5.7,false,7);
 tracker.observe(5.7,6.1,false,3);
 tracker.observe(6.1,4,false,-8);
 const hit=tracker.observe(4,2.1,true,-9);
 assert.equal(hit.damage,3,'drop from 6.1 to 2.1 is 4m');
 assert.ok(Math.abs(hit.height-4)<1e-8);
 assert.equal(hit.speed,9);
 assert.equal(tracker.take(),hit);
 assert.equal(tracker.take(),null);
 assert.equal(tracker.observe(2.1,2.1,true,0),null);
});
test('starting a fall off a ledge without jumping triggers only once on contact',()=>{
 const tracker=createFallTracker();
 tracker.observe(5,5,false,0);
 tracker.observe(5,2.5,false,-7);
 const impact=tracker.observe(2.5,0,true,-9);
 assert.equal(impact.damage,5);
 assert.equal(tracker.take()?.damage,5);
 assert.equal(tracker.observe(0,0,true,0),null);
});
test('manual ragdoll preserves the airborne fall peak, even if skeleton lands first',()=>{
 const tracker=createFallTracker();
 tracker.observe(7,6.7,false,-3);
 tracker.observeRagdoll(4,0,-8);
 assert.equal(tracker.take(),null);
 assert.equal(tracker.observeRagdoll(.18,0,-11)?.damage,5);
 assert.equal(tracker.take()?.damage,5);
 assert.equal(tracker.observeRagdoll(.1,0,0),null);
});
test('nonlethal landing subtracts hearts and starts ragdoll once; fatal invokes death instead',()=>{
 const vitals=createVitals(),events=[];
 const ctx={vitals:{damage:n=>{events.push(['damage',n]);const actual=vitals.damage(n);
   if(vitals.health===0)ctx.deathSystem.active=true;
   return actual;}},
  deathSystem:{active:false},ragdoll:{active:false},
  ragdollControls:{ragdoll:options=>{events.push(['ragdoll',options]);}},
  notify:(...args)=>events.push(['notify',...args]),isOnline:()=>false};
 assert.equal(applyFallImpact(ctx,{height:3,damage:2,speed:9}),true);
 assert.equal(vitals.health,3);
 assert.deepEqual(events.find(x=>x[0]==='ragdoll'),['ragdoll',{impactSpeed:9}]);
 assert.equal(applyFallImpact(ctx,{height:5,damage:5,speed:13}),true);
 assert.equal(vitals.health,0);
 assert.equal(events.filter(x=>x[0]==='ragdoll').length,1,'fatal uses death ragdoll');
});
test('online client never applies local health damage or ragdoll without server signal',()=>{
 const events=[];
 const ctx={isOnline:()=>true,deathSystem:{active:false},
  ragdoll:{active:false},vitals:{damage:()=>events.push('damage')},
  ragdollControls:{ragdoll:()=>events.push('ragdoll')}};
 const hit={height:4,damage:3,speed:11};
 assert.equal(applyFallImpact(ctx,hit),false);
 assert.deepEqual(events,[]);
 assert.equal(applyFallImpact(ctx,hit,{authoritative:true}),true);
 assert.deepEqual(events,['ragdoll']);
});
test('real kinematic controller generates one fall event on landing on a log at elevation',()=>{
 const ctx={terrain:flatTerrain(),trees:new Map(),placed:[{x:0,z:0,y:2.29,orientation:0}],
  PLAYER_RADIUS:.31,PLAYER_HEIGHT:1.7,logRadius:.29,chunkSize:24,
  rockColliders:new Map(),GRAVITY:19,JUMP_SPEED:7.5,
  fallTracker:createFallTracker(),px:0,pz:0,feetY:6.58,verticalSpeed:0,
  onGround:false,jumpRequested:false};
 const physics=createPhysics(ctx);
 for(let i=0;i<100&&!ctx.onGround;i++)physics.simulateVertical(.02);
 assert.equal(ctx.feetY,2.58);
 const hit=ctx.fallTracker.take();
 assert.equal(hit.damage,3,'4m drop onto log top');
 assert.ok(Math.abs(hit.height-4)<1e-6);
 for(let i=0;i<15;i++)physics.simulateVertical(.02);
 assert.equal(ctx.fallTracker.take(),null);
});

test('skyrim bounce after 4m fall never causes second ragdoll impact or lethal damage',()=>{
 const tracker=createFallTracker();
 tracker.observe(4,3,false,-3);
 tracker.observe(3,1.5,false,-8);
 assert.equal(tracker.observe(1.5,0,true,-12)?.damage,3);
 assert.equal(tracker.take()?.damage,3);
 // The physical skeleton is launched five metres into the air by a solver
 // glitch. That is still the SAME landing, not a new fall event.
 for(const feetY of [.2,1.4,3.5,5,3.2,1,.17,.07]){
  assert.equal(tracker.observeRagdoll(feetY,0,-6),null);
  assert.equal(tracker.take(),null);
 }
 // If the player stands up in the air, the rebounding landing is still free.
 assert.equal(tracker.observe(5,2,false,-9),null);
 assert.equal(tracker.observe(2,0,true,-12),null);
 tracker.observe(0,4,false,7); // A truly new jump after grounding.
 assert.equal(tracker.observe(4,0,true,-12)?.damage,3);
});

test('manual ragdoll then midair get-up preserves original fall height',()=>{
 const tracker=createFallTracker();
 tracker.observe(6,4,false,-7);
 tracker.observeRagdoll(3,0,-8);
 assert.equal(tracker.take(),null);
 // No contact occurred before exiting ragdoll: the next two metres are part
 // of the same original fall, rather than a new fall from just 3m.
 assert.equal(tracker.observe(3,0,true,-11)?.damage,5);
 tracker.reset();
 assert.equal(tracker.observe(0,0,true,0),null);
});
