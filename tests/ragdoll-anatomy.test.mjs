import assert from 'node:assert/strict';
import test from 'node:test';
import {calibrateLimbJoint,RAGDOLL_LIMB_END_BONES} from '../src/ragdoll-anatomy.js';

const v=(x,y,z)=>({x,y,z});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const norm=a=>Math.hypot(a.x,a.y,a.z);
const sub=(a,b)=>v(a.x-b.x,a.y-b.y,a.z-b.z);
const cross=(a,b)=>v(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);
const bend=(a,b,c)=>{
 const upper=sub(b,a),lower=sub(c,b);
 return Math.acos(Math.max(-1,Math.min(1,dot(upper,lower)/(norm(upper)*norm(lower)))));
};
function rotateAroundAxis(d,axis,angle){
 const c=Math.cos(angle),s=Math.sin(angle),x=cross(axis,d),dota=dot(axis,d);
 return v(d.x*c+x.x*s+axis.x*dota*(1-c),
  d.y*c+x.y*s+axis.y*dota*(1-c),
  d.z*c+x.z*s+axis.z*dota*(1-c));
}
test('real GLB-style elbow geometry finds the correct hinge plane and direction',()=>{
 // Measured from the bind pose of game/body_male.glb. The forearm flexes
 // forward, so the old hard-coded [0,0,1] axis does not follow the anatomy.
 const shoulder=v(.18,1.37,.02),elbow=v(.35,1.18,.02),wrist=v(.48,1.05,.20);
 const data=calibrateLimbJoint(shoulder,elbow,wrist);
 assert.ok(data);
 assert.ok(data.bend>.6 && data.bend<.95,'default elbow is bent ~46°');
 assert.ok(Math.abs(data.axis.z)<.10,'hinge axis must not be the old Z axis');
 assert.ok(data.limits[0]<data.target&&data.target<data.limits[1]);
 assert.ok(data.target<-.4,'straight position is NOT joint zero');
 const upper=sub(elbow,shoulder),lower=sub(wrist,elbow);
 const corrected=rotateAroundAxis(lower,data.axis,data.target);
 const straightBend=Math.acos(Math.max(-1,Math.min(1,dot(upper,corrected)/(norm(upper)*norm(corrected)))));
 assert.ok(Math.abs(straightBend-.12)<1e-8,
   'rotating in the specified direction should straighten, not fold the arm');
});

test('both mirrored arms and near-straight knees use their own offsets',()=>{
 for(const mirror of [-1,1]){
  const a=v(.18*mirror,1.37,.02),b=v(.35*mirror,1.18,.02),c=v(.48*mirror,1.05,.20);
  const elbow=calibrateLimbJoint(a,b,c);
  assert.ok(elbow);
  assert.ok(elbow.target<0);
  assert.ok(elbow.limits[0]<=elbow.target&&elbow.limits[1]>=elbow.target);
  assert.ok(Math.abs(dot(elbow.axis,sub(b,a)))<1e-8);
  assert.ok(Math.abs(dot(elbow.axis,sub(c,b)))<1e-8);
 }
 const knee=calibrateLimbJoint(v(.11,.91,0),v(.15,.50,.03),v(.19,.07,.02));
 assert.ok(knee?.bend<.20);
 assert.ok(Math.abs(knee.target)<.15);
 assert.ok(knee.limits[0]<knee.target);
});

test('post-fall knee limit prevents the 140 degree trapped pose',()=>{
 const hip=v(.11,.91,0),knee=v(.15,.50,.03),ankle=v(.19,.07,.02);
 const result=calibrateLimbJoint(hip,knee,ankle,{maxBend:1.55});
 assert.ok(result);
 // The joint is born at angle=0 with an existing small knee bend.
 // Its maximum positive rotation cannot reach the previous 2.45 radians.
 assert.ok(result.bend+result.limits[1]<1.56);
 assert.ok(result.bend+result.limits[1]>1.54);
 assert.ok(result.bend+result.limits[1]<2.45);
});

test('only authored wrist/ankle landmarks are accepted as terminal endpoints',()=>{
 assert.deepEqual(Object.keys(RAGDOLL_LIMB_END_BONES).sort(),
  ['Forearm.L','Forearm.R','Shin.L','Shin.R']);
 assert.equal(RAGDOLL_LIMB_END_BONES['Forearm.L'],'hand_l');
 assert.equal(RAGDOLL_LIMB_END_BONES['Shin.R'],'foot_r');
 assert.equal(calibrateLimbJoint(v(0,0,0),v(0,0,0),v(1,0,0)),null);
 assert.equal(calibrateLimbJoint(v(0,0,0),v(0,1,0),v(0,2,0)),null);
});
