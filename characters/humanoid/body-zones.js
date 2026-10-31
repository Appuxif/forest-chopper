/**
 * Coarse body-part occlusion for Humanoid Lite.
 *
 * Skin weights identify anatomical regions in the fixed 53-bone MakeHuman rig.
 * Each body triangle gets a single zone once at spawn; equip/unequip simply
 * changes the index buffer, never the bones/mesh/material/animations.
 * This keeps ONE body SkinnedMesh and adds no draw calls or morph targets.
 */
export const HIDDEN_SKIN_BY_CLOTHING_ZONE = Object.freeze({
  // Clothing catalog "hidesBodyZones" entries, not individual mesh names.
  shirt: ['torso','shoulder','upperArmTop','upperArm','forearm'],
  torso: ['torso','shoulder','upperArmTop'],            // short sleeves
  hoodie: ['torso','shoulder','upperArmTop','upperArm','forearm'],
  legs: ['pelvis','thighUpper','thighLower','calfUpper','calfLower'],
  shorts: ['pelvis','thighUpper'],
  hips: ['pelvis','thighUpper'],
  feet: ['foot'],
  boots: ['foot','calfLower'],
  // Thin lingerie does not fully cover the pelvis/chest. Hiding a whole
  // region here would create obvious jagged holes around the waistband.
  underwear_m: [], underwear_f: [],
  bra: [],                                             // skin visible above/below
  dress: ['torso','shoulder','upperArmTop','pelvis','thighUpper'],
  coat: ['torso','shoulder','upperArmTop','upperArm','forearm','pelvis','thighUpper'],
  jacket: ['shoulder','upperArmTop','upperArm','forearm'],             // open front may expose chest
});

function boneZone(name,y) {
  if(name==='head')return 'head';
  if(name==='neck_01')return 'neck';
  if(name.startsWith('hand_')||/^(index|thumb|middle|ring|pinky)_/.test(name))return 'hand';
  if(name.startsWith('foot_')||name.startsWith('ball_'))return 'foot';
  if(name.startsWith('calf_'))return y<.23?'calfLower':'calfUpper';
  if(name.startsWith('thigh_'))return y>.66?'thighUpper':'thighLower';
  if(name.startsWith('lowerarm_'))return 'forearm';
  if(name.startsWith('upperarm_'))return y>1.20?'upperArmTop':'upperArm';
  if(name.startsWith('clavicle_'))return 'shoulder';
  if(name==='pelvis'||name==='Root')return 'pelvis';
  return 'torso'; // spine_01, spine_02, spine_03
}

/**
 * Input is a THREE.SkinnedMesh; no THREE import so these helpers can be unit
 * tested independently in Node and use no browser-only APIs.
 */
export function makeBodySkinZones(mesh) {
  const geometry=mesh.geometry;
  const indices=geometry.index;
  const positions=geometry.getAttribute('position');
  const skinIndices=geometry.getAttribute('skinIndex');
  const weights=geometry.getAttribute('skinWeight');
  if(!indices||!skinIndices||!weights||!positions)
    throw Error('Humanoid body requires indexed geometry + skin weights');
  const names=mesh.skeleton.bones.map(b=>b.name);
  const classified=new Array(positions.count);

  for(let v=0;v<positions.count;v++){
    const y=positions.getY(v);
    const influence=new Map();
    const ids=[skinIndices.getX(v),skinIndices.getY(v),skinIndices.getZ(v),skinIndices.getW(v)];
    const w=[weights.getX(v),weights.getY(v),weights.getZ(v),weights.getW(v)];
    for(let k=0;k<4;k++){
      if(w[k]<=0)continue;
      const bone=names[ids[k]];
      if(!bone)continue;
      const zone=boneZone(bone,y);
      influence.set(zone,(influence.get(zone)||0)+w[k]);
    }
    classified[v]=[...influence].sort((a,b)=>b[1]-a[1])[0]?.[0]||'torso';
  }

  const fullIndices=indices.array.slice();
  const triangleZones=[];
  const regions=new Map();
  for(let i=0;i<fullIndices.length;i+=3){
    const ia=fullIndices[i],ib=fullIndices[i+1],ic=fullIndices[i+2];
    const a=classified[ia],b=classified[ib],c=classified[ic];
    // A dominant zone for the whole triangle (no cracks along UV seams).
    const zone=(a===b||a===c)?a:(b===c?b:a);
    triangleZones.push(zone);
    regions.set(zone,(regions.get(zone)||0)+1);
  }
  return {fullIndices,triangleZones,regions};
}

export function visibleBodyIndices(zones,equippedItems) {
  const hidden=new Set();
  for(const item of equippedItems){
    for(const catalogZone of item.hidesBodyZones||[])
      for(const segment of HIDDEN_SKIN_BY_CLOTHING_ZONE[catalogZone]||[])
        hidden.add(segment);
  }
  if(!hidden.size)return zones.fullIndices;
  const filtered=[];
  for(let i=0;i<zones.triangleZones.length;i++) {
    if(hidden.has(zones.triangleZones[i]))continue;
    filtered.push(
      zones.fullIndices[i*3],zones.fullIndices[i*3+1],zones.fullIndices[i*3+2]
    );
  }
  // Same topology/index type as imported asset; max vertex index stays valid.
  return new zones.fullIndices.constructor(filtered);
}
