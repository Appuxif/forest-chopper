import test from 'node:test';
import assert from 'node:assert/strict';
import {createGroundBoxes,MAX_GROUND_DROPS,TREE_LOG_COUNT,BOX_LIFETIME_SECONDS} from '../src/ground-boxes.js';
import {createChopping} from '../src/chopping.js';
import {createInventoryModel} from '../src/inventory.js';
import {parseOfflineSave} from '../src/offline-save.js';
import {fallenLogSegments,segmentMask,FALL_DURATION,FALLEN_LOG_LENGTH,FALLEN_LOG_GAP} from '../src/fallen-log-layout.js';
import {BUILD_LOG_LENGTH,logHalfExtents,logCenterY} from '../src/log-grid.js';
import {tickFallingTrees} from '../src/falling-trees.js';
import {pickupCandidates} from '../src/pickup-interaction.js';

test('building and fallen segments share a single three-meter log size',()=>{
  assert.equal(BUILD_LOG_LENGTH,3);
  assert.equal(FALLEN_LOG_LENGTH,BUILD_LOG_LENGTH);
  assert.equal(FALLEN_LOG_GAP,.08);
  assert.deepEqual(logHalfExtents({orientation:0}),{x:1.5,y:.29,z:.29});
  assert.deepEqual(logHalfExtents({orientation:1}),{x:.29,y:.29,z:1.5});
  assert.deepEqual(logHalfExtents({orientation:2}),{x:.29,y:1.5,z:.29});
  assert.equal(logCenterY({orientation:2,height:0},0),1.5);
  const segments=fallenLogSegments({x:0,z:0,item:{count:3},direction:0});
  assert.ok(Math.abs(segments[1].z-segments[0].z-(BUILD_LOG_LENGTH+FALLEN_LOG_GAP))<1e-9);
});

function fixture(){
  class Geometry{dispose(){}}
  class Material{dispose(){}}
  class Group{
    constructor(){
      this.children=[];
      this.position={set(x,y,z){Object.assign(this,{x,y,z})}};
      this.rotation={x:0,y:0,z:0};
      this.scale={set(x,y,z){Object.assign(this,{x,y,z})}};
    }
    add(...children){this.children.push(...children);}
    updateMatrix(){this.matrix={x:this.position.x,y:this.position.y,z:this.position.z};}
  }
  class Mesh extends Group{constructor(geo,material){super();this.geometry=geo;this.material=material;}}
  class InstancedMesh extends Mesh{
    constructor(geo,material,count){super(geo,material);this.count=count;this.matrices=[];this.instanceMatrix={needsUpdate:false};}
    setMatrixAt(i,m){this.matrices[i]=m;}
    dispose(){}
  }
  class Vector2{constructor(x,y){Object.assign(this,{x,y})}}
  class Vector3{set(x,y,z){Object.assign(this,{x,y,z});return this;}}
  class Raycaster{
    constructor(){this.ray={origin:new Vector3(),direction:new Vector3()}}
    setFromCamera(){}
    intersectObjects(){return [{distance:1.5}]}
  }
  const scene=new Set(),state=createInventoryModel(),messages=[],dom={};
  const ctx={
    THREE:{Group,Object3D:Group,Mesh,InstancedMesh,BoxGeometry:Geometry,MeshLambertMaterial:Material,Vector2,Vector3,Raycaster},
    scene:{add:o=>scene.add(o),remove:o=>scene.delete(o)},
    logGeo:new Geometry(),logMat:new Material(),endMat:new Material(),
    makeLog:()=>{const mesh=new Mesh();mesh.rotation.z=Math.PI/2;return mesh;},
    terrain:{heightAt:()=>0},px:0,pz:0,yaw:0,feetY:0,thirdPerson:false,camera:{},
    characterOrientation:{legsYaw:0,torsoYaw:0},
    inventory:{state,render(){},get equipped(){return true},get axe(){return {damage:1,speed:1}},selected:'axe'},
    isOnline:()=>false,offlineSave:{markDirty(){}},notify:(...args)=>messages.push(args),
    wood:0,cuts:0,trees:new Map(),treeDamage:new Map(),felled:new Set(),falling:[],particles:[],
    ownAvatar:null,CHOP_SPEED:1,lastHit:-Infinity,actorChop(){},swing:0,
    tutorial:{complete(){}},progress:{record(){}},
    detachTreeForFall(){},$(id){return dom[id]??(dom[id]={textContent:''});},
  };
  const doc={createElement(){return {style:{},remove(){}}},body:{append(){}}};
  ctx.groundBoxes=createGroundBoxes(ctx,doc);
  return {ctx,state,scene,messages};
}

