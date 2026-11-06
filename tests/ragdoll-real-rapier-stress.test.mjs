import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createRagdoll} from '../src/ragdoll.js';
import {makeGroundMesh} from '../src/collision-world.js';

// Real WASM integration QA (same optional setup as hen-ragdoll-physics.test.mjs).
// Reproduces a Rapier 0.20.0 WASM "unreachable" caused by repeatedly
// rebuilding dozens of static colliders while an 11-part ragdoll is active.
// No renderer, browser profile, HTTP server, or persisted world is needed.
const deps=process.env.HEN_PHYSICS_NODE_MODULES;
test('real Rapier survives repeated terrain/structure revisions for every playable ragdoll',
 {skip:!deps},async()=>{
 const THREE=await import(pathToFileURL(deps+'/three/build/three.module.js'));
 const {default:R}=await import(pathToFileURL(deps+'/@dimforge/rapier3d-compat/dist/rapier.mjs'));
 await R.init();

 function actorFromGLB(body){
  const data=readFileSync(new URL('../characters/humanoid/game/body_'+body+'.glb',import.meta.url));
  const gltf=JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));
  const joints=new Set(gltf.skins.flatMap(s=>s.joints));
  const nodes=gltf.nodes.map((raw,i)=>{
   const node=joints.has(i)?new THREE.Bone():new THREE.Group();
   node.name=raw.name??'';
   if(raw.translation)node.position.fromArray(raw.translation);
   if(raw.rotation)node.quaternion.fromArray(raw.rotation);
   if(raw.scale)node.scale.fromArray(raw.scale);
   return node;
  });
  gltf.nodes.forEach((n,i)=>n.children?.forEach(j=>nodes[i].add(nodes[j])));
  const visual=new THREE.Group();
  for(const i of gltf.scenes[gltf.scene??0].nodes)visual.add(nodes[i]);
  visual.rotation.y=Math.PI;
  const group=new THREE.Group();group.add(visual);
  return {group,visual,human:{bones:new Map(nodes.filter(n=>n.isBone).map(n=>[n.name,n]))},
   mixer:{stopAllAction(){}},rmTimes:{},lowerState:'',upperState:''};
 }

 for(const body of ['male','female','legacy']){
  // Deliberately crowded scene makes Rapier create many collision contacts.
  const specs=Array.from({length:30},(_,i)=>({
   kind:'structure',shape:'box',
   x:(i%7-3)*1.2,y:.2+(i%3)*.25,z:(Math.floor(i/7)-2)*1.2,
   yaw:0,local:{x:0,y:0,z:0},hx:.4,hy:.2,hz:.4,
  }));
  const collisionWorld={
   revision:0,collect:()=>specs,
   terrainMesh:(x,z,size,step)=>makeGroundMesh({heightAt:()=>0},x,z,size,step),
  };
  const ctx={THREE,GRAVITY:19,px:0,pz:0,feetY:0,onGround:true,
   yaw:0,ownAvatar:actorFromGLB(body),isOnline:()=>false,
   collisionWorld,ragdollCamera:{enter(){},exit(){}},
   ragdollControls:{abort(){}},
   notify(message){assert.fail(body+': '+message);},
  };
  const rag=createRagdoll(ctx,{loadPhysics:async()=>R});
  await rag.trigger();
  try{
   for(let i=0;i<650;i++){
    if(i%5===0)collisionWorld.revision++;
    if(i===200){specs[0]={...specs[0],x:specs[0].x+.4};collisionWorld.revision++;}
    if(i===400){specs.pop();collisionWorld.revision++;}
    rag.tick(1/60);
    assert.equal(rag.state().physicsError,null,body+' physics error at step '+i);
    assert.equal(rag.active,true,body+' stopped at step '+i);
    assert.ok(Number.isFinite(rag.pose().hipsY),body+' invalid pelvis at step '+i);
   }
  }finally{rag.reset();}
 }
});
