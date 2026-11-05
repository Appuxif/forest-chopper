import test from 'node:test';
import assert from 'node:assert/strict';
import {createMobVocalizations} from '../src/mob-vocalizations.js';
import {CHICKEN_TYPE} from '../src/mob-types.js';
import {MOB_VOICE_PROFILES} from '../src/sound-rules.js';

function fixture(random=()=>0){
 const played=[],mob={id:'hen:1',type:'chicken',hp:1,state:'Idle',flockFollowing:false,x:2,z:3};let ready=true;
 const voices=createMobVocalizations({definitionFor:id=>id==='chicken'?CHICKEN_TYPE:null,random,emit:(id,record)=>{if(!ready)return false;played.push({id,entity:record.id,x:record.x,z:record.z});return true;}});
 const advance=seconds=>{for(let i=0;i<Math.ceil(seconds/.05);i++)voices.tick(.05,[mob]);};
 return {voices,mob,played,advance,setReady:value=>{ready=value;}};
}
test('panic starts with one alarm, then random short calls; state packets cannot repeat the alarm',()=>{
 const f=fixture();f.voices.tick(0,[f.mob]);f.mob.state='Run';f.voices.tick(0,[f.mob]);
 assert.deepEqual(f.played.map(p=>p.id),['hen_alarm']);assert.equal(f.played[0].x,2);
 f.advance(.6);assert.equal(f.played.length,1,'alarm must finish before the short calls');
 f.advance(10);assert.equal(f.played.filter(p=>p.id==='hen_alarm').length,1);
 const calls=f.played.filter(p=>p.id!=='hen_alarm');assert.ok(calls.length>=20);
 for(let i=0;i<calls.length;i++){assert.ok(MOB_VOICE_PROFILES.chicken.clucks.includes(calls[i].id));if(i)assert.notEqual(calls[i].id,calls[i-1].id);}
 f.mob.state='Walk';f.voices.tick(0,[f.mob]);f.mob.state='Run';f.voices.tick(0,[f.mob]);
 assert.equal(f.played.filter(p=>p.id==='hen_alarm').length,2,'a new real panic gets a new single alarm');
});
test('running to catch up with the flock is quiet; changing that same Run into panic screams once',()=>{
 const f=fixture();f.mob.state='Run';f.mob.flockFollowing=true;f.voices.tick(0,[f.mob]);f.advance(5);assert.equal(f.played.length,0);
 f.mob.flockFollowing=false;f.voices.tick(0,[f.mob]);assert.deepEqual(f.played.map(p=>p.id),['hen_alarm']);
});
test('calm calls arrive in rare bursts of two, three or four, then a long pause',()=>{
 for(const [value,count] of [[0,2],[.5,3],[.999,4]]){
  const f=fixture(()=>value),gap=12+16*value;f.voices.tick(0,[f.mob]);f.advance(gap-.15);assert.equal(f.played.length,0);
  f.advance(2);assert.equal(f.played.length,count);assert.ok(f.played.every(p=>p.id!=='hen_alarm'));
  f.advance(8);assert.equal(f.played.length,count,'bursts must not run continuously');
 }
});
test('panic interrupts calm bursts; calming down cancels frequent fear calls',()=>{
 const f=fixture();f.voices.tick(0,[f.mob]);f.advance(12.05);assert.equal(f.played.length,1);
 f.mob.state='Run';f.voices.tick(0,[f.mob]);assert.equal(f.played.at(-1).id,'hen_alarm');
 f.mob.state='Idle';f.voices.tick(0,[f.mob]);const n=f.played.length;f.advance(11);assert.equal(f.played.length,n);
});
test('death, despawn and reset remove pending vocalizations without deferred timers',()=>{
 const f=fixture();f.mob.state='Run';f.voices.tick(0,[f.mob]);const n=f.played.length;
 f.mob.hp=0;f.advance(20);assert.equal(f.played.length,n+1);assert.equal(f.played.at(-1).id,'hen_death');assert.equal(f.voices.size,0);
 f.mob.hp=1;f.mob.state='Idle';f.voices.tick(0,[f.mob]);assert.equal(f.voices.size,1);
 f.voices.tick(.1,[]);assert.equal(f.voices.size,0);f.voices.clear();assert.equal(f.voices.size,0);
});
test('short loading delay retries an alarm once successfully; no stale alarm after its deadline',()=>{
 const f=fixture();f.setReady(false);f.mob.state='Run';f.voices.tick(0,[f.mob]);f.advance(.4);f.setReady(true);f.voices.tick(.05,[f.mob]);
 assert.deepEqual(f.played.map(p=>p.id),['hen_alarm']);f.advance(.6);assert.equal(f.played.length,1);f.advance(.2);assert.ok(f.played.length>1);
 const stale=fixture();stale.setReady(false);stale.mob.state='Run';stale.advance(3);stale.setReady(true);stale.advance(2);
 assert.ok(stale.played.length>0);assert.ok(stale.played.every(p=>p.id!=='hen_alarm'));
});
test('unknown voice profiles stay silent and large dt does not replay a backlog',()=>{
 const f=fixture();f.mob.type='unknown';f.advance(40);assert.equal(f.played.length,0);assert.equal(f.voices.size,0);
 f.mob.type='chicken';f.mob.state='Run';f.voices.tick(0,[f.mob]);const before=f.played.length;
 f.voices.tick(999,[f.mob]);assert.ok(f.played.length-before<=1);
});

test('death clip plays once on impact death, never when loading old corpses',()=>{
 const f=fixture();f.mob.hp=0;f.advance(2);assert.equal(f.played.length,0);
 f.mob.hp=1;f.voices.tick(0,[f.mob]);f.mob.hp=0;f.voices.tick(0,[f.mob]);
 assert.deepEqual(f.played.map(p=>p.id),['hen_death']);f.advance(5);assert.equal(f.played.length,1);
 f.voices.clear();f.advance(2);assert.equal(f.played.length,1);
});
