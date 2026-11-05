// Persist only bounded, finite bone transforms; this remains engine-neutral.
export function validMobPoses(value,{maxMobs=32,maxBones=256}={}){
 if(!Array.isArray(value)||value.length>maxMobs)return false;
 const ids=new Set();
 return value.every(p=>{
  if(!p||typeof p.id!=='string'||p.id.length>100||ids.has(p.id)||!Array.isArray(p.bones)||p.bones.length>maxBones)return false;
  ids.add(p.id);const names=new Set();
  return p.bones.every(b=>{
   if(!b||typeof b.name!=='string'||b.name.length>64||names.has(b.name))return false;names.add(b.name);
   return Array.isArray(b.p)&&b.p.length===3&&b.p.every(n=>Number.isFinite(n)&&Math.abs(n)<100)
    &&Array.isArray(b.q)&&b.q.length===4&&b.q.every(Number.isFinite)&&Math.abs(Math.hypot(...b.q)-1)<.01;
  });
 });
}
export function captureMobPose(id,visual){
 const bones=[];visual.traverse(n=>{if(n.isBone)bones.push({name:n.name,p:n.position.toArray(),q:n.quaternion.toArray()});});
 return {id,bones};
}
export function applyMobPose(visual,pose){
 const bones=new Map(pose.bones.map(b=>[b.name,b]));
 visual.traverse(n=>{const b=bones.get(n.name);if(n.isBone&&b){n.position.fromArray(b.p);n.quaternion.fromArray(b.q).normalize();}});
 visual.updateMatrixWorld(true);
}
