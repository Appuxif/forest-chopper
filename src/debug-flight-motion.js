// Debug-only free flight. Forward follows the camera's pitch; strafe stays level.
// Manual ascend/descend uses the same speed and is normalized with movement.
export function debugFlightDelta({forward=0,side=0,yaw=0,pitch=0,vertical=0,dt=0,speed=24}={}){
 const cosine=Math.cos(pitch);
 let x=(-Math.sin(yaw)*cosine)*forward+Math.cos(yaw)*side;
 let y=Math.sin(pitch)*forward+vertical;
 let z=(-Math.cos(yaw)*cosine)*forward-Math.sin(yaw)*side;
 const length=Math.hypot(x,y,z);
 if(length>1){x/=length;y/=length;z/=length;}
 return {x:x*speed*dt,y:y*speed*dt,z:z*speed*dt};
}
