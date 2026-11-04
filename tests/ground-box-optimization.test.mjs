import test from 'node:test';
import assert from 'node:assert/strict';
import {GroundBoxIndex} from '../src/ground-box-index.js';
import {createGroundBoxes,BOX_LIFETIME_SECONDS} from '../src/ground-boxes.js';
import {tickFallingTrees} from '../src/falling-trees.js';
import {FALL_DURATION} from '../src/fallen-log-layout.js';
import {createInventoryModel} from '../src/inventory.js';
import {pickupCandidates} from '../src/pickup-interaction.js';

const seconds=()=>Date.now()/1000;
const normal=(id,x,z,expires_at=seconds()+3600)=>({
 id,x,z,expires_at,item:{id:'stone',count:1},
});

test('spatial query visits nearby cells and indexes individual fallen-log segment positions',()=>{
 const index=new GroundBoxIndex();
 for(let i=0;i<3000;i++)index.set(normal(i+1,2000+i*4,20));
 index.set(normal(9001,-.2,.2));
 index.set(normal(9002,1.4,-2.3));
 index.set({id:9003,x:12,z:0,direction:0,mask:0b111,expires_at:seconds()+1200,
   kind:'fallen_logs',item:{id:'log',count:3}});
 const local=[...index.near(0,0,4)].map(x=>x.id);
 assert.deepEqual(local.sort((a,b)=>a-b),[9001,9002]);
 const segment=[...index.near(12,4.62,1)].filter(x=>x.id===9003);
 assert.equal(segment.length,1);
 assert.equal(segment[0].segment,1,'the central segment is indexed separately');
 assert.equal(index.cells.size>10,true);
 assert.equal(index.members.size,3003);
 index.remove(9001);
 assert.equal([...index.near(0,0,4)].some(x=>x.id===9001),false);
});

test('expiry heap never expires later entries and handles stale heap nodes after updates',()=>{
 const idx=new GroundBoxIndex();
 idx.set(normal(1,0,0,200));
 idx.set(normal(2,0,0,300));
 idx.set(normal(3,0,0,250));
 idx.set(normal(1,0,0,400));
 assert.deepEqual(idx.expired(220),[],'old 200s deadline was invalidated');
 assert.deepEqual(idx.expired(260),[3]);
 assert.deepEqual(idx.expired(301),[2]);
 assert.deepEqual(idx.expired(400),[1]);
 assert.deepEqual(idx.expired(999),[]);
 idx.clear();
 assert.equal(idx.queue.length,0);
 for(let i=0;i<500;i++)idx.set(normal(1,0,0,1000+i));
 assert.ok(idx.queue.length<=128,'old versions are compacted');
 assert.deepEqual(idx.expired(1498),[]);
 assert.deepEqual(idx.expired(1499),[1]);
});

function sceneFixture(){
 let disposed=0;
 class Geo{dispose(){disposed++;}}
 class Mat{constructor(options={}){this.options=options;}dispose(){disposed++;}}
 class Tex{constructor(canvas){this.canvas=canvas;}dispose(){disposed++;}}
 class O{
  constructor(){
   this.children=[];
   this.position={set(x,y,z){this.x=x;this.y=y;this.z=z;}};
   this.rotation={set(x,y,z){this.x=x;this.y=y;this.z=z;}};
   this.scale={set(x,y,z){this.x=x;this.y=y;this.z=z;}};
  }
  updateMatrix(){this.matrix={
   position:[this.position.x,this.position.y,this.position.z],
   rotation:[this.rotation.x,this.rotation.y,this.rotation.z],
  };}
 }
 class Mesh extends O{
  constructor(geo,mat,count){super();this.geometry=geo;this.material=mat;this.count=count;
   this.instanceMatrix={needsUpdate:false};this.matrices=[];}
  setMatrixAt(i,m){this.matrices[i]=structuredClone(m);}
  dispose(){disposed++;}
 }
 const meshes=new Set(),bag=createInventoryModel();
 const ctx={
  THREE:{BoxGeometry:Geo,MeshLambertMaterial:Mat,CanvasTexture:Tex,
   Matrix4:class{},Object3D:O,InstancedMesh:Mesh},
  scene:{add:m=>meshes.add(m),remove:m=>meshes.delete(m)},
  fallenLogGeo:new Geo(),logMat:new Mat(),endMat:new Mat(),
  terrain:{heightAt:()=>0},logRadius:.29,px:0,pz:0,yaw:0,
  isOnline:()=>false,offlineSave:{markDirty(){}},
  inventory:{state:bag,render(){}},
  notify(){},
 };
 const doc={createElement(name){
  if(name==='canvas')return{width:0,height:0,getContext:()=>({
   fillStyle:'',fillRect(){},
  })};
  return{className:'',style:{},remove(){}};
 },body:{append(){}}};
 const ground=createGroundBoxes(ctx,doc);ctx.groundBoxes=ground;
 return {ctx,ground,meshes,get disposed(){return disposed}};
}

