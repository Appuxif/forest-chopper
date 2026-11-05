export function createMobJoint(THREE,physics,world,parent,part,anchor,visualRotation,config={kind:'spherical'}){
 const invA=parent.rotation.clone().invert(),invB=part.rotation.clone().invert();
 const a=anchor.clone().sub(parent.center).applyQuaternion(invA);
 const b=anchor.clone().sub(part.center).applyQuaternion(invB);
 const vec=v=>({x:v.x,y:v.y,z:v.z}),quat=q=>({x:q.x,y:q.y,z:q.z,w:q.w});
 let data,frameA,frameB;
 if(config.kind==='fixed'){
  data=physics.JointData.fixed(vec(a),quat(invA.clone().multiply(parent.rotation)),vec(b),quat(invB.clone().multiply(parent.rotation)));
 }else if(config.kind==='hinge'){
  const axis=new THREE.Vector3(1,0,0).applyQuaternion(visualRotation).normalize();
  const frame=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1,0,0),axis);
  frameA=invA.clone().multiply(frame);frameB=invB.clone().multiply(frame);
  data=physics.JointData.revoluteWithAxes(vec(a),vec(b),vec(axis.clone().applyQuaternion(invA)),vec(axis.clone().applyQuaternion(invB)));
 }else data=physics.JointData.spherical(vec(a),vec(b));
 const joint=world.createImpulseJoint(data,parent.body,part.body,true);joint.setContactsEnabled(false);
 if(config.kind==='hinge'){
  joint.setLocalFrame1(vec(a),quat(frameA));joint.setLocalFrame2(vec(b),quat(frameB));
  joint.setLimits(...config.limits);joint.configureMotorPosition(0,config.stiffness,config.damping);
 }
 return joint;
}
