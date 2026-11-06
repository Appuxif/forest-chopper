import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createRagdoll} from '../src/ragdoll.js';
import {makeGroundMesh} from '../src/collision-world.js';

// An actual GLB animation frame matters: resting bind-pose physics passed
// while Rapier 0.20.0 hit RuntimeError: unreachable on 24/90 varied poses.
// Test all three playable rigs in a deterministic crowded scene, with
// animation, environment revisions and soft joint settling active.
const deps=process.env.HEN_PHYSICS_NODE_MODULES;
test('real Rapier 0.21 survives animated ragdolls in crowded changing environments',
 {skip:!deps},async()=>{
 const THREE=await import(pathToFileURL(deps+'/three/build/three.module.js'));
 const {default:R}=await import(pathToFileURL(deps+'/@dimforge/rapier3d-compat/dist/rapier.mjs'));
 await R.init();
 assert.equal(R.version(),'0.21.0','this regression requires the same Rapier as the browser');

 const assets=new Map(['male','female','legacy'].map(body=>{
  const bytes=readFileSync(new URL('../characters/humanoid/game/body_'+body+'.glb',import.meta.url));
  const length=bytes.readUInt32LE(12);
  const gltf=JSON.parse(bytes.toString('utf8',20,20+length));
  return [body,{bytes,gltf,binaryOffset:28+length}];
 }));
 const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
 function animatedActor(body,clip,phase,yaw,alt){
  const {bytes,gltf,binaryOffset}=assets.get(body);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  function accessor(id){
   const a=gltf.accessors[id],b=gltf.bufferViews[a.bufferView];
   assert.equal(a.componentType,5126);
   const width=widths[a.type],stride=b.byteStride??width*4;
   const base=binaryOffset+(b.byteOffset??0)+(a.byteOffset??0);
   return Array.from({length:a.count},(_,i)=>
    Array.from({length:width},(_,j)=>view.getFloat32(base+i*stride+j*4,true)));
  }
  const joints=new Set(gltf.skins.flatMap(s=>s.joints));
  const nodes=gltf.nodes.map((s,i)=>{
   const node=joints.has(i)?new THREE.Bone():new THREE.Group();
   node.name=s.name??'';
   if(s.translation)node.position.fromArray(s.translation);
   if(s.rotation)node.quaternion.fromArray(s.rotation);
   if(s.scale)node.scale.fromArray(s.scale);
   return node;
  });
  gltf.nodes.forEach((s,i)=>s.children?.forEach(child=>nodes[i].add(nodes[child])));
  const animation=gltf.animations.find(a=>a.name===clip);
  assert.ok(animation,body+' is missing '+clip);
  for(const channel of animation.channels){
   const sampler=animation.samplers[channel.sampler];
   const times=accessor(sampler.input).map(v=>v[0]);
   const i=Math.max(0,times.findIndex(t=>t>=phase*times.at(-1)));
   const frame=accessor(sampler.output)[i];
   const bone=nodes[channel.target.node];
   if(channel.target.path==='translation')bone.position.fromArray(frame);
   if(channel.target.path==='rotation')bone.quaternion.fromArray(frame);
   if(channel.target.path==='scale')bone.scale.fromArray(frame);
  }
  const visual=new THREE.Group();
  for(const i of gltf.scenes[gltf.scene??0].nodes)visual.add(nodes[i]);
  visual.rotation.y=Math.PI;
  const group=new THREE.Group();group.position.y=alt;group.rotation.y=yaw;group.add(visual);
  return {group,visual,human:{bones:new Map(nodes.filter(n=>n.isBone).map(n=>[n.name,n]))},
   mixer:{stopAllAction(){}},rmTimes:{},lowerState:'',upperState:''};
 }
 const seeded=initial=>{
  let seed=initial;
  return ()=>((seed=(Math.imul(seed,1664525)+1013904223)|0)>>>0)/4294967296;
 };
 const random=seeded(1234);
 const motions=['idle','run','run_backward','strafe_left','fall','Chop'];
 for(let scenario=0;scenario<60;scenario++){
  const body=['male','female','legacy'][scenario%3];
  const clip=motions[Math.floor(scenario/3)%motions.length];
  const phase=random(),yaw=random()*Math.PI*2;
  const altitude=[0,0,.6,1.6,4][scenario%5];
  const objects=Array.from({length:scenario%3===0?100:15},(_,i)=>{
   const angle=2*Math.PI*i/100,distance=.8+random()*9;
   return {kind:i%5?'rock':'tree',shape:'cylinder',
    x:Math.cos(angle)*distance,y:.45,z:Math.sin(angle)*distance,
    hy:.45,radius:.3+random()*.7};
  });
  const collisionWorld={
   revision:0,collect:()=>objects,
   terrainMesh:(x,z,size,step)=>makeGroundMesh({
    heightAt:(x,z)=>Math.sin(x*.12)*Math.cos(z*.23)*.15,
   },x,z,size,step),
  };
  const messages=[];
  const ctx={THREE,GRAVITY:19,px:0,pz:0,feetY:altitude,
   onGround:altitude===0,ownAvatar:animatedActor(body,clip,phase,yaw,altitude),
   yaw,isOnline:()=>false,collisionWorld,
   ragdollCamera:{enter(){},exit(){}},ragdollControls:{abort(){}},
   notify:message=>messages.push(message),
  };
  const rag=createRagdoll(ctx,{loadPhysics:async()=>R});
  await rag.trigger({impactSpeed:altitude===0?9:0});
  try{
   for(let step=0;step<360;step++){
    if(step%19===0)collisionWorld.revision++;
    if(step===250){objects[0].x+=.9;collisionWorld.revision++;}
    rag.tick(1/60);
    assert.equal(rag.state().physicsError,null,
     body+'/'+clip+' scenario '+scenario+' step '+step);
    assert.ok(rag.active,body+'/'+clip+' physics stopped at '+step);
    assert.ok(Number.isFinite(rag.pose().hipsY),'non-finite pelvis');
   }
   assert.deepEqual(messages,[]);
  }finally{rag.reset();}
 }
});
