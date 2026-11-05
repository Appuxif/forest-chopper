import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CHARACTER_PROFILES,SHARED_AXE_ASSET} from '../src/character-model-selection.js';

function readGlb(file){
 const raw=readFileSync(new URL(file,import.meta.url));
 assert.equal(raw.toString('ascii',0,4),'glTF');
 const size=raw.readUInt32LE(12);
 return {raw,gltf:JSON.parse(raw.toString('utf8',20,20+size)),
  binOffset:20+size+8};
}
function floats(glb,accessorId){
 const {raw,gltf,binOffset}=glb;
 const a=gltf.accessors[accessorId],view=gltf.bufferViews[a.bufferView];
 assert.equal(a.componentType,5126);
 const n={SCALAR:1,VEC3:3,VEC4:4}[a.type];
 assert.ok(n);
 const offset=binOffset+(view.byteOffset??0)+(a.byteOffset??0);
 const stride=view.byteStride??n*4;
 return Array.from({length:a.count},(_,i)=>
  Array.from({length:n},(_,j)=>raw.readFloatLE(offset+i*stride+j*4)));
}
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const mul=(v,n)=>v.map(x=>x*n);
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
const norm=a=>Math.hypot(...a);
const unit=a=>mul(a,1/norm(a));
const mean=points=>mul(points.reduce(add,[0,0,0]),1/points.length);
const identity=[0,0,0,1];
function qmul(a,b){
 const [x,y,z,w]=a,[u,v,t,s]=b;
 return [w*u+x*s+y*t-z*v,w*v-x*t+y*s+z*u,
  w*t+x*v-y*u+z*s,w*s-x*u-y*v-z*t];
}
function qrot(q,vector){
 const [x,y,z,w]=q,uv=[y*vector[2]-z*vector[1],
  z*vector[0]-x*vector[2],x*vector[1]-y*vector[0]];
 const uuv=[y*uv[2]-z*uv[1],z*uv[0]-x*uv[2],x*uv[1]-y*uv[0]];
 return add(vector,add(mul(uv,2*w),mul(uuv,2)));
}
function majorAxis(vertices){
 const center=mean(vertices);
 const covariance=Array.from({length:3},()=>[0,0,0]);
 for(const vertex of vertices){
  const p=sub(vertex,center);
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)
   covariance[i][j]+=p[i]*p[j];
 }
 let axis=unit([1,.1,.1]);
 for(let i=0;i<80;i++)
  axis=unit(covariance.map(row=>dot(row,axis)));
 return axis;
}
function actionWorldQuaternion(body,nodeName,animationName){
 const {gltf}=body,parents=new Map(),nodes=gltf.nodes;
 for(let i=0;i<nodes.length;i++)for(const child of nodes[i].children??[])
  parents.set(child,i);
 const clip=gltf.animations.find(a=>a.name===animationName);
 assert.ok(clip,animationName);
 const rotations=new Map();
 for(const channel of clip.channels){
  if(channel.target.path!=='rotation')continue;
  const sampler=clip.samplers[channel.sampler];
  rotations.set(channel.target.node,floats(body,sampler.output)[0]);
 }
 const target=nodes.findIndex(n=>n.name===nodeName);
 assert.ok(target>=0,nodeName);
 let result=identity;
 const path=[];
 for(let index=target;index!==undefined;index=parents.get(index))path.unshift(index);
 for(const i of path)result=qmul(result,rotations.get(i)??nodes[i].rotation??identity);
 return unit(result);
}

test('lumberjack uses the universal axe upright with forward blade on Idle',()=>{
 const body=readGlb('../characters/humanoid/game/body_legacy.glb');
 const weapon=readGlb('../'+SHARED_AXE_ASSET.split('?')[0]);
 const hand=actionWorldQuaternion(body,'hand_r','idle');
 const classic=CHARACTER_PROFILES.legacy.handRight;
 const socketRot=classic.quaternion;
 const socketPos=classic.position;
 const grip=weapon.gltf.nodes[0];
 const gripRot=grip.rotation;
 const gripPos=grip.translation;
 const meshPositions=name=>{
  const node=weapon.gltf.nodes.find(n=>n.name===name);
  assert.ok(node,name);
  return floats(weapon,weapon.gltf.meshes[node.mesh].primitives[0].attributes.POSITION);
 };
 const handle=meshPositions('Axe Handle · Male');
 const blade=meshPositions('Axe Forged blade · Male');
 const bladeDelta=sub(mean(blade),mean(handle));
 let shaft=majorAxis(handle);
 if(dot(shaft,bladeDelta)<0)shaft=mul(shaft,-1);
 const radial=unit(sub(bladeDelta,mul(shaft,dot(shaft,bladeDelta))));

 const uncorrected=qrot(qmul(hand,gripRot),shaft);
 const correctedRotation=qmul(qmul(hand,socketRot),gripRot);
 const up=qrot(correctedRotation,shaft);
 const forward=qrot(correctedRotation,radial);

 // Original 13-bone lumberjack.glb Idle reference, converted to glTF Y-up.
 const originalUp=unit([-.04060,.98564,-.16389]);
 const originalForward=unit([.14494,.16810,.97506]);
 const angle=(a,b)=>Math.acos(Math.max(-1,Math.min(1,dot(unit(a),unit(b)))))*180/Math.PI;
 assert.ok(angle(uncorrected,[0,1,0])>70,
  'regression must reproduce the original broken horizontal axe');
 assert.ok(angle(up,originalUp)<.1,'shaft must match original upright axe');
 assert.ok(angle(forward,originalForward)<.1,
  'blade radial direction must match original forward-facing edge');

 // Bottom of the longer shared handle must remain seated in the palm.
 const center=mean(handle);
 const projections=handle.map(vertex=>dot(sub(vertex,center),shaft));
 const minimum=Math.min(...projections);
 const bottom=mean(handle.filter((_,i)=>projections[i]<minimum+.01));
 const wristToBase=add(socketPos,
  qrot(socketRot,add(gripPos,qrot(gripRot,bottom))));
 assert.ok(norm(wristToBase)<.05,
  'handle must remain within 5cm of hand_r');
 // Corrections are data-driven; the shared weapon and other bodies are not altered.
 assert.equal(CHARACTER_PROFILES.male.handRight,undefined);
 assert.equal(CHARACTER_PROFILES.female.handRight,undefined);
});
