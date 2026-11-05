// A short shove away from the axe, plus a bounded fraction of running inertia.
export function mobDeathMotion(mob,attacker){
 let x=mob.x-attacker.x,z=mob.z-attacker.z;
 const distance=Math.hypot(x,z);
 if(distance>.001){x/=distance;z/=distance;}
 else{x=-Math.sin(attacker.yaw??0);z=-Math.cos(attacker.yaw??0);}
 let vx=(mob.velocityX??0)*.3+x*2,vz=(mob.velocityZ??0)*.3+z*2;
 const speed=Math.hypot(vx,vz);if(speed>3){vx*=3/speed;vz*=3/speed;}
 return {velocityX:vx,velocityZ:vz};
}
