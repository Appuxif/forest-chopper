// Canonical orientation state. Yaw angles are in world-space radians; the
// headYaw/headPitch fields will become local residuals when ORI-04 applies
// procedural neck/spine poses. Camera and leg facing are now independent.
// Legs should reach a 45-degree diagonal within ~90 ms without snapping.
// Slow turning while idle lets the avatar settle back toward camera heading.
export const LEG_TURN_RATE_MOVING=9; // rad/s (~516 deg/s)
export const LEG_TURN_RATE_IDLE=6;   // rad/s (~344 deg/s)

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
    // Only reset facing for legacy rigs, ragdoll/death or explicit teleports.
    alignToCamera(){
      this.legsYaw=this.cameraYaw;
      this.torsoYaw=this.cameraYaw;
      this.torsoPitch=0;
      this.headYaw=0;
      this.headPitch=0;
      return this;
    },
    steerLegs(dt,{locked=false}={}){
      if(locked)return this.alignToCamera();
      const speed=this.moveStrength>0?LEG_TURN_RATE_MOVING:LEG_TURN_RATE_IDLE;
      this.legsYaw=approachYaw(this.legsYaw,this.legsTargetYaw,
        Math.max(0,dt)*speed);
      // Temporary ORI-03 alignment: the full actor turns with the legs.
      // ORI-04 will redistribute the yaw between pelvis/spine/neck and
      // aim the upper body at the camera. Never add a second skeleton.
      this.torsoYaw=this.legsYaw;
      this.torsoPitch=0;
      this.headYaw=0;
      this.headPitch=0;
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
