import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHenRagdoll} from '../src/hen-ragdoll.js';
import {henCollisionGroups} from '../src/hen-ragdoll-joints.js';

// Optional CLI physics QA: use the exact Three/Rapier versions from the game,
// installed outside the repository. No browser, renderer or production save.
const deps=process.env.HEN_PHYSICS_NODE_MODULES;
test('head and feet remain extended under gravity/impact in real Rapier, including a peck pose', {skip:!deps},async()=>{
 const T=await import(pathToFileURL(deps+'/three/build/three.module.js'));
 const {default:R}=await import(pathToFileURL(deps+'/@dimforge/rapier3d-compat/dist/rapier.mjs'));
 await R.init();
 const buffer=fs.readFileSync(new URL('../assets/models/hen.glb',import.meta.url));
 const jsonLength=buffer.readUInt32LE(12),data=JSON.parse(buffer.subarray(20,20+jsonLength).toString()),binaryOffset=28+jsonLength;
 function accessor(index){
  const a=data.accessors[index],view=data.bufferViews[a.bufferView],width={SCALAR:1,VEC3:3,VEC4:4}[a.type];
  assert.equal(a.componentType,5126);
  return {width,values:new Float32Array(buffer.buffer,buffer.byteOffset+binaryOffset+(view.byteOffset??0)+(a.byteOffset??0),a.count*width)};
 }
 for(const [clip,time,yaw] of [['Idle',0,0],['Run',.2,Math.PI/2],['Peck',.7,Math.PI]]){
  const boneIndices=new Set(data.skins.flatMap(s=>s.joints));
  const nodes=data.nodes.map((n,i)=>{const o=boneIndices.has(i)?new T.Bone():new T.Group();o.name=n.name??'';if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);return o;});
  data.nodes.forEach((n,i)=>n.children?.forEach(c=>nodes[i].add(nodes[c])));
  const animation=data.animations.find(a=>a.name===clip);
  for(const c of animation.channels){
   const s=animation.samplers[c.sampler],times=accessor(s.input).values,output=accessor(s.output),v=output.values,n=output.width;
   let i=0;while(i+1<times.length&&times[i+1]<time)i++;
   const j=Math.min(i+1,times.length-1),blend=times[j]===times[i]?0:Math.max(0,Math.min(1,(time-times[i])/(times[j]-times[i]))),node=nodes[c.target.node];
   if(c.target.path==='rotation')node.quaternion.fromArray(v,i*n).slerp(new T.Quaternion().fromArray(v,j*n),blend);
   if(c.target.path==='translation')node.position.fromArray(v,i*n).lerp(new T.Vector3().fromArray(v,j*n),blend);
  }
  const root=nodes.find(n=>n.name==='Root');root.position.x=root.position.z=0;
  const visual=new T.Group();data.scenes[data.scene??0].nodes.forEach(i=>visual.add(nodes[i]));visual.scale.setScalar(.4);visual.rotation.y=yaw;visual.updateMatrixWorld(true);
  const pos=name=>nodes.find(n=>n.name===name).getWorldPosition(new T.Vector3());
  const headBefore=pos('Head').distanceTo(pos('Chest'));
  const feetBefore=['L','R'].map(side=>pos('Leg.Foot.'+side).distanceTo(pos('Spine')));
  const ctx={THREE:T,GRAVITY:19,collisionWorld:{revision:0,collect:()=>[],terrainMesh:()=>({vertices:new Float32Array([-50,0,-50,-50,0,50,50,0,50,50,0,-50]),indices:new Uint32Array([0,1,2,0,2,3])})}};
  const rag=await createHenRagdoll(ctx,visual,{velocityX:2,velocityZ:1,loadPhysics:async()=>R});
  try{
   for(let i=0;i<300;i++){
    rag.tick(1/60);
    assert.ok(pos('Head').distanceTo(pos('Chest'))>=headBefore*.7-.01,clip+' head collapsed');
    for(const [j,side] of ['L','R'].entries())assert.ok(pos('Leg.Foot.'+side).distanceTo(pos('Spine'))>=feetBefore[j]*.65,clip+' foot folded into body');
    for(const node of nodes)assert.ok(node.position.toArray().every(Number.isFinite),clip+' invalid transform');
   }
  }finally{rag.dispose();}
 }
});
test('head collides with torso while adjacent feathers/legs do not repel each other',()=>{
 const collides=(a,b)=>((a>>>16)&(b&65535))!==0&&((b>>>16)&(a&65535))!==0;
 assert.equal(collides(henCollisionGroups('Head'),henCollisionGroups('Spine')),true);
 assert.equal(collides(henCollisionGroups('Leg.Thigh.L'),henCollisionGroups('Spine')),false);
 assert.equal(collides(henCollisionGroups('Chest'),henCollisionGroups('Spine')),false);
 for(const name of ['Head','Chest','Leg.Shin.L'])assert.equal(collides(henCollisionGroups(name),(1<<16)|2),true);
});
