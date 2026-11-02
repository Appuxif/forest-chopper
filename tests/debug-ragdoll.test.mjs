import {bedRestPose} from '../src/ragdoll-controls.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {findRagdollBones,makeGroundMesh,RAGDOLL_BONES,RAGDOLL_JOINTS} from '../src/ragdoll.js';

test('GLB ragdoll bone lookup tolerates Three.js sanitized names',()=>{
 const names=['Hips','Spine','Head','UpperArm_L','Forearm_L','UpperArm_R','Forearm_R',
   'Thigh_L','Shin_L','Thigh_R','Shin_R'];
 const nodes=names.map(name=>({name,isBone:true}));
 const visual={traverse(fn){for(const node of nodes)fn(node);}};
 const bones=findRagdollBones(visual);
 assert.equal(bones.size,11);
 assert.equal(bones.get('UpperArm.L'),nodes[3]);
 assert.deepEqual([...bones.keys()],RAGDOLL_BONES);
 assert.throws(()=>findRagdollBones({traverse(fn){fn(nodes[0]);}}),/missing bone/);
});

test('ragdoll ground samples live terrain and forms upward-facing triangles',()=>{
 const terrain={heightAt(x,z){return x*.1+z*.05;}};
 const mesh=makeGroundMesh(terrain,8,12,3,1);
 assert.equal(mesh.vertices.length,7*7*3);
 assert.equal(mesh.indices.length,6*6*6);
 assert.equal(mesh.indices[0],0);
 // Terrain is sampled in world space; vertices live in a patch translated to player location.
 assert.ok(Math.abs(mesh.vertices[1]-terrain.heightAt(5,9))<1e-6);
 const a=mesh.indices[0]*3,b=mesh.indices[1]*3,c=mesh.indices[2]*3;
 const A=mesh.vertices.slice(a,a+3),B=mesh.vertices.slice(b,b+3),C=mesh.vertices.slice(c,c+3);
 const dx1=B[0]-A[0],dz1=B[2]-A[2],dx2=C[0]-A[0],dz2=C[2]-A[2];
 assert.ok(dz1*dx2-dx1*dz2>0,'front faces must point upward');
});


test('ragdoll uses a fixed torso and bounded, softly-restoring anatomical hinges',()=>{
 assert.equal(RAGDOLL_JOINTS.Spine.kind,'fixed');
 for(const name of ['Head','Thigh.L','Shin.L','Thigh.R','Shin.R','UpperArm.L','Forearm.R']){
   const joint=RAGDOLL_JOINTS[name];
   assert.equal(joint.kind,'hinge');
   assert.ok(joint.limits[0]<0 && joint.limits[1]>0);
   assert.ok(joint.limits[1]-joint.limits[0]<Math.PI,
     'the limb must not be able to rotate fully backward');
   assert.ok(joint.spring>0);
   assert.ok(Math.hypot(...joint.axis)===1);
 }
});


test('bed resting pose aligns the head toward the pillow for each orientation',()=>{
 for(const orientation of [0,1,2,3]){
  const bed={kind:'bed',x:10,z:15,orientation};
  const p=bedRestPose(bed,2);
  const yaw=orientation*Math.PI/2;
  const rotatedFeet=[Math.sin(yaw),Math.cos(yaw)];
  assert.ok(Math.abs(p.x-10-rotatedFeet[0]*.60)<1e-9);
  assert.ok(Math.abs(p.z-15-rotatedFeet[1]*.60)<1e-9);
  assert.ok(Math.abs(p.wakeX-10-rotatedFeet[0]*1.48)<1e-9);
  assert.ok(Math.abs(p.wakeZ-15-rotatedFeet[1]*1.48)<1e-9);
  assert.ok(Math.abs(p.y-2.72)<1e-9);
 }
});