test('tree produces three visible 3D logs and no inventory reward; pickup removes one at a time',()=>{
  const {ctx,state,scene}=fixture();
  const tree={userData:{id:'0,0:1',hp:1,x:0,z:-1},position:{x:0,z:-1},rotation:{x:0,z:0},children:[{}]};
  ctx.trees.set('0,0:1',tree);
  const chopping=createChopping(ctx);
  chopping.chop();
  chopping.tickImpact(ctx.lastHit+1000);
  assert.equal(ctx.cuts,1);
  assert.equal(state.count('log'),0,'falling tree never inserts logs into the bag');
  assert.equal(ctx.wood,0);
  assert.equal(ctx.trees.has('0,0:1'),false);
  assert.equal(ctx.felled.has('0,0:1'),true);
  const pile=ctx.groundBoxes.snapshot()[0];
  assert.equal(pile.kind,'fallen_logs');
  assert.equal(pile.item.count,TREE_LOG_COUNT);
  assert.ok(pile.expires_at>Date.now()/1000+BOX_LIFETIME_SECONDS-5);
  assert.ok(pile.expires_at<=Date.now()/1000+BOX_LIFETIME_SECONDS,
    'fallen trunk expires one hour after the tree was cut');
  assert.equal([...scene].find(x=>x.children?.[0]?.count===TREE_LOG_COUNT)?.children[0].matrices.length,TREE_LOG_COUNT,
    'three visible instances from a single shared geometry');
  assert.equal([...ctx.groundBoxes.pickupNodes].length,0,'segments are hidden during tree fall');
  assert.equal(ctx.groundBoxes.pickup(pile.id),false,'cannot collect before fallen tree disappears');
  const initial=fallenLogSegments(pile);
  assert.equal(initial.length,3);
  assert.ok(initial[0].z>initial[1].z&&initial[1].z>initial[2].z,
    'three cylinders lie end to end along the fall vector');
  assert.ok(Math.abs(initial[0].z-initial[1].z)>3,'separate 3m segments');
  tickFallingTrees(ctx,FALL_DURATION-.11);
  assert.equal([...ctx.groundBoxes.pickupNodes].length,0,'the trunk stays hidden during its fall');
  assert.equal(ctx.falling.length,1);
  assert.equal([...scene].find(x=>x.children?.[0]?.count===3)?.visible,false);
  tickFallingTrees(ctx,.12);
  assert.equal(ctx.falling.length,0,'fall finishes before pickup objects appear');
  assert.equal([...ctx.groundBoxes.pickupNodes].length,3);
  assert.equal([...scene].find(x=>x.children?.[0]?.count===3)?.visible,true);
  assert.equal(pickupCandidates(ctx).boxes.some(b=>b.segment===0),true,
    'distance checks use segment coordinates, not the pile origin');
  // Pick the MIDDLE segment first. The two other segments keep their original
  // world positions and original indices rather than being re-centered.
  ctx.px=initial[1].x;ctx.pz=initial[1].z;
  assert.ok(pickupCandidates(ctx).boxes.some(b=>b.segment===1),
    'the center segment is independently interactable');
  assert.equal(ctx.groundBoxes.pickup(pile.id,1),true);
  assert.equal(state.count('log'),1);
  assert.equal(segmentMask(ctx.groundBoxes.snapshot()[0]),0b101);
  assert.deepEqual(fallenLogSegments(ctx.groundBoxes.snapshot()[0]),[initial[0],initial[2]]);
  // Pick the distant segment: its center is still at exactly its old location.
  ctx.px=initial[2].x;ctx.pz=initial[2].z;
  assert.equal(ctx.groundBoxes.pickup(pile.id,2),true);
  assert.equal(state.count('log'),2);
  assert.deepEqual(fallenLogSegments(ctx.groundBoxes.snapshot()[0]),[initial[0]]);
  for(let i=0;i<3;i++)assert.equal(state.addItem({id:'stone',count:10}),true);
  assert.equal(state.addItem({id:'stone',count:8}),true);
  assert.equal(state.weight(),99);
  ctx.px=initial[0].x;ctx.pz=initial[0].z;
  assert.equal(ctx.groundBoxes.pickup(pile.id,0),false,'99kg cannot carry the last 10kg log');
  assert.equal(segmentMask(ctx.groundBoxes.snapshot()[0]),0b001,
    'no logs lost on overweight pickup');
  assert.equal(state.spend('stone',10),true);
  assert.equal(ctx.groundBoxes.pickup(pile.id,0),true);
  assert.equal(ctx.groundBoxes.count,0);
  assert.equal(state.count('log'),TREE_LOG_COUNT);
});

