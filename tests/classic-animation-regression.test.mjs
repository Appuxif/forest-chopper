import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classicLocalRate,classicRemoteRate} from '../src/legacy-animation-rates.js';
import {canTransitionUpperBody,transitionLayer,CHOP_SPEED,runtimeClipName} from '../src/animations.js';

test('legacy Chop and Chop2 must never collide during clip renaming',()=>{
 const data=readFileSync(new URL('../lumberjack/lumberjack.glb',import.meta.url));
 assert.equal(data.toString('ascii',0,4),'glTF');
 const size=data.readUInt32LE(12);
 const gltf=JSON.parse(data.toString('utf8',20,20+size));
 const originals=gltf.animations.map(a=>a.name);
 assert.ok(originals.includes('Chop'));
 assert.ok(originals.includes('Chop2'));
 assert.notEqual(originals.indexOf('Chop'),originals.indexOf('Chop2'));
 const runtime=originals.map(name=>runtimeClipName('legacy',name));
 assert.equal(new Set(runtime).size,runtime.length,'classic must retain all authored actions');
 assert.deepEqual(runtime,originals,'never rename a classic animation');
 assert.equal(runtimeClipName('male','Chop'),'Chop2');
 assert.equal(runtimeClipName('female','walk_back'),'WalkBackward');
 assert.equal(runtimeClipName('female','run_backward'),'RunBackward');
 assert.equal(runtimeClipName('female','Chop2'),'Chop2');
 const duration=name=>{
  const animation=gltf.animations.find(a=>a.name===name);
  return Math.max(...animation.samplers.map(s=>gltf.accessors[s.input].max[0]));
 };
 assert.ok(duration('Chop2')>duration('Chop'),
  'the real classic Chop2 ends later than the old Chop; accidental overwrite cuts the swing');
 assert.ok(Math.abs(duration('Chop2')-1.7916666666666667)<1e-4);
 assert.ok(Math.abs(duration('Chop')-1.75)<1e-4);
});

test('classic local movement keeps its authored rates in both directions',()=>{
 for(const motion of ['Idle','Walk','Run','StrafeLeft','StrafeRight']){
  for(const sprint of [false,true]){
   for(const dir of [-1,1]){
    const rate=classicLocalRate(motion,sprint,dir);
    const expected=motion==='Idle'?1:
      motion.startsWith('Strafe')?(sprint?5:4):
      motion==='Run'?(dir<0?-2.35:2.35):(dir<0?-2.25:2.25);
    assert.equal(rate,expected,motion+' sprint='+sprint+' forward='+dir);
   }
  }
 }
});
test('classic remote player retains old non-reversed 24FPS playback speeds',()=>{
 assert.equal(classicRemoteRate('Run'),2.35);
 assert.equal(classicRemoteRate('Walk'),2.25);
 assert.equal(classicRemoteRate('StrafeLeft'),4);
 assert.equal(classicRemoteRate('StrafeRight'),4);
 assert.equal(classicRemoteRate('Idle'),1);
});

function fakeAction(duration=1){
 return {
  time:0,scale:1,duration,playCount:0,
  getClip(){return {duration:this.duration};},
  getEffectiveTimeScale(){return this.scale;},
  setEffectiveTimeScale(value){this.scale=value;return this;},
  setEffectiveWeight(){return this;},
  reset(){this.time=0;return this;},
  fadeIn(){return this;},fadeOut(){return this;},
  play(){this.playCount++;return this;},
 };
}
test('classic upper-body walk stays at 1x even when legs run at 2.35x',()=>{
 const a={model:'legacy',lower:{Run:fakeAction()},upper:{Run:fakeAction()},
  lowerState:'',upperState:'',rmTimes:{}};
 transitionLayer(null,a,'lower','Run',2.35);
 transitionLayer(null,a,'upper','Run',1);
 assert.equal(a.lower.Run.scale,2.35);
 assert.equal(a.upper.Run.scale,1);
 transitionLayer(null,a,'upper','Run',2.35);
 assert.equal(a.upper.Run.scale,1);
});
test('classic axe swing uses actual mixer frame, never elapsed wall-clock time',()=>{
 const clipDuration=1.7916666666666667;
 const actor={model:'legacy',upperState:'Chop2',
  upper:{Chop2:fakeAction(clipDuration)},chopEnd:1};
 assert.equal(CHOP_SPEED,1.6);
 for(const chopTime of [0,0.001,clipDuration*.5,clipDuration-0.1]){
  actor.upper.Chop2.time=chopTime;
  assert.equal(canTransitionUpperBody(actor,1_000_000),false,
   'do not interrupt Chop2 at time '+chopTime);
 }
 actor.upper.Chop2.time=clipDuration;
 assert.equal(canTransitionUpperBody(actor,1),true);
 actor.upperState='Walk';
 assert.equal(canTransitionUpperBody(actor,1),true);
 actor.model='male';actor.upperState='Chop2';actor.chopEnd=150;
 assert.equal(canTransitionUpperBody(actor,100),false);
 assert.equal(canTransitionUpperBody(actor,150),true);
});
test('classic and humanoid player branches remain distinct',()=>{
 const source=readFileSync(new URL('../src/player.js',import.meta.url),'utf8');
 assert.match(source,/ctx\.ownAvatar\?\.model==='legacy'\s*\?classicLocalRate/);
 assert.match(source,/avatar\.actor\.model==='legacy'\s*\?classicRemoteRate/);
 const animation=readFileSync(new URL('../src/animations.js',import.meta.url),'utf8');
 assert.match(animation,/actor\.model==='legacy'\?1:rate/);
});
