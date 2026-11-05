import {shortestYawDelta} from './character-orientation.js';

// Facing +yaw points along the game's (-sin(yaw), -cos(yaw)) horizontal
// forward vector. Each hit is checked against *actual* animated-facing
// torso orientation, not merely the camera crosshair.
const FRONT_HEMISPHERE=Math.PI/2;
const EPS=1e-6;

export function targetYaw(fromX,fromZ,toX,toZ){
 const dx=toX-fromX,dz=toZ-fromZ;
 if(!Number.isFinite(dx)||!Number.isFinite(dz)||
    Math.hypot(dx,dz)<EPS)return null;
 return Math.atan2(-dx,-dz);
}

export function inAttackSector(profile,orientation,from,target){
 if(!profile||!orientation||!from||!target)return false;
 const {legsYaw,torsoYaw}=orientation;
 if(!Number.isFinite(legsYaw)||!Number.isFinite(torsoYaw))return false;
 const yaw=targetYaw(from.x,from.z,target.x,target.z);
 if(yaw===null)return false;
 const sector=profile.sectorHalfAngleDeg*Math.PI/180;
 if(!Number.isFinite(sector)||sector<0||sector>Math.PI)return false;
 // An upper-body twist is not a 180-degree attack: the target must still
 // be in front of the hips, even if the head/camera sees behind the player.
 if(Math.abs(shortestYawDelta(legsYaw,yaw))>=FRONT_HEMISPHERE-EPS)
  return false;
 return Math.abs(shortestYawDelta(torsoYaw,yaw))<=sector+EPS;
}
