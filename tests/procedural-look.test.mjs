import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 createProceduralLook,lookJointAngles,
 SPINE_JOINTS,HEAD_JOINTS,
} from '../src/procedural-look.js';

// Minimal Three-compatible math for testing procedural look without browser,
// WebGL, CDN modules or Blender. Tests actual GLB bone/rest quaternions.
class Quaternion{
 constructor(x=0,y=0,z=0,w=1){Object.assign(this,{x,y,z,w})}
 clone(){return new Quaternion(this.x,this.y,this.z,this.w)}
 copy(q){Object.assign(this,{x:q.x,y:q.y,z:q.z,w:q.w});return this}
 setFromAxisAngle(a,t){
  const h=t/2,s=Math.sin(h);
  Object.assign(this,{x:a.x*s,y:a.y*s,z:a.z*s,w:Math.cos(h)});
  return this;
 }
 multiply(b){
  const a=this.clone();
  return this.copy(new Quaternion(
   a.x*b.w+a.w*b.x+a.y*b.z-a.z*b.y,
   a.y*b.w+a.w*b.y+a.z*b.x-a.x*b.z,
   a.z*b.w+a.w*b.z+a.x*b.y-a.y*b.x,
   a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z,
  ));
 }
 premultiply(q){return this.copy(q.clone().multiply(this))}
 invert(){const n=this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w;
  this.x=-this.x/n;this.y=-this.y/n;this.z=-this.z/n;this.w/=n;return this;}
}
class Vector3{
 constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z})}
 set(x,y,z){Object.assign(this,{x,y,z});return this}
 copy(v){return this.set(v.x,v.y,v.z)}
 applyQuaternion(q){
  const {x,y,z}=this;
  const qx=q.x,qy=q.y,qz=q.z,qw=q.w;
  const ix=qw*x+qy*z-qz*y,iy=qw*y+qz*x-qx*z,iz=qw*z+qx*y-qy*x;
  const iw=-qx*x-qy*y-qz*z;
  return this.set(ix*qw+iw*-qx+iy*-qz-iz*-qy,
    iy*qw+iw*-qy+iz*-qx-ix*-qz,
    iz*qw+iw*-qz+ix*-qy-iy*-qx);
 }
 normalize(){
  const l=Math.hypot(this.x,this.y,this.z)||1;
  return this.set(this.x/l,this.y/l,this.z/l);
 }
}
class Bone{
 constructor(name,q){this.name=name;this.quaternion=q??new Quaternion();this.parent=null}
 getWorldQuaternion(target){
  if(this.parent)return target.copy(this.parent.getWorldQuaternion(new Quaternion()))
    .multiply(this.quaternion);
  return target.copy(this.quaternion);
 }
}
const THREE={Quaternion,Vector3};
function glbJson(path){
 const buffer=readFileSync(new URL(path,import.meta.url));
 assert.equal(buffer.toString('ascii',0,4),'glTF');
 const jsonLength=buffer.readUInt32LE(12);
 return JSON.parse(buffer.toString('utf8',20,20+jsonLength));
}
function realRig(gender){
 const gltf=glbJson('../characters/humanoid/game/body_'+gender+'.glb');
 const visual=new Bone('visual',new Quaternion().setFromAxisAngle(
  new Vector3(0,1,0),Math.PI));
 const nodes=gltf.nodes.map(data=>new Bone(data.name,
  new Quaternion(...(data.rotation||[0,0,0,1]))));
 for(const [i,data] of gltf.nodes.entries())
  for(const child of data.children||[])nodes[child].parent=nodes[i];
 for(const node of nodes)if(!node.parent)node.parent=visual;
 const bones=new Map(nodes.map(node=>[node.name,node]));
 return {bones,gltf};
}
const close=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<=tol,`Expected ${a} ≈ ${b}`);
function forward(bone){return new Vector3(0,0,1)
 .applyQuaternion(bone.getWorldQuaternion(new Quaternion())).normalize();}
function yawOf(vector){return Math.atan2(-vector.x,-vector.z)}
function pitchOf(vector){return Math.asin(Math.max(-1,Math.min(1,vector.y)))}
function angleDelta(a,b){return Math.atan2(Math.sin(b-a),Math.cos(b-a))}

test('rig hierarchy matches procedural spine chain for both genders',()=>{
 for(const gender of ['male','female']){
  const {bones}=realRig(gender);
  const chain=['pelvis',...SPINE_JOINTS,...HEAD_JOINTS];
  for(let i=1;i<chain.length;i++)
   assert.equal(bones.get(chain[i]).parent,bones.get(chain[i-1]),
    gender+' '+chain[i]);
 }
});

test('relevant humanoid clips key each look bone on both rigs (mixer restores pose)',()=>{
 for(const gender of ['male','female']){
  const {gltf}=realRig(gender);
  for(const clipName of ['idle','walk','walk_back','run','run_backward','Chop']){
   const clip=gltf.animations.find(a=>a.name===clipName);
   assert.ok(clip,gender+' '+clipName+' missing');
   const channels=new Set(clip.channels
    .filter(ch=>ch.target.path==='rotation')
    .map(ch=>gltf.nodes[ch.target.node].name));
   for(const name of [...SPINE_JOINTS,...HEAD_JOINTS])
    assert.ok(channels.has(name),gender+' '+clipName+' must animate '+name);
  }
 }
});