test('1000 nearby crates occupy one textured InstancedMesh in one chunk',()=>{
 const f=sceneFixture(),expiry=seconds()+3600;
 for(let i=0;i<1000;i++)
  assert.equal(f.ground.add(normal(i+1,5+i%20*.4,5+Math.floor(i/20)%20*.4,expiry)),true);
 assert.equal(f.meshes.size,0,'building meshes is deferred to the 500ms render budget');
 f.ground.tick(1000);
 assert.equal(f.meshes.size,1,'one chunk, one draw call for all 1000 boxes');
 const inst=[...f.meshes][0];
 assert.equal(inst.count,1000);
 assert.ok(inst.material.options.map instanceof Object,'texture assigned to the shared material');
 assert.equal(inst.matrices.length,1000);
 assert.equal(f.ground.count,1000);
 assert.equal(f.ground.batchCount,1);
 f.ground.remove(3);f.ground.tick(1600);
 assert.equal(f.meshes.size,1);assert.equal([...f.meshes][0].count,999);
 f.ctx.px=1000;f.ctx.pz=1000;f.ground.tick(2200);
 assert.equal(f.meshes.size,0,'distant chunks are unloaded from scene without erasing loot');
 assert.equal(f.ground.count,999);
 f.ctx.px=0;f.ctx.pz=0;f.ground.tick(2800);
 assert.equal([...f.meshes][0].count,999,'returning to a chunk recreates its batch');
 f.ground.dispose();
 assert.equal(f.meshes.size,0);
 assert.ok(f.disposed>0);
});

test('fallen segments from distinct trees share one InstancedMesh, preserve pickup indices',()=>{
 const f=sceneFixture();
 f.ground.add({id:10,kind:'fallen_logs',x:0,z:0,direction:Math.PI/2,
  mask:0b111,expires_at:seconds()+3600,item:{id:'log',count:3}});
 f.ground.add({id:11,kind:'fallen_logs',x:0,z:5,direction:Math.PI/2,
  mask:0b111,expires_at:seconds()+3600,item:{id:'log',count:3}});
 f.ground.tick(1000);
 assert.equal([...f.meshes].reduce((n,m)=>n+m.count,0),6);
 assert.ok(f.meshes.size<=2,'segment locations may cross chunk boundaries');
 const coords=[...f.ground.nearbyPickupNodes(0,0,12)];
 assert.equal(coords.length,6);
 assert.deepEqual(coords.filter(n=>n.id===10).map(n=>n.segment).sort(),[0,1,2]);
 f.ground.add({id:10,kind:'fallen_logs',x:0,z:0,direction:Math.PI/2,
  mask:0b101,expires_at:seconds()+3600,item:{id:'log',count:2}});
 f.ground.tick(1600);
 assert.equal([...f.meshes].reduce((n,m)=>n+m.count,0),5);
 assert.deepEqual([...f.ground.nearbyPickupNodes(0,0,12)]
  .filter(n=>n.id===10).map(n=>n.segment).sort(),[0,2]);
});

test('pickup candidates use bounded indexed search while preserving aim rules',()=>{
 const f=sceneFixture();
 f.ground.add(normal(1,1,1));
 for(let i=0;i<600;i++)f.ground.add(normal(i+2,1000+i*3,0));
 f.ctx.terrain.waterDepthAt=()=>0;
 const candidates=pickupCandidates(f.ctx);
 assert.deepEqual(candidates.boxes.map(b=>b.id),[1]);
 assert.equal(f.ground.nearest().id,1);
 assert.equal([...f.ground.nearbyPickupNodes(0,0,2.8)].length,1);
});

