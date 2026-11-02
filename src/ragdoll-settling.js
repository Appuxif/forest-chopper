// Experimental post-fall relaxation for the modular 53-bone humanoids.
// Rapier continues to drive the *same* skinned skeleton. No animation
// tracks, bone transforms or extra rig are used to straighten the limbs.
export const RAGDOLL_SETTLING={
  linearThreshold:.14,  // m/s, every simulated segment
  angularThreshold:.40, // rad/s
  stillSeconds:.75,
  releaseLinear:.9,     // hysteresis: ignore our own slow corrections
  releaseAngular:2.1,
  releaseSeconds:.20,
  straightenSeconds:3.5,
};
const STRAIGHTEN_JOINTS={
  'Forearm.L':{stiffness:30,damping:6},
  'Forearm.R':{stiffness:30,damping:6},
  'Shin.L':{stiffness:55,damping:8},
  'Shin.R':{stiffness:55,damping:8},
};
export const RAGDOLL_STRAIGHTEN_JOINTS=STRAIGHTEN_JOINTS;
const speed=v=>Math.hypot(v.x,v.y,v.z);
// Each ragdoll capsule's local Y points from its proximal to distal joint.
// Compare actual physical bone directions to catch a motor that starts
// folding its elbow/knee further instead of straightening it.
const longAxis=body=>{
  const q=body?.rotation?.();
  if(!q)return null;
  return {x:2*(q.x*q.y-q.w*q.z),
    y:1-2*(q.x*q.x+q.z*q.z),
    z:2*(q.y*q.z+q.w*q.x)};
};
export function physicalLimbBend(upperBody,lowerBody){
  const a=longAxis(upperBody),b=longAxis(lowerBody);
  if(!a||!b)return null;
  const cosine=a.x*b.x+a.y*b.y+a.z*b.z;
  return Math.acos(Math.max(-1,Math.min(1,cosine)));
}
const PART_PARENT={
 'Forearm.L':'UpperArm.L','Forearm.R':'UpperArm.R',
 'Shin.L':'Thigh.L','Shin.R':'Thigh.R',
};
export function createRagdollSettling(parts,joints,{enabled=true,targets=new Map()}={}){
  let stillTime=0,releaseTime=0,progress=0,settled=false;
  const byName=new Map(parts.map(part=>[part.name,part.body]));
  const motors=enabled?Object.entries(STRAIGHTEN_JOINTS)
    .filter(([name])=>joints.has(name)&&Number.isFinite(targets.get(name)))
    .map(([name,settings])=>({
      link:joints.get(name),settings,name,target:targets.get(name),
      upper:byName.get(PART_PARENT[name]),lower:byName.get(name),
      startBend:null,disabled:false,
    })):[];
  const state=()=>({settled,stillSeconds:stillTime,
    straightening:progress>0,straightenProgress:progress,
    limbAngles:Object.fromEntries(motors.map(m=>[m.name,{
      bend:physicalLimbBend(m.upper,m.lower),
      target:m.target,disabled:m.disabled,
      sleeping:m.lower?.isSleeping?.(),
    }]))});

  function stop(){
    if(!settled)return;
    for(const motor of motors){
      motor.link.configureMotorPosition(0,0,0);
      motor.startBend=null;motor.disabled=false;
    }
    settled=false;stillTime=0;releaseTime=0;progress=0;
  }
  function tick(dt){
    if(!enabled||!motors.length||!(dt>0))return state();
    // Evaluate *every* body, not just the pelvis: an arm can still be
    // flailing even when the torso is motionless.
    const movement=parts.map(({body})=>{
      if(body.isSleeping?.())return {linear:0,angular:0};
      return {linear:speed(body.linvel()),angular:speed(body.angvel())};
    });
    const quiet=movement.every(v=>v.linear<RAGDOLL_SETTLING.linearThreshold
      &&v.angular<RAGDOLL_SETTLING.angularThreshold);
    const disrupted=movement.some(v=>v.linear>RAGDOLL_SETTLING.releaseLinear
      ||v.angular>RAGDOLL_SETTLING.releaseAngular);
    if(!settled){
      stillTime=quiet?Math.min(RAGDOLL_SETTLING.stillSeconds,stillTime+dt):0;
      if(stillTime<RAGDOLL_SETTLING.stillSeconds)return state();
      settled=true;
      for(const motor of motors){
        motor.startBend=physicalLimbBend(motor.upper,motor.lower);
        motor.disabled=false;
      }
      // Bodies may have been put to sleep by Rapier. Wake them *once*
      // so the soft motor has a chance to adjust the resting pose.
      for(const {name} of motors){
        const part=parts.find(part=>part.name===name);
        part?.body.wakeUp?.();
      }
    }else{
      releaseTime=disrupted?releaseTime+dt:0;
      if(releaseTime>=RAGDOLL_SETTLING.releaseSeconds){
        stop();
        return state();
      }
    }
    progress=Math.min(1,progress+dt/RAGDOLL_SETTLING.straightenSeconds);
    // Smoothstep prevents a sudden torque when the figure first settles.
    const blend=progress*progress*(3-2*progress);
    for(const motor of motors){
      if(motor.disabled)continue;
      const current=physicalLimbBend(motor.upper,motor.lower);
      // Fail safe: when a constraint's sign or an obstacle makes a limb
      // fold >15 degrees deeper, stop pushing it until the next fall.
      if(progress>.15&&motor.startBend!=null&&current!=null
        &&current>motor.startBend+.26){
        motor.link.configureMotorPosition(0,0,0);
        motor.disabled=true;
        continue;
      }
      motor.link.configureMotorPosition(motor.target,motor.settings.stiffness*blend,
        motor.settings.damping*blend);
      motor.upper?.wakeUp?.();
      motor.lower?.wakeUp?.();
    }
    return state();
  }
  return {tick,state,stop};
}