test('even an already full bag still receives all three ground logs after felling',()=>{
  const {ctx,state}=fixture();
  assert.equal(state.addItem({id:'log',count:3}),true);
  for(let i=0;i<3;i++)assert.equal(state.addItem({id:'stone',count:10}),true);
  assert.equal(state.addItem({id:'branch',count:10}),true);
  assert.equal(state.addItem({id:'branch',count:4}),true);
  assert.equal(state.weight(),100);
  const tree={userData:{id:'0,0:1',hp:1,x:0,z:-1},position:{x:0,z:-1},rotation:{x:0,z:0},children:[{}]};
  ctx.trees.set('0,0:1',tree);
  const chopping=createChopping(ctx);
  chopping.chop();
  chopping.tickImpact(ctx.lastHit+1000);
  assert.equal(state.freeLogs(),0);
  assert.equal(state.count('log'),3);
  assert.equal(ctx.groundBoxes.snapshot()[0].item.count,TREE_LOG_COUNT);
  ctx.groundBoxes.revealTree(tree.userData.id);
  const first=fallenLogSegments(ctx.groundBoxes.snapshot()[0])[0];
  ctx.px=first.x;ctx.pz=first.z;
  assert.equal(ctx.groundBoxes.pickup(),false);
  assert.equal(ctx.groundBoxes.snapshot()[0].item.count,TREE_LOG_COUNT);
});

test('fallen logs expire after one hour even when partially collected; timed boxes also expire',()=>{
  const {ctx}=fixture();
  assert.ok(MAX_GROUND_DROPS>500);
  assert.equal(ctx.groundBoxes.spawnFallenLogs(0,0),true);
  const pile=ctx.groundBoxes.snapshot()[0];
  assert.equal(ctx.groundBoxes.add({id:50,x:0,z:0,
    expires_at:Date.now()/1000+1,item:{id:'stone',count:1}}),true);
  const original=Date.now;
  try{
    Date.now=()=>original()+2_000;
    ctx.groundBoxes.tick(1_000);
    assert.deepEqual(ctx.groundBoxes.snapshot().map(x=>x.id),[pile.id]);
    const remaining=ctx.groundBoxes.snapshot()[0];
    ctx.groundBoxes.add({...remaining,mask:0b011,item:{id:'log',count:2}});
    assert.equal(ctx.groundBoxes.snapshot()[0].expires_at,pile.expires_at,
      'taking one segment must not reset the one-hour countdown');
    const snapshot={
      version:1,seed:123,wood:0,cuts:1,felled:[],damage:{},logs:[],
      boxes:ctx.groundBoxes.snapshot(),
      position:{x:0,z:0,yaw:0,pitch:0},
    };
    const saved=parseOfflineSave(JSON.stringify(snapshot));
    assert.deepEqual(fallenLogSegments(saved.boxes[0]),fallenLogSegments(snapshot.boxes[0]));
    assert.equal(saved.boxes[0].expires_at,pile.expires_at);
    snapshot.boxes[0].item.count=6;
    assert.equal(parseOfflineSave(JSON.stringify(snapshot)),null);
    snapshot.boxes[0].item.count=2;
    Date.now=()=>original()+BOX_LIFETIME_SECONDS*1000+2_000;
    assert.deepEqual(parseOfflineSave(JSON.stringify(snapshot)).boxes,[],
      'expired log piles are absent when reloading an offline world');
    assert.equal([...ctx.groundBoxes.pickupNodes].length,0,
      'expired log segments cannot be targeted');
    assert.equal(ctx.groundBoxes.pickup(pile.id),false,
      'expired segments cannot be collected before the next render tick');
    assert.equal(ctx.groundBoxes.count,0);
  }finally{Date.now=original;}
});