test('10,000 crates fit in one spatial batch; crate 10,001 is rejected',()=>{
 const f=sceneFixture(),expiry=seconds()+3600;
 for(let i=0;i<10000;i++)
  assert.equal(f.ground.add(normal(i+1,5+i%100*.08,5+Math.floor(i/100)*.08,expiry)),true);
 assert.equal(f.ground.count,10000);
 assert.equal(f.ground.add(normal(10001,5,5,expiry)),false);
 f.ground.tick(1000);
 assert.equal(f.ground.batchCount,1);
 assert.equal([...f.meshes][0].count,10000);
 f.ground.remove(1);
 assert.equal(f.ground.add(normal(10001,5,5,expiry)),true,
   'a removed box immediately frees one capacity slot');
 f.ground.dispose();
});

test('reverse pickup plays only on a successful deliberate inventory drop, never automatic death loot',()=>{
 const f=sceneFixture(),effects=[];
 f.ctx.audio={effect:name=>effects.push(name)};
 const empty=f.ctx.inventory.state.slots.findIndex(item=>!item);
 assert.ok(empty>=0);
 assert.equal(f.ground.dropSlot(empty),false,'empty slot is not a drop');
 assert.deepEqual(effects,[]);
 assert.equal(f.ctx.inventory.state.addItem({id:'stone',count:1}),true);
 const slot=f.ctx.inventory.state.slots.findIndex(item=>item?.id==='stone');
 assert.ok(slot>=0);
 assert.equal(f.ground.dropSlot(slot),true);
 assert.deepEqual(effects,['drop']);
 assert.equal(f.ctx.inventory.state.slots[slot],null);
 const before=f.ground.count;
 // Death uses groundBoxes.add(), never dropSlot().
 assert.equal(f.ground.add(normal(1002,1,1)),true);
 assert.equal(f.ground.count,before+1);
 assert.deepEqual(effects,['drop'],'death/automatic boxes remain silent');
 assert.equal(f.ground.dropSlot(slot),false,'repeat on consumed slot is ignored');
 assert.deepEqual(effects,['drop']);
 f.ground.dispose();
});

test('online deliberate inventory drop sends drop_item and plays once; server box events are silent',()=>{
 const f=sceneFixture(),effects=[],sent=[];
 f.ctx.audio={effect:name=>effects.push(name)};
 f.ctx.isOnline=()=>true;
 f.ctx.sendNet=packet=>sent.push(packet);
 const slot=f.ctx.inventory.state.slots.findIndex(item=>!item);
 assert.equal(f.ground.dropSlot(slot),false,'empty online slot is not an action');
 assert.equal(f.ctx.inventory.state.addItem({id:'stone',count:1}),true);
 assert.equal(f.ground.dropSlot(slot),true);
 assert.deepEqual(sent,[{type:'drop_item',slot}]);
 assert.deepEqual(effects,['drop']);
 assert.equal(f.ground.add(normal(1200,2,2)),true);
 assert.deepEqual(effects,['drop'],'replicated spawned boxes do not play drop effect');
 f.ground.dispose();
});

test('falling logs are prebuilt hidden, appear immediately on reveal, then join chunk batch',()=>{
 const f=sceneFixture(),tree='falling-01';
 const pile={id:510,kind:'fallen_logs',tree,x:0,z:0,direction:.4,
  mask:0b111,expires_at:seconds()+3600,item:{id:'log',count:3},pending:true};
 assert.equal(f.ground.add(pile),true);
 assert.equal(f.ground.count,1);
 assert.equal(f.meshes.size,1,'all three log instance transforms created during fall');
 const staged=[...f.meshes][0];
 assert.equal(staged.count,3);
 assert.equal(staged.visible,false,'not rendered while standing tree falls');
 assert.equal(staged.matrices.length,3,'all transforms prepared ahead of time');
 assert.deepEqual([...f.ground.pickupNodes],[],'logs are not pickable during fall');
 f.ground.tick(1000);
 assert.equal(f.ground.batchCount,0,'pending logs are excluded from visible batches');
 f.ground.revealTree(tree);
 assert.equal(staged.visible,true,'immediate visibility on exact fall-completion frame');
 assert.equal(f.meshes.size,1,'no 500ms timeout and no extra draw call at reveal');
 assert.equal([...f.ground.pickupNodes].length,3,'segments are accessible after landing');
 f.ground.tick(1200);
 assert.equal(f.meshes.has(staged),true,'staged mesh remains visible during tick throttle');
 f.ground.tick(1500);
 assert.equal(f.meshes.has(staged),false,'temporary object released after chunk rebuilding');
 assert.equal(f.ground.batchCount,1);
 assert.equal(f.meshes.size,1,'batched mesh seamlessly replaces temporary mesh');
 assert.equal([...f.meshes][0].count,3);
 f.ground.dispose();
 assert.equal(f.meshes.size,0);
});

