import {createMobJoint} from './mob-ragdoll-joints.js';

export function henJointConfig(name){
 if(name==='Chest')return {kind:'fixed'};
 if(name==='Neck.01')return {kind:'hinge',limits:[-.22,.22],stiffness:45,damping:6};
 if(name==='Neck.02')return {kind:'hinge',limits:[-.18,.18],stiffness:35,damping:5};
 if(name==='Head')return {kind:'hinge',limits:[-.20,.20],stiffness:30,damping:5};
 if(name.startsWith('Leg.Thigh.'))return {kind:'hinge',limits:[-.40,.40],stiffness:25,damping:5};
 if(name.startsWith('Leg.Shin.'))return {kind:'hinge',limits:[-.45,.45],stiffness:25,damping:5};
 if(name.startsWith('Leg.Foot.'))return {kind:'hinge',limits:[-.25,.25],stiffness:20,damping:4};
 return {kind:'spherical'};
}
export function henCollisionGroups(name){
 const body=name==='Spine'||name==='Chest',head=name==='Head';
 return ((head?6:2)<<16)|(body?5:head?3:1);
}
export function createHenJoint(THREE,physics,world,parent,part,anchor,visualRotation){
 return createMobJoint(THREE,physics,world,parent,part,anchor,visualRotation,henJointConfig(part.name));
}
