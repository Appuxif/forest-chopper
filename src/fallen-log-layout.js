// A single authoritative pile record represents fixed, independently collectable
// segments. Removing a bit does not recenter any of the remaining segments.
export const FALLEN_LOG_LENGTH=3.6;
export const FALLEN_LOG_GAP=.08;
export const FALL_DURATION=2.5;
export const segmentMask=box=>
  Number.isInteger(box.mask)?box.mask:(1<<box.item.count)-1;

export function fallenLogSegments(box,length=FALLEN_LOG_LENGTH){
  const mask=segmentMask(box),direction=box.direction??0;
  const dx=-Math.sin(direction),dz=Math.cos(direction);
  const step=length+FALLEN_LOG_GAP;
  const segments=[];
  for(let index=0;index<5;index++){
    if(!(mask&(1<<index)))continue;
    const distance=(index+.5)*step;
    segments.push({index,x:box.x+dx*distance,z:box.z+dz*distance});
  }
  return segments;
}
