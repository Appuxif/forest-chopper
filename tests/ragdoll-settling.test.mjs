import assert from 'node:assert/strict';
import test from 'node:test';
import {
 createRagdollSettling,RAGDOLL_SETTLING,RAGDOLL_STRAIGHTEN_JOINTS,
} from '../src/ragdoll-settling.js';

function simulation({enabled=true}={}){
 const names=['Hips','Spine','Head','UpperArm.L','Forearm.L',
  'UpperArm.R','Forearm.R','Thigh.L','Shin.L','Thigh.R','Shin.R'];
 const parts=names.map(name=>{
  const body={
   linear:{x:0,y:0,z:0},angular:{x:0,y:0,z:0},woken:0,
   linvel(){return this.linear;},angvel(){return this.angular;},
   wakeUp(){this.woken++;},isSleeping(){return this.sleeping===true;},
  };
  return {name,body};
 });
 const joints=new Map(names.slice(1).map(name=>[name,{
  calls:[],configureMotorPosition(...args){this.calls.push(args);},
 }]));
 const targets=new Map([
  ['Forearm.L',-.65],['Forearm.R',-.75],
  ['Shin.L',-.12],['Shin.R',-.10],
 ]);
 const controller=createRagdollSettling(parts,joints,{enabled,targets});
 const part=name=>parts.find(p=>p.name===name).body;
 const joint=name=>joints.get(name);
 return {parts,joints,controller,part,joint,targets};
}
const tick=(c,seconds,step=1/60)=>{
 let remaining=seconds;
 while(remaining>1e-8){
  const dt=Math.min(step,remaining);
  c.tick(dt);remaining-=dt;
 }
};

test('settled means every segment has remained quiet for 0.75s',()=>{
 const {controller,part,joint}=simulation();
 tick(controller,.55);
 assert.equal(controller.state().settled,false);
 part('Forearm.L').angular.x=.65;
 tick(controller,.3);
 assert.equal(controller.state().settled,false);
 assert.equal(controller.state().stillSeconds,0);
 assert.equal(joint('Forearm.L').calls.length,0);
 part('Forearm.L').angular.x=0;
 tick(controller,.70);
 assert.equal(controller.state().settled,false);
 tick(controller,.08);
 assert.equal(controller.state().settled,true);
 assert.equal(controller.state().straightening,true);
 assert.ok(joint('Forearm.L').calls.length>0);
});

test('only elbow and knee motors ease towards the start pose over 3.5 seconds',()=>{
 const {controller,joints,parts,targets}=simulation();
 tick(controller,RAGDOLL_SETTLING.stillSeconds+.03);
 const names=Object.keys(RAGDOLL_STRAIGHTEN_JOINTS);
 for(const name of names){
  const calls=joints.get(name).calls;
  assert.ok(calls.length>0,name);
  assert.ok(calls.at(-1)[1]>0,'first motor is soft, not abrupt');
  assert.ok(calls.at(-1)[1]<RAGDOLL_STRAIGHTEN_JOINTS[name].stiffness*.01);
 }
 for(const name of ['UpperArm.L','Thigh.R','Spine','Head']){
  assert.equal(joints.get(name).calls.length,0,name+' stays passive/unmodified');
 }
 assert.ok(parts.filter(part=>part.body.woken>=1).length>=4,
   'active limb motors wake their physical segments');
 tick(controller,1);
 const half=controller.state();
 assert.equal(half.settled,true);
 assert.ok(half.straightenProgress>0 && half.straightenProgress<1);
 const middle=joints.get('Shin.L').calls.at(-1)[1];
 tick(controller,4);
 assert.equal(controller.state().straightenProgress,1);
 const final=joints.get('Shin.L').calls.at(-1);
 assert.ok(final[1]>middle);
 assert.ok(Math.abs(final[1]-RAGDOLL_STRAIGHTEN_JOINTS['Shin.L'].stiffness)<1e-8);
 assert.ok(Math.abs(final[2]-RAGDOLL_STRAIGHTEN_JOINTS['Shin.L'].damping)<1e-8);
});

test('a strong renewed movement disables motors and permits another settlement',()=>{
 const {controller,part,joints}=simulation();
 tick(controller,1.1);
 assert.equal(controller.state().settled,true);
 part('Hips').linear.x=1.2;
 tick(controller,.11);
 assert.equal(controller.state().settled,true,'brief impulse does not cause toggling');
 tick(controller,.13);
 assert.equal(controller.state().settled,false);
 assert.equal(controller.state().straightenProgress,0);
 for(const name of Object.keys(RAGDOLL_STRAIGHTEN_JOINTS))
  assert.deepEqual(joints.get(name).calls.at(-1),[0,0,0]);
 part('Hips').linear.x=0;
 tick(controller,.80);
 assert.equal(controller.state().settled,true,'can re-settle after rolling stops');
});

test('classic lumberjack and bed pose never enable post-fall straightening',()=>{
 const {controller,joints}=simulation({enabled:false});
 tick(controller,12);
 assert.equal(controller.state().settled,false);
 assert.equal(controller.state().straightening,false);
 assert.equal([...joints.values()].reduce((n,j)=>n+j.calls.length,0),0);
});

test('Rapier sleeping body is counted as motionless',()=>{
 const {controller,part}=simulation();
 const forearm=part('Forearm.R');
 forearm.sleeping=true;forearm.linear.x=8;forearm.angular.z=12;
 tick(controller,.80);
 assert.equal(controller.state().settled,true);
});

test('no calibrated hinge target means no motor, rather than guessing angle zero',()=>{
 const names=['Forearm.L','Forearm.R','Shin.L','Shin.R'];
 const joints=new Map(names.map(name=>[name,{
  calls:[],configureMotorPosition(...args){this.calls.push(args);},
 }]));
 const parts=names.map(name=>({name,body:{
  linvel:()=>({x:0,y:0,z:0}),
  angvel:()=>({x:0,y:0,z:0}),
 }}));
 const controller=createRagdollSettling(parts,joints,{enabled:true});
 tick(controller,10);
 assert.equal(controller.state().straightening,false);
 for(const joint of joints.values())assert.equal(joint.calls.length,0);
});

test('incorrect motor direction is stopped before folding a limb further',()=>{
 const {controller,part,joint}=simulation();
 // Both bodies initially point down (same direction, straight).
 const upright={x:0,y:0,z:0,w:1};
 part('UpperArm.L').rotation=()=>upright;
 const forearm=part('Forearm.L');
 forearm.rotation=()=>upright;
 tick(controller,.85);
 const before=joint('Forearm.L').calls.length;
 assert.ok(before>0);
 // Physical forearm rotates by 30 degrees away from the upper arm.
 forearm.rotation=()=>({x:0,y:0,z:Math.sin(Math.PI/12),w:Math.cos(Math.PI/12)});
 tick(controller,.6);
 assert.deepEqual(joint('Forearm.L').calls.at(-1),[0,0,0]);
 assert.ok(joint('Forearm.L').calls.length>=before);
 assert.ok(joint('Shin.L').calls.at(-1)[1]>0,'other limbs remain assisted');
});
