/**
 * Humanoid Lite visual QA only: hide anatomical skin triangles by their
 * existing 53-bone skin weights. No changes to source GLBs or equipment.
 * The mask is intentionally coarse: it exposes where skin needs finer cuts.
 */
export const SKIN_MASK_ZONES=Object.freeze([
  {id:'torso', label:'Тело (торс и таз)'},
  {id:'head', label:'Голова'},
  {id:'neck', label:'Шея'},
  {id:'upperArms', label:'Плечи (верх рук)'},
  {id:'forearms', label:'Предплечья'},
  {id:'hands', label:'Кисти и пальцы'},
  {id:'thighs', label:'Бёдра'},
  {id:'calves', label:'Голени'},
  {id:'feet', label:'Стопы'},
]);

export function skinZoneForBone(name) {
  if(name==='head')return 'head';
  if(name.startsWith('neck_'))return 'neck';
  if(name.startsWith('clavicle_') || name.startsWith('upperarm_'))return 'upperArms';
  if(name.startsWith('lowerarm_'))return 'forearms';
  if(name.startsWith('hand_') || /^(?:index|middle|ring|pinky|thumb)_/.test(name))return 'hands';
  if(name.startsWith('thigh_'))return 'thighs';
  if(name.startsWith('calf_'))return 'calves';
  if(name.startsWith('foot_')||name.startsWith('ball_'))return 'feet';
  return 'torso';  // pelvis, Root, spine_01/02/03
}

/**
 * Classify each *triangle*, not whole independent skinned meshes.
 * Sum the vertex skin-weight contributions by anatomical zone; the strongest
 * region owns the face. Geometry is classified once in its bind pose.
 *
 * Pure helper; consumes Three.js-like BufferGeometry but imports no Three.js.
 */
export function classifySkinTriangles(skinnedMesh) {
  const geometry=skinnedMesh.geometry;
  const originalIndex=geometry.getIndex();
  const skinIndex=geometry.getAttribute('skinIndex');
  const skinWeight=geometry.getAttribute('skinWeight');
  const position=geometry.getAttribute('position');
  if(!originalIndex||!skinIndex||!skinWeight||!position)
    throw new Error('Body needs an indexed mesh with skinIndex and skinWeight attributes');
  const boneZones=skinnedMesh.skeleton.bones.map(b=>skinZoneForBone(b.name));
  const triangles=[];
  const counts=Object.fromEntries(SKIN_MASK_ZONES.map(z=>[z.id,0]));
  const originalIndices=originalIndex.array.slice();
  const get4=(a,i)=>[a.getX(i),a.getY(i),a.getZ(i),a.getW(i)];
  for(let i=0;i<originalIndices.length;i+=3){
    const scores=new Map();
    for(let corner=0;corner<3;corner++){
      const v=originalIndices[i+corner];
      const ids=get4(skinIndex,v);
      const weights=get4(skinWeight,v);
      for(let j=0;j<4;j++){
        if(weights[j]<=0)continue;
        const zone=boneZones[ids[j]]??'torso';
        scores.set(zone,(scores.get(zone)??0)+weights[j]);
      }
    }
    let max=-1,zone='torso';
    for(const [candidate,score] of scores){
      if(score>max){max=score;zone=candidate;}
    }
    triangles.push(zone);
    counts[zone]++;
  }
  return {originalIndices, triangles, counts};
}

export function maskedBodyIndices(classification,hiddenZones) {
  const hidden=new Set(hiddenZones);
  if(!hidden.size)return classification.originalIndices.slice();
  const result=[];
  const {originalIndices,triangles}=classification;
  for(let i=0;i<triangles.length;i++){
    if(hidden.has(triangles[i]))continue;
    const at=i*3;
    result.push(originalIndices[at],originalIndices[at+1],originalIndices[at+2]);
  }
  return new originalIndices.constructor(result);
}

/** Debug mask tied to ONE actor. It does not mutate the cached GLTF geometry. */
export function createDebugSkinMask(actor){
  const body=actor.meshes.find(m=>m.name==='Body');
  if(!body)throw new Error('Could not find the skinned Body mesh');
  body.geometry=body.geometry.clone();
  const classification=classifySkinTriangles(body);
  let hidden=new Set();

  function apply(zones=hidden){
    hidden=new Set(zones);
    // Three.js setIndex() expects a BufferAttribute or plain Array, not a
    // typed array (which it would store raw without .count).
    body.geometry.setIndex(Array.from(maskedBodyIndices(classification,hidden)));
    const hideHead=hidden.has('head');
    // Eyes and eyelashes are separate SkinnedMeshes in MakeHuman.
    // Prevent floating eyes when the head mask is active.
    for(const part of actor.meshes){
      if(part===body)continue;
      if(/^(Eyes|Eyebrows|Eyelashes)/.test(part.name))part.visible=!hideHead;
    }
    const hair=actor.parts.get('hair');
    if(hair)hair.visible=!hideHead;
    return stats();
  }
  function stats(){
    const total=classification.triangles.length;
    const visible=body.geometry.index.count/3;
    return {total,visible,hidden:total-visible,byZone:classification.counts};
  }
  apply();
  return {
    apply,
    stats,
    get hidden(){return new Set(hidden);},
    classification,
    body,
  };
}