test('falling tree tilt axis points exactly along the future three-log trunk',()=>{
  const direction=Math.PI/3;
  let tilt=null;
  class Vector3{constructor(x,y,z){Object.assign(this,{x,y,z})}}
  const tree={
    userData:{id:'tree-2'},quaternion:{setFromAxisAngle(axis,angle){tilt={axis,angle};}},
    rotation:{x:0,z:0},
  };
  let removed=0,revealed=0;
  const ctx={THREE:{Vector3},falling:[{tree,direction,elapsed:0}],
    scene:{remove(){removed++;}},
    groundBoxes:{revealTree(id){assert.equal(id,'tree-2');revealed++;}}};
  tickFallingTrees(ctx,FALL_DURATION+.01);
  assert.equal(removed,1);
  assert.equal(revealed,1);
  assert.equal(ctx.falling.length,0);
  assert.ok(Math.abs(tilt.angle-Math.PI/2)<1e-8);
  // axis × up = (-sin(dir), 0, cos(dir)): precisely the segment heading.
  const dx=-tilt.axis.z,dz=tilt.axis.x;
  const points=fallenLogSegments({x:0,z:0,direction,item:{count:3}});
  const between=[points[1].x-points[0].x,points[1].z-points[0].z];
  assert.ok(Math.abs(between[0]/Math.hypot(...between)-dx)<1e-8);
  assert.ok(Math.abs(between[1]/Math.hypot(...between)-dz)<1e-8);
});


test('online pickup identifies the exact segment and waits for server confirmation',()=>{
  const {ctx,state}=fixture();
  const packets=[];
  ctx.sendNet=data=>packets.push(data);
  ctx.isOnline=()=>true;
  assert.equal(ctx.groundBoxes.spawnFallenLogs(10,5,3,{direction:.7,tree:'tree-net'}),true);
  const pile=ctx.groundBoxes.snapshot()[0];
  const segment=fallenLogSegments(pile)[2];
  ctx.px=segment.x;ctx.pz=segment.z;
  assert.equal(ctx.groundBoxes.pickup(pile.id,2),true);
  assert.deepEqual(packets,[{type:'pickup_box',id:pile.id,segment:2}]);
  assert.equal(state.count('log'),0,'never award items optimistically online');
  assert.equal(ctx.groundBoxes.snapshot()[0].mask,0b111);
  ctx.groundBoxes.add({...pile,mask:0b011,item:{id:'log',count:2}});
  assert.deepEqual(fallenLogSegments(ctx.groundBoxes.snapshot()[0]),
    fallenLogSegments(pile).slice(0,2),'server update keeps the two surviving segments fixed');
});

test('legacy permanent piles are migrated to one-hour TTL while retaining segments',()=>{
  const {ctx}=fixture();
  assert.equal(ctx.groundBoxes.add({id:33,x:2,z:5,kind:'fallen_logs',
    expires_at:0,item:{id:'log',count:2}}),true);
  assert.deepEqual([...ctx.groundBoxes.pickupNodes].map(p=>p.segment),[0,1]);
  assert.equal(segmentMask(ctx.groundBoxes.snapshot()[0]),0b11);
  const expiry=ctx.groundBoxes.snapshot()[0].expires_at;
  assert.ok(expiry>Date.now()/1000+BOX_LIFETIME_SECONDS-5);
  assert.ok(expiry<=Date.now()/1000+BOX_LIFETIME_SECONDS);
  ctx.groundBoxes.add({...ctx.groundBoxes.snapshot()[0],mask:0b01,item:{id:'log',count:1}});
  assert.equal(ctx.groundBoxes.snapshot()[0].expires_at,expiry,
    'the legacy pile gets only one deadline even after partial pickup');
});


test('tree fall progresses through the entire ~3.85s sound instead of tilting in 1.8s',()=>{
 const rotations=[],revealed=[];
 const tree={userData:{id:'tree-sync'},rotation:{x:0,z:0},
   quaternion:{setFromAxisAngle(_axis,angle){rotations.push(angle)}}};
 class Vector3{constructor(x,y,z){Object.assign(this,{x,y,z})}}
 const ctx={THREE:{Vector3},falling:[{tree,direction:Math.PI/2,elapsed:0}],
  scene:{remove(){}},groundBoxes:{revealTree(id){revealed.push(id)}}};
 assert.ok(FALL_DURATION>3.8 && FALL_DURATION<3.9);
 tickFallingTrees(ctx,FALL_DURATION/2);
 assert.equal(ctx.falling.length,1);
 assert.ok(Math.abs(rotations.at(-1)-Math.PI/8)<.000001,
   'halfway through audio the ease-in rotation is only 25% complete');
 assert.deepEqual(revealed,[]);
 tickFallingTrees(ctx,FALL_DURATION/2-.01);
 assert.equal(ctx.falling.length,1);
 assert.ok(rotations.at(-1)<Math.PI/2);
 tickFallingTrees(ctx,.01);
 assert.equal(ctx.falling.length,0,'fall ends exactly with audio');
 assert.ok(Math.abs(rotations.at(-1)-Math.PI/2)<.000001);
 assert.deepEqual(revealed,['tree-sync']);
});
