import test from 'node:test';
import assert from 'node:assert/strict';
import {
  orbitOffset,cylinderHit,boxHit,springArmFraction,createOrbitCamera,
} from '../src/orbit-camera.js';

const almost=(x,y,eps=.001)=>assert.ok(Math.abs(x-y)<eps,`Expected ${x} ≈ ${y}`);

class Vector3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(o){return this.set(o.x,o.y,o.z);}
  add(o){this.x+=o.x;this.y+=o.y;this.z+=o.z;return this;}
  addScaledVector(o,s){this.x+=o.x*s;this.y+=o.y*s;this.z+=o.z*s;return this;}
  length(){return Math.hypot(this.x,this.y,this.z);}
}
function fixture(){
  const settings={cameraHeight:2.3,cameraSide:.4,cameraDistance:1.7,cameraPitchLimit:80};
  const camera={position:new Vector3(),rotation:{set(x,y,z){Object.assign(this,{x,y,z});}}};
  const ctx={THREE:{Vector3},px:0,pz:0,feetY:0,yaw:0,pitch:0,settings,camera,
    trees:new Map(),rockColliders:new Map(),chunkSize:24,placed:[],logLength:3,logRadius:.29};
  return {ctx,camera,rig:createOrbitCamera(ctx)};
}

test('elliptical orbit tracks yaw and changes height gently under ±40° pitch',()=>{
  const d=1.7,s=.4,limit=40*Math.PI/180;
  const neutral=orbitOffset(0,0,d,s);
  almost(neutral.x,.4);almost(neutral.z,1.7);almost(neutral.y,0);
  const left=orbitOffset(Math.PI/2,0,d,s);
  almost(left.x,1.7);almost(left.z,-.4);
  const up=orbitOffset(0,limit,d,s),down=orbitOffset(0,-limit,d,s);
  assert.ok(up.y<0 && down.y>0);
  almost(up.y,-down.y);
  assert.ok(Math.abs(up.y)<.65);
  assert.ok(Math.hypot(up.x-s,up.z)<d);
});

test('max downward look shifts the camera ahead of the back, but looking up does not',()=>{
  const pitch=80*Math.PI/180;
  const neutral=orbitOffset(0,0,1.7,.4);
  const down=orbitOffset(0,-pitch,1.7,.4);
  const up=orbitOffset(0,pitch,1.7,.4);
  assert.ok(down.z<0,'at -80° the camera reaches slightly ahead of the pivot');
  assert.ok(up.z>0,'looking up keeps the camera behind the character');
  assert.ok(down.y>0,'camera rises for a downward look');
  assert.equal(neutral.z,1.7);
  const half=orbitOffset(0,-40*Math.PI/180,1.7,.4);
  assert.ok(half.z>0 && half.z<neutral.z,'forward shift grows smoothly');
  const {ctx,rig,camera}=fixture();
  ctx.pitch=-pitch;rig.update(1/60);
  assert.ok(camera.position.z<0);
  assert.ok(camera.position.y>2.3 && camera.position.y<3.4);
  almost(camera.rotation.x,-pitch);
});

test('looking sharply up lowers the camera closer to the ground on a smooth arc',()=>{
  const r=Math.PI/180,distance=1.7,side=.4;
  const at40=orbitOffset(0,40*r,distance,side);
  const at45=orbitOffset(0,45*r,distance,side);
  const at60=orbitOffset(0,60*r,distance,side);
  const at80=orbitOffset(0,80*r,distance,side);
  const down80=orbitOffset(0,-80*r,distance,side);
  almost(at45.y,-distance*.55*Math.sin(45*r));
  assert.ok(at60.y< -distance*.55*Math.sin(60*r),
    'additional drop should start smoothly beyond +45°');
  assert.ok(at80.y<at60.y && at60.y<at40.y);
  assert.ok(at80.z<at60.z && at60.z<at40.z,
    'camera stays on the curved horizontal orbit');
  assert.ok(down80.y>0,'looking down must keep the existing camera elevation');
  const {ctx,rig,camera}=fixture();
  ctx.pitch=80*r;rig.update(1/60);
  assert.ok(camera.position.y>.65 && camera.position.y<1.15,
    'default rig ends near ground without going underground');
  almost(camera.rotation.x,80*r);
});

test('camera follows a dynamic shoulder pivot, preserves aiming and springs with movement',()=>{
  const {ctx,camera,rig}=fixture();
  rig.update(1/60);
  almost(camera.position.x,.4);
  almost(camera.position.y,2.3);
  almost(camera.position.z,1.58); // 12cm forward dynamic shoulder pivot.
  assert.equal(camera.rotation.x,0);
  ctx.pitch=Math.PI*40/180;rig.update(1);
  assert.ok(camera.position.y<2.3 && camera.position.y>1.5);
  almost(camera.rotation.x,ctx.pitch);
  ctx.pitch=-Math.PI*40/180;rig.update(1);
  assert.ok(camera.position.y>2.3 && camera.position.y<3.1);
  ctx.feetY=1;
  const oldY=camera.position.y;
  rig.update(1/120);
  assert.ok(camera.position.y>oldY);
  assert.ok(camera.position.y<oldY+1);
  rig.update(1);
  assert.ok(camera.position.y>oldY+.6);
  ctx.yaw=Math.PI/2;ctx.pitch=0;rig.reset();rig.update(0);
  assert.ok(camera.position.x>1);
  almost(camera.rotation.y,Math.PI/2);
});

test('spring arm retracts for a spruce trunk and smoothly restores after removal',()=>{
  const {ctx,camera,rig}=fixture();
  rig.update(1/60);
  const normal=camera.position.z;
  const tree={position:{x:0,z:1},userData:{h:11}};
  ctx.trees.set('nearby',tree);
  rig.update(1/60);
  assert.ok(camera.position.z<normal-.35,'spruce behind player should shorten arm');
  const shortened=camera.position.z;
  ctx.trees.clear();
  rig.update(1/60);
  assert.ok(camera.position.z>shortened && camera.position.z<normal);
  rig.update(1);
  almost(camera.position.z,normal,.002);
});

test('camera boom prevents underground placement and respects rock/log collisions',()=>{
  const {ctx,rig,camera}=fixture();
  ctx.settings.cameraHeight=.6;
  ctx.settings.cameraDistance=6;
  ctx.settings.cameraSide=0;
  ctx.pitch=80*Math.PI/180;
  rig.update(1);
  assert.ok(camera.position.y>=.32,'near-ground camera should stay above floor');
  const a={x:0,y:1.5,z:0},b={x:0,y:1.5,z:3};
  almost(cylinderHit(a,b,0,1.8,.5,0,4),(1.8-.5)/3);
  assert.equal(cylinderHit(a,b,5,2,.5,0,4),1);
  almost(boxHit(a,b,{x:-1,y:1,z:1},{x:1,y:2,z:2}),1/3);
  ctx.rockColliders.set('0,0',[{x:0,z:1.8,radius:.5,bottom:0,top:2}]);
  assert.ok(springArmFraction(a,b,ctx)<.5);
  ctx.rockColliders.clear();
  ctx.placed.push({x:0,y:1.5,z:1.8,orientation:0});
  assert.ok(springArmFraction(a,b,ctx)<1);
});
