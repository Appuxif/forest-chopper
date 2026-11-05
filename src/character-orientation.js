// Canonical orientation state. All angles are radians; camera/legs/torso yaw
// are world-facing, head yaw is relative to torso, pitch is distributed
// between upper spine and neck. Movement stays independent of camera aim.
// ORI-04 adds secondary look articulation without another mixer or skeleton.
// [min, max, step, default, UI label, unit]. Angles are persisted in degrees;
// turn rates are radians/sec. One source of truth for UI, persistence and rig.
export const CHARACTER_LOOK_FIELDS=Object.freeze({
 lookTorsoYaw:[0,90,5,60,'Корпус · влево / вправо','°'],
 lookHeadYaw:[0,100,5,60,'Голова и шея · влево / вправо','°'],
 lookRunYawReduction:[1,10,1,1,'Бег · уменьшение поворота корпуса и головы','×'],
 lookFreeYaw:[0,180,5,120,'Свободный обзор без поворота ног','°'],
 lookTorsoDown:[0,80,5,40,'Корпус · наклон вниз','°'],
 lookTorsoUp:[0,80,5,20,'Корпус · наклон вверх','°'],
 lookHeadDown:[0,90,5,40,'Голова · наклон вниз','°'],
 lookHeadUp:[0,90,5,45,'Голова · наклон вверх','°'],
 lookLegTurnMoving:[1,18,.5,9,'Ноги при движении · скорость поворота','рад/с'],
 lookLegTurnIdle:[.5,10,.1,2.8,'Ноги в покое · скорость поворота','рад/с'],
 lookTorsoTurnSpeed:[1,18,.5,6,'Корпус · скорость поворота','рад/с'],
 lookHeadTurnSpeed:[1,25,.5,14,'Голова · скорость поворота','рад/с'],
});
const deg=Math.PI/180;
const def=key=>CHARACTER_LOOK_FIELDS[key][3];
const field=(settings,key)=>{
 const value=settings?.[key];
 const [min,max,,fallback]=CHARACTER_LOOK_FIELDS[key];
 return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max
  ?value:fallback;
};
// Public constants remain available to the existing math/regression tests.
export const LEG_TURN_RATE_MOVING=def('lookLegTurnMoving');
export const LEG_TURN_RATE_IDLE=def('lookLegTurnIdle');
export const IDLE_FREE_LOOK_YAW=def('lookFreeYaw')*deg;
export const MAX_TORSO_YAW=def('lookTorsoYaw')*deg;
export const MAX_HEAD_YAW=def('lookHeadYaw')*deg;
export const MAX_TORSO_DOWN=def('lookTorsoDown')*deg;
export const MAX_TORSO_UP=def('lookTorsoUp')*deg;
export const MAX_HEAD_DOWN=def('lookHeadDown')*deg;
export const MAX_HEAD_UP=def('lookHeadUp')*deg;
export const TORSO_LOOK_SPEED=def('lookTorsoTurnSpeed');
export const HEAD_LOOK_SPEED=def('lookHeadTurnSpeed');
const clamp=(value,low,high)=>Math.min(high,Math.max(low,value));
const step=(value,target,maxStep)=>value+clamp(target-value,-maxStep,maxStep);

export function createCharacterOrientation({cameraYaw=0,cameraPitch=0}={}){
  return {
    cameraYaw,cameraPitch,
    legsYaw:cameraYaw,
    torsoYaw:cameraYaw,
    torsoPitch:0,
    headYaw:0,
    headPitch:0,
    // Continuous camera-relative movement intent, shared by keyboard/joystick.
    moveAngle:0,
    moveStrength:0,
    strafeWeight:0,
    moveMode:'idle',
    legsTargetYaw:cameraYaw,
    setMovementIntent(intent,mode,targetYaw){
      this.moveAngle=intent.angle;
      this.moveStrength=intent.strength;
      this.strafeWeight=intent.strafeWeight;
      this.moveMode=mode;
      this.legsTargetYaw=targetYaw;
    },
    // Reset facing only for ragdoll/death or explicit teleports.
    alignToCamera(){
      this.legsYaw=this.cameraYaw;
      this.torsoYaw=this.cameraYaw;
      this.torsoPitch=0;
      this.headYaw=0;
      this.headPitch=0;
      return this;
    },
    steerLegs(dt,{locked=false,settings=null}={}){
      if(locked)return this.alignToCamera();
      const moving=this.moveStrength>0;
      let target=this.legsTargetYaw;
      if(!moving){
        // Standing feet follow the camera only after the free-look threshold.
        const threshold=field(settings,'lookFreeYaw')*deg;
        const delta=shortestYawDelta(this.legsYaw,this.cameraYaw);
        target=Math.abs(delta)<=threshold?this.legsYaw:
          this.cameraYaw-Math.sign(delta)*threshold;
      }
      this.legsYaw=approachYaw(this.legsYaw,target,
        Math.max(0,dt)*field(settings,moving?'lookLegTurnMoving':'lookLegTurnIdle'));
      return this;
    },
    steerUpper(dt,{locked=false,settings=null,running=false}={}){
      if(locked)return this.alignToCamera();
      const seconds=Math.max(0,dt);
      // While running, only the lateral torso/head limits are reduced.
      // Pitch limits, turn speeds and idle/walk free-look remain unchanged.
      const yawDivisor=running?field(settings,'lookRunYawReduction'):1;
      const torsoLimit=field(settings,'lookTorsoYaw')*deg/yawDivisor;
      const headLimit=field(settings,'lookHeadYaw')*deg/yawDivisor;
      const torsoSpeed=field(settings,'lookTorsoTurnSpeed');
      const headSpeed=field(settings,'lookHeadTurnSpeed');
      const delta=shortestYawDelta(this.legsYaw,this.cameraYaw);
      const targetChest=this.legsYaw+clamp(delta*.5,-torsoLimit,torsoLimit);
      this.torsoYaw=approachYaw(this.torsoYaw,targetChest,torsoSpeed*seconds);
      // Keep animated chest within the configured limit relative to hips.
      this.torsoYaw=this.legsYaw+clamp(shortestYawDelta(this.legsYaw,this.torsoYaw),
        -torsoLimit,torsoLimit);
      const neckTarget=clamp(shortestYawDelta(this.torsoYaw,this.cameraYaw),
        -headLimit,headLimit);
      this.headYaw=clamp(step(this.headYaw,neckTarget,headSpeed*seconds),
        -headLimit,headLimit);
      const torsoPitchTarget=clamp(this.cameraPitch*.62,
        -field(settings,'lookTorsoDown')*deg,field(settings,'lookTorsoUp')*deg);
      this.torsoPitch=step(this.torsoPitch,torsoPitchTarget,torsoSpeed*seconds);
      const headPitchTarget=clamp(this.cameraPitch-this.torsoPitch,
        -field(settings,'lookHeadDown')*deg,field(settings,'lookHeadUp')*deg);
      this.headPitch=step(this.headPitch,headPitchTarget,headSpeed*seconds);
      return this;
    },
  };
}

// Use the shortest signed turn across the -PI/PI seam. Future leg/torso
// steering and attack weight can share these pure helpers.
export function shortestYawDelta(from,to){
  return Math.atan2(Math.sin(to-from),Math.cos(to-from));
}
export function approachYaw(from,to,maxStep){
  if(!Number.isFinite(maxStep)||maxStep<0)throw new RangeError('Invalid yaw step');
  const delta=shortestYawDelta(from,to);
  return from+Math.sign(delta)*Math.min(Math.abs(delta),maxStep);
}
