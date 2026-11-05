import test from 'node:test';
import assert from 'node:assert/strict';
import {steerMob} from '../src/mob-steering.js';
import {buildMobFlocks,flockHeading} from '../src/mob-flocking.js';
import {createMobWorld} from '../src/mob-world.js';
const settings={radius:6,catchUpRadius:12,separation:1,cohesion:.7};
test('blocked movement randomly chooses a free side and holds it across subsequent frames',()=>{
 const mob={x:0,z:0};const safePoint=(x,z)=>x>.1&&Math.abs(z)<2?null:0;
 const run=()=>steerMob(mob,{dt:.1,speed:3.6,yaw:Math.PI/2,safePoint,random:()=>.25});
 const first=run();assert.ok(first);assert.ok(first.turned);assert.ok(Math.abs(first.x)<.1);assert.ok(first.z>0);
 Object.assign(mob,first);const second=run();assert.ok(second);assert.ok(second.z>first.z);assert.ok(Math.abs(second.x)<.1);
});
test('enclosed mob stays put, limits retry probes and checks the segment rather than teleporting through it',()=>{
 const mob={x:0,z:0};let probes=0,rolls=0;
 const args={dt:.1,speed:3.6,yaw:0,safePoint:()=>{probes++;return null;},random:()=>{rolls++;return .5;}};
 assert.equal(steerMob(mob,args),null);assert.ok(probes<=40);const before=probes,randomBefore=rolls;
 assert.equal(steerMob(mob,args),null);assert.equal(probes-before,1);assert.equal(rolls,randomBefore);
 const point=steerMob({x:0,z:0},{dt:10,speed:3.6,yaw:Math.PI/2,safePoint:(x,z)=>x>.15&&x<.3?null:0,random:()=>.5});
 assert.ok(point);assert.ok(point.x<=.15,'must not cross an obstructed segment even on a long frame');
});
test('centroid moves with the flock and does not include other groups or dead members',()=>{
 const members=[{id:'a',cx:0,cz:0,hp:1,x:0,z:0},{id:'b',cx:0,cz:0,hp:1,x:1,z:0},{id:'c',cx:0,cz:0,hp:1,x:50,z:0},
 {id:'other',cx:1,cz:0,hp:1,x:1000,z:0},{id:'dead',cx:0,cz:0,hp:0,x:999,z:0}];
 const group=buildMobFlocks(members).get('0,0');assert.equal(group.members.length,3);assert.equal(group.x,17);
 const heading=flockHeading(members[0],group,{x:0,z:1},settings);assert.ok(heading.catchingUp);assert.ok(Math.sin(heading.yaw)>0);
 const outlier=flockHeading(members[2],group,{x:1,z:0},settings);assert.ok(Math.sin(outlier.yaw)<0);
 members[2].x=2;assert.equal(buildMobFlocks(members).get('0,0').x,1);
 assert.equal(flockHeading(members[0],buildMobFlocks(members).get('0,0'),{x:0,z:1},settings).needsMove,false);
});
test('flock separation discourages merging and unanchored solo fixtures have no centroid force',()=>{
 const a={id:'a',hp:1,x:0,z:0,cx:0,cz:0},b={id:'b',hp:1,x:.2,z:0,cx:0,cz:0};
 assert.ok(flockHeading(a,buildMobFlocks([a,b]).get('0,0'),{x:0,z:1},settings).yaw<0);
 assert.equal(flockHeading(a,buildMobFlocks([a]).get('0,0'),{x:0,z:1},settings),null);
});
test('birth anchors halve centroid drift and attract a living singleton home',()=>{
 const a={id:'a',hp:1,x:20,z:0,spawnX:0,spawnZ:0,cx:0,cz:0};
 const b={id:'b',hp:1,x:20,z:0,spawnX:0,spawnZ:0,cx:0,cz:0};
 const group=buildMobFlocks([a,b]).get('0,0');assert.equal(group.x,10);
 const solo={...a,id:'solo',x:40};const one=buildMobFlocks([solo]).get('0,0');
 assert.equal(flockHeading(solo,one,{x:0,z:1},settings).distance,20);
 assert.ok(flockHeading(solo,one,{x:0,z:1},settings).catchingUp);
 solo.x=1;
 const nearHome=flockHeading(solo,buildMobFlocks([solo]).get('0,0'),{x:0,z:1},settings);
 assert.equal(nearHome.catchingUp,false);assert.equal(nearHome.needsMove,false);
});
test('fleeing overrides flock attraction, but a blocked fleeing mob still makes a detour',()=>{
 const world=createMobWorld({seed:12});
 const a=world.spawnTransient('chicken',5,0,{flockId:'test'});world.spawnTransient('chicken',-20,0,{flockId:'test'});world.spawnTransient('chicken',-21,0,{flockId:'test'});
 let rows=world.tick(.1,[{x:4,z:0}]);assert.ok(rows.find(r=>r.id===a.id).x>5);
 const blocked=createMobWorld({seed:12,canStand:(x,z)=>x<=.1||Math.abs(z)>2});
 const bird=blocked.spawnTransient('chicken',0,0);rows=blocked.tick(.1,[{x:-2,z:0}]);const moved=rows.find(r=>r.id===bird.id);
 assert.ok(moved);assert.ok(Math.abs(moved.z)>.1);assert.ok(moved.x<=.1);assert.equal(moved.state,'Run');
});

