// ORI-04 — additive, anatomy-limited upper body aiming on the existing rig.
// The GLB joints have nontrivial rest rotations (Blender Z-up converted to
// Three.js). Apply rotations around WORLD up and character/camera right,
// transformed into each joint parent's local space. Using raw bone.rotation.y
// would bend some joints sideways and twist the neck.
//
// This controller is LOCAL only until ORI-07 adds multiplayer look sectors.
// Run restore() BEFORE AnimationMixer.update and apply() AFTER it. Both male
// and female rigs key every look joint in their animation clips.
import {shortestYawDelta} from './character-orientation.js';

export const SPINE_JOINTS=['spine_01','spine_02','spine_03'];
export const HEAD_JOINTS=['neck_01','head'];
export const SPINE_WEIGHTS=[.22,.33,.45];
export const HEAD_WEIGHTS=[.45,.55];
const EPSILON=1e-8;

export function lookJointAngles(orientation){
 const chestYaw=shortestYawDelta(orientation.legsYaw,orientation.torsoYaw);
 return [
  ...SPINE_JOINTS.map((name,i)=>({
   name,yaw:chestYaw*SPINE_WEIGHTS[i],
   pitch:orientation.torsoPitch*SPINE_WEIGHTS[i],
  })),
  ...HEAD_JOINTS.map((name,i)=>({
   name,yaw:orientation.headYaw*HEAD_WEIGHTS[i],
   pitch:orientation.headPitch*HEAD_WEIGHTS[i],
  })),
 ];
}

export function createProceduralLook(THREE,bones){
 if(!bones||[...SPINE_JOINTS,...HEAD_JOINTS].some(name=>!bones.get(name)))
   return null; // Legacy rig is not an ORI-04 target.
 const joints=[...SPINE_JOINTS,...HEAD_JOINTS].map(name=>bones.get(name));
 const animated=new Map(); // pre-procedural pose, restored before next mixer tick
 const worldUp=new THREE.Vector3(0,1,0);
 const worldRight=new THREE.Vector3(1,0,0);
 const parentWorld=new THREE.Quaternion();
 const localAxis=new THREE.Vector3();
 const delta=new THREE.Quaternion();
 function addWorldRotation(bone,axis,radians){
  if(Math.abs(radians)<EPSILON)return;
  // parent.getWorldQuaternion() updates its ancestor chain, including any
  // earlier spine corrections in this very frame.
  bone.parent.getWorldQuaternion(parentWorld);
  localAxis.copy(axis).applyQuaternion(parentWorld.invert()).normalize();
  delta.setFromAxisAngle(localAxis,radians);
  bone.quaternion.premultiply(delta);
 }
 function restore(){
  for(const [bone,q] of animated)bone.quaternion.copy(q);
  animated.clear();
 }
 function discard(){
  // Physics/ragdoll owns the skeleton; never restore stale animated poses
  // over its simulated bones when recovering from a fall/death.
  animated.clear();
 }
 function apply(orientation){
  if(!orientation)return false;
  if(animated.size)restore(); // safe against an accidental double apply
  for(const bone of joints)animated.set(bone,bone.quaternion.clone());
  // The camera forward is -Z at yaw=0. Camera-right is +X at yaw=0.
  // A negative pitch bends the chest toward a ground-level target.
  worldRight.set(Math.cos(orientation.cameraYaw),0,-Math.sin(orientation.cameraYaw));
  for(const {name,yaw,pitch} of lookJointAngles(orientation)){
   const bone=bones.get(name);
   addWorldRotation(bone,worldUp,yaw);
   addWorldRotation(bone,worldRight,pitch);
  }
  return true;
 }
 return {apply,restore,discard};
}
