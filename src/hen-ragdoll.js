import {createMobRagdoll} from './mob-ragdoll.js';
import {createHenJoint,henCollisionGroups,henJointConfig} from './hen-ragdoll-joints.js';
import {loadRagdollPhysics} from './rapier-loader.js';

export const HEN_RAGDOLL_PROFILE={
 root:'Spine',
 segments:[
  {name:'Spine',end:'Chest',radius:.55},{name:'Chest',end:'Neck.01',radius:.43},{name:'Neck.01',end:'Neck.02',radius:.055},
  {name:'Neck.02',end:'Head',radius:.065},{name:'Head',radius:.19},
  {name:'Tail.01',end:'Tail.02',radius:.045},{name:'Tail.02',radius:.035},
  {name:'Wing.Upper.L',end:'Wing.Lower.L',radius:.055},{name:'Wing.Lower.L',end:'Wing.Tip.L',radius:.04},
  {name:'Wing.Tip.L',radius:.03},{name:'Wing.Upper.R',end:'Wing.Lower.R',radius:.055},
  {name:'Wing.Lower.R',end:'Wing.Tip.R',radius:.04},{name:'Wing.Tip.R',radius:.03},
  {name:'Leg.Thigh.L',end:'Leg.Shin.L',radius:.045},{name:'Leg.Shin.L',end:'Leg.Foot.L',radius:.035},
  {name:'Leg.Foot.L',radius:.04},{name:'Leg.Thigh.R',end:'Leg.Shin.R',radius:.045},
  {name:'Leg.Shin.R',end:'Leg.Foot.R',radius:.035},{name:'Leg.Foot.R',radius:.04},
 ],
 parents:{Chest:'Spine','Neck.01':'Chest','Neck.02':'Neck.01',Head:'Neck.02','Tail.01':'Spine','Tail.02':'Tail.01',
  'Wing.Upper.L':'Chest','Wing.Lower.L':'Wing.Upper.L','Wing.Tip.L':'Wing.Lower.L','Wing.Upper.R':'Chest',
  'Wing.Lower.R':'Wing.Upper.R','Wing.Tip.R':'Wing.Lower.R','Leg.Thigh.L':'Spine','Leg.Shin.L':'Leg.Thigh.L',
  'Leg.Foot.L':'Leg.Shin.L','Leg.Thigh.R':'Spine','Leg.Shin.R':'Leg.Thigh.R','Leg.Foot.R':'Leg.Shin.R'},
 density:name=>(name==='Spine'||name==='Chest')?650:350,
 jointConfig:henJointConfig,collisionGroups:henCollisionGroups,
};

/** Compatibility entry point for existing hen code; the solver is species-neutral. */
export function createHenRagdoll(ctx,visual,{velocityX=0,velocityZ=0,loadPhysics=loadRagdollPhysics}={}){
 return createMobRagdoll(ctx,visual,{profile:HEN_RAGDOLL_PROFILE,velocityX,velocityZ,loadPhysics});
}
// Preserve the historic joint export for any direct consumers.
export {createHenJoint};