test('a scattered flock regroups around its birth centroid during prolonged quiet wandering',()=>{
 const world=createMobWorld({seed:12}),ids=[0,1,50].map(x=>world.spawnTransient('chicken',x,0,{flockId:'flock'}).id);
 let rows=world.tick(0,[{x:20,z:40}]).filter(r=>ids.includes(r.id));
 for(let i=0;i<1200;i++){
  const x=rows.reduce((n,r)=>n+r.x,0)/3,z=rows.reduce((n,r)=>n+r.z,0)/3;
  rows=world.tick(.1,[{x,z:z+40}]).filter(r=>ids.includes(r.id));assert.equal(rows.length,3);
 }
 assert.ok(Math.max(...rows.flatMap(a=>rows.map(b=>Math.hypot(a.x-b.x,a.z-b.z))))<15);
 assert.ok(Math.abs(rows.reduce((n,r)=>n+r.x,0)/3-17)<12,'long-term centroid must stay bounded around its birth centroid');
});
test('live saves retain birth anchors and legacy saves derive them from deterministic sites',()=>{
 const world=createMobWorld({seed:84});let rows=world.tick(0,[{x:0,z:0}]);const mob=rows.find(r=>r.cx===0&&r.cz===0);
 assert.ok(mob);const home=[mob.spawnX,mob.spawnZ];
 const snapshot=world.snapshot();const live=snapshot.populations.chicken.live.find(r=>r.id===mob.id);
 live.x+=80;live.z-=30;
 assert.deepEqual([live.spawnX,live.spawnZ],home);
 const restored=createMobWorld({seed:84});assert.equal(restored.restore(snapshot),true);
 assert.deepEqual([restored.tick(0,[{x:live.x,z:live.z}]).find(r=>r.id===mob.id).spawnX,
  restored.getRecord(mob.id).spawnZ],home);
 delete live.spawnX;delete live.spawnZ;const legacy=createMobWorld({seed:84});assert.equal(legacy.restore(snapshot),true);
 const legacyRow=legacy.tick(0,[{x:live.x,z:live.z}]).find(r=>r.id===mob.id);
 assert.deepEqual([legacyRow.spawnX,legacyRow.spawnZ],home);
 assert.equal(legacyRow.x,live.x);assert.equal(legacyRow.z,live.z);
 const malformed=world.snapshot();const malformedLive=malformed.populations.chicken.live.find(r=>r.id===mob.id);delete malformedLive.spawnZ;
 assert.equal(createMobWorld({seed:84}).restore(malformed),false);
});
