// Camera-relative locomotion intent shared by keyboard and analog joystick.
// Walking sidewards uses strafe; sprinting turns the legs to the running
// direction. Target facing is shared by WASD and the continuous joystick.
export const MOVE_DEADZONE=0.10;
// No separate sprint button is present on mobile. A strongly deflected stick
// triggers running; hysteresis keeps the gait stable near the threshold.
export const JOYSTICK_SPRINT_ENTER=0.82;
export const JOYSTICK_SPRINT_EXIT=0.70;
export function joystickSprintActive(joyX,joyY,previous=false){
  const x=Number(joyX)||0,y=Number(joyY)||0;
  const distance=Math.hypot(x,y);
  return distance>=(previous?JOYSTICK_SPRINT_EXIT:JOYSTICK_SPRINT_ENTER);
}
export const STRAFE_BLEND_START=55*Math.PI/180;
export const STRAFE_BLEND_END=70*Math.PI/180;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const axis=(negative,positive)=>Number(Boolean(positive))-Number(Boolean(negative));

export function movementInput({keys={},joyX=0,joyY=0,disabled=false}={}){
  if(disabled)return {forward:0,side:0,strength:0,angle:0,sideAngle:0,strafeWeight:0};
  const keyForward=axis(keys.KeyS||keys.ArrowDown,keys.KeyW||keys.ArrowUp);
  const keySide=axis(keys.KeyA||keys.ArrowLeft,keys.KeyD||keys.ArrowRight);
  // Keyboard and joystick both contribute; opposing directions cancel.
  const rawForward=clamp(keyForward-clamp(Number(joyY)||0,-1,1),-1,1);
  const rawSide=clamp(keySide+clamp(Number(joyX)||0,-1,1),-1,1);
  const length=Math.hypot(rawForward,rawSide);
  if(length<=MOVE_DEADZONE)
    return {forward:0,side:0,strength:0,angle:0,sideAngle:0,strafeWeight:0};
  const forward=rawForward/length,side=rawSide/length;
  const strength=clamp((length-MOVE_DEADZONE)/(1-MOVE_DEADZONE),0,1);
  const angle=Math.atan2(side,forward);
  const sideAngle=Math.atan2(Math.abs(side),Math.abs(forward));
  const strafeWeight=clamp((sideAngle-STRAFE_BLEND_START)/(STRAFE_BLEND_END-STRAFE_BLEND_START),0,1);
  return {forward,side,strength,angle,sideAngle,strafeWeight};
}

// Walking sidesteps use strafe; sprinting sidesteps use the forward/backward
// running clips with legs pointed along travel instead of a fast strafe.
// Near pure sideways, keep the previous backward run to avoid a sudden 180°
// change of gait when releasing S from Shift+S+D.
export function locomotionMode(intent,previous='idle',sprinting=false){
  if(!intent?.strength)return 'idle';
  if(sprinting){
    if(intent.forward<-.25)return 'backward';
    if(intent.forward>.25)return 'forward';
    return previous==='backward'?'backward':'forward';
  }
  // For walking the 55..70 degree band provides mode hysteresis; animation
  // cross-fades for a mode transition are handled by animations.js.
  if(intent.sideAngle>=STRAFE_BLEND_END)return 'strafe';
  if(intent.sideAngle>STRAFE_BLEND_START){
    if(previous==='strafe')return 'strafe';
    if(previous==='forward'||previous==='backward')
      return intent.forward<0?'backward':'forward';
    return intent.strafeWeight>=.5?'strafe':intent.forward<0?'backward':'forward';
  }
  return intent.forward<0?'backward':'forward';
}

// In sprint, legs align with the full travel angle even for a 90° sidestep;
// while walking, near-sideways gait blends back toward camera-facing strafe.
// Backward run keeps the character's back facing travel, never flips 180°
// just because the player pressed S.
export function targetLegsYaw(cameraYaw,intent,{mode=null,sprinting=false}={}){
  if(!intent?.strength)return cameraYaw;
  const backward=mode===null?intent.forward<0:mode==='backward';
  const angle=backward?intent.angle-Math.sign(intent.angle)*Math.PI:intent.angle;
  return cameraYaw-angle*(sprinting?1:1-intent.strafeWeight);
}

// Experimental turn inertia: keep speed under Root Motion control and only
// limit how fast the *world-space travel direction* can change. Rates are
// radians/second; lower values make turns wider. W -> W+A takes ~0.31s at
// 2.5 rad/s while sprinting. Walking remains more responsive.
export const RUN_DIRECTION_TURN_RATE=2.5;
export const WALK_DIRECTION_TURN_RATE=5;
const REVERSE_DIRECTION_SNAP=Math.PI*3/4;

export function createMovementSteering(){
  let heading=null;
  return {
    update(intent,cameraYaw,dt,{sprinting=false,disabled=false}={}){
      if(disabled||!intent?.strength){
        heading=null;
        return intent;
      }
      // World facing associated with the desired displacement, not the
      // character's body yaw (backwards gait has a different body facing).
      const targetHeading=cameraYaw-intent.angle;
      const delta=heading===null?0:Math.atan2(
        Math.sin(targetHeading-heading),Math.cos(targetHeading-heading));
      if(heading===null||Math.abs(delta)>=REVERSE_DIRECTION_SNAP){
        // A direct W -> S reversal should not arc sideways 180 degrees.
        heading=targetHeading;
      }else{
        const maxTurn=Math.max(0,dt)*(sprinting
          ?RUN_DIRECTION_TURN_RATE:WALK_DIRECTION_TURN_RATE);
        heading+=Math.sign(delta)*Math.min(Math.abs(delta),maxTurn);
      }
      const angle=Math.atan2(Math.sin(cameraYaw-heading),
        Math.cos(cameraYaw-heading));
      const forward=Math.cos(angle),side=Math.sin(angle);
      const sideAngle=Math.atan2(Math.abs(side),Math.abs(forward));
      return {...intent,forward,side,angle,sideAngle,
        strafeWeight:clamp((sideAngle-STRAFE_BLEND_START)/
          (STRAFE_BLEND_END-STRAFE_BLEND_START),0,1)};
    },
    reset(){heading=null;},
    get heading(){return heading;},
  };
}

export function worldMoveDirection(yaw,intent){
  const {forward=0,side=0}=intent??{};
  return {
    x:-Math.sin(yaw)*forward+Math.cos(yaw)*side,
    z:-Math.cos(yaw)*forward-Math.sin(yaw)*side,
  };
}