test('pending log mesh is disposed on removal or world reset, even before landing',()=>{
 const f=sceneFixture(),pile={id:600,kind:'fallen_logs',tree:'tree-600',
   x:1,z:2,direction:0,mask:0b111,
   expires_at:seconds()+3600,item:{id:'log',count:3},pending:true};
 f.ground.add(pile);
 const first=[...f.meshes][0];
 assert.equal(first.visible,false);
 const disposedBefore=f.disposed;
 assert.equal(f.ground.remove(pile.id),true);
 assert.equal(f.meshes.size,0);
 assert.ok(f.disposed>disposedBefore);
 f.ground.revealTree(pile.tree);
 assert.equal(f.meshes.size,0,'removed pile must not reappear later');
 f.ground.add({...pile,id:601});
 f.ground.add({...pile,id:602});
 assert.equal(f.meshes.size,2);
 f.ground.clear();
 assert.equal(f.meshes.size,0);
 f.ground.revealTree(pile.tree);
 f.ground.tick(1000);
 assert.equal(f.meshes.size,0,'old tree reveal cannot leak into next world');
 f.ground.dispose();
});

test('new box_add update during falling replaces staged mesh without showing it early',()=>{
 const f=sceneFixture(),pile={id:702,kind:'fallen_logs',tree:'tree-702',
   x:0,z:1,direction:.25,mask:0b111,
   expires_at:seconds()+3600,item:{id:'log',count:3},pending:true};
 f.ground.add(pile);
 const first=[...f.meshes][0];
 f.ground.add({...pile,pending:false});
 assert.equal(f.meshes.has(first),false);
 assert.equal(f.meshes.size,1);
 const current=[...f.meshes][0];
 assert.equal(current.visible,false,'the previously pending state must be preserved');
 f.ground.revealTree(pile.tree);
 assert.equal(current.visible,true);
 f.ground.dispose();
});

test('falling-trees completion reveals prepared logs in the same render frame',()=>{
 const f=sceneFixture(),tree={userData:{id:'timed-fall'},rotation:{x:0,z:0}};
 f.ctx.falling=[{tree,direction:.4,elapsed:0}];
 f.ctx.scene.add(tree);
 f.ground.add({id:901,kind:'fallen_logs',tree:tree.userData.id,
  x:0,z:0,direction:.4,mask:0b111,expires_at:seconds()+3600,
  item:{id:'log',count:3}});
 const staged=[...f.meshes].find(mesh=>mesh!==tree);
 assert.ok(staged);
 assert.equal(staged.visible,false);
 f.ground.tick(1000); // schedule batch update while original tree is still falling
 tickFallingTrees(f.ctx,FALL_DURATION-.001);
 assert.equal(staged.visible,false);
 assert.equal(f.ctx.falling.length,1);
 tickFallingTrees(f.ctx,.002);
 assert.equal(f.ctx.falling.length,0);
 assert.equal(f.meshes.has(tree),false,'standing/falling tree removed');
 assert.equal(staged.visible,true,'all logs visible immediately, without groundBoxes.tick');
 assert.equal(f.ground.batchCount,0);
 f.ground.dispose();
 assert.equal(f.meshes.size,0);
});

test('collected-log statistic counts successful fallen segments, not dropped inventory',()=>{
 const f=sceneFixture();
 f.ground.add({id:910,kind:'fallen_logs',x:0,z:0,direction:0,mask:0b111,
  expires_at:seconds()+3600,item:{id:'log',count:3}});
 const part=[...f.ground.nearbyPickupNodes(0,0,4)].find(n=>n.id===910);
 f.ctx.px=part.x;f.ctx.pz=part.z;
 assert.equal(f.ground.pickup(910,part.segment),true);
 assert.equal(f.ctx.logsCollected,1);
 assert.equal(f.ground.pickup(910,part.segment),false);
 assert.equal(f.ctx.logsCollected,1);
});