test('joint angles distribute 100% of torso and head motion, without pelvis/thigh keys',()=>{
 const o={legsYaw:-.8,torsoYaw:-.35,torsoPitch:-.5,headYaw:.3,headPitch:-.4};
 const angles=lookJointAngles(o);
 assert.deepEqual(angles.map(a=>a.name),[...SPINE_JOINTS,...HEAD_JOINTS]);
 const sum=part=>part.reduce((acc,a)=>({
  yaw:acc.yaw+a.yaw,pitch:acc.pitch+a.pitch,
 }),{yaw:0,pitch:0});
 const chest=sum(angles.slice(0,3)),head=sum(angles.slice(3));
 close(chest.yaw,.45);close(chest.pitch,-.5);
 close(head.yaw,.3);close(head.pitch,-.4);
});

test('world-space rotations aim the real GLB head down and across without twisting pelvis',()=>{
 for(const gender of ['male','female']){
  const {bones}=realRig(gender);
  const chest=bones.get('spine_03'),head=bones.get('head'),pelvis=bones.get('pelvis');
  const baseHead=forward(head),baseChest=forward(chest);
  const savedPelvis=pelvis.quaternion.clone();
  const look=createProceduralLook(THREE,bones);
  assert.ok(look,gender+' look module should initialize');
  const orientation={
   cameraYaw:Math.PI/4,cameraPitch:-Math.PI/3,
   legsYaw:0,torsoYaw:Math.PI/8,
   torsoPitch:-Math.PI/3*.62,headYaw:Math.PI/8,
   headPitch:-Math.PI/3*.38,
  };
  assert.equal(look.apply(orientation),true);
  const headAim=forward(head),chestAim=forward(chest);
  // The two spine/head channels together turn close to the actual camera,
  // despite imported Blender bone rotations being non-identity.
  close(angleDelta(yawOf(baseHead),yawOf(headAim)),orientation.cameraYaw,.19);
  close(pitchOf(headAim)-pitchOf(baseHead),orientation.cameraPitch,.21);
  assert.ok(pitchOf(chestAim)<pitchOf(baseChest)-.23,
   gender+' chest should visibly lean toward a low target');
  assert.deepEqual(pelvis.quaternion,savedPelvis,'pelvis and legs must stay untouched');
 }
});

test('restoring after each mixer frame avoids accumulating procedural rotations',()=>{
 for(const gender of ['male','female']){
  const {bones}=realRig(gender);
  const look=createProceduralLook(THREE,bones);
  const names=[...SPINE_JOINTS,...HEAD_JOINTS];
  const before=new Map(names.map(name=>[name,bones.get(name).quaternion.clone()]));
  const pose={cameraYaw:.4,cameraPitch:-.3,legsYaw:0,
   torsoYaw:.2,headYaw:.2,torsoPitch:-.2,headPitch:-.1};
  look.apply(pose);
  const first=new Map(names.map(name=>[name,bones.get(name).quaternion.clone()]));
  look.apply(pose);
  for(const name of names)
   assert.deepEqual(bones.get(name).quaternion,first.get(name),
    'double apply must be idempotent at '+name);
  look.restore();
  for(const name of names)
   assert.deepEqual(bones.get(name).quaternion,before.get(name),
    'restore must recover the original authored pose at '+name);
  look.apply(pose);
  look.discard();
  const fallen=new Quaternion(.3,.2,.1,.8);
  bones.get('head').quaternion.copy(fallen);
  look.restore();
  assert.deepEqual(bones.get('head').quaternion,fallen,
   'ragdoll discard must never overwrite physics rotations');
 }
});

test('legacy or incomplete rig safely skips procedural look',()=>{
 assert.equal(createProceduralLook(THREE,null),null);
 assert.equal(createProceduralLook(THREE,new Map([['head',new Bone('head')]])),null);
});

test('look applies after mixer update and is disabled for ragdoll/death',()=>{
 const player=readFileSync(new URL('../src/player.js',import.meta.url),'utf8');
 const animations=readFileSync(new URL('../src/animations.js',import.meta.url),'utf8');
 assert.match(animations,/actor\.proceduralLook\?\.restore\(\);[\s\S]*actor\.human\.update\(dt\)/);
 assert.match(player,/ctx\.tickActor\(ctx\.ownAvatar,dt,motion,!ctx\.onGround,rate\);[\s\S]*ctx\.ownAvatar\.proceduralLook\?\.apply\(ctx\.characterOrientation\)/);
 assert.match(player,/if\(posing\|\|dead\)ctx\.ownAvatar\?\.proceduralLook\?\.discard\(\)/);
 assert.match(animations,/proceduralLook:human\?createProceduralLook\(THREE,human\.bones\):null/);
});
