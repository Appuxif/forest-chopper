// Single 0.5 m construction grid; every log is 3 m long, 0.58 m wide.
export const LOG_GRID=.5;
export const BUILD_LOG_LENGTH=3;
export const BUILD_HEIGHT_STEPS=16;
export const snapLog=n=>Math.round(n/LOG_GRID)*LOG_GRID;
export const validBuildLog=log=>!!log
  && Number.isFinite(log.x)&&Number.isFinite(log.z)
  && Number.isInteger(log.height)&&log.height>=0&&log.height<BUILD_HEIGHT_STEPS
  && [0,1,2].includes(log.orientation)
  && Math.abs(log.x*2-Math.round(log.x*2))<1e-4
  && Math.abs(log.z*2-Math.round(log.z*2))<1e-4
  && Math.abs(log.x)<=240000&&Math.abs(log.z)<=240000;
export function logCenterY(log,terrainHeight,radius=.29){
 return terrainHeight+(log.orientation===2?BUILD_LOG_LENGTH/2:radius)+log.height*LOG_GRID;
}
export function logHalfExtents(log,radius=.29){
 const half=BUILD_LOG_LENGTH/2;
 return log.orientation===0?{x:half,y:radius,z:radius}
   :log.orientation===1?{x:radius,y:radius,z:half}
   :{x:radius,y:half,z:radius};
}
export function applyLogRotation(mesh,orientation){
 // CylinderGeometry's axis is Y. Orient to X, Z or leave vertical.
 if(orientation===0)mesh.rotation.set(0,0,Math.PI/2);
 else if(orientation===1)mesh.rotation.set(Math.PI/2,0,0);
 else mesh.rotation.set(0,0,0);
}
