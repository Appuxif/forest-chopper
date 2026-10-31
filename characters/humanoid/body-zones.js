/**
 * Continuous body shell under modular clothing (Humanoid Lite).
 *
 * Original triangle culling left OPEN holes at wrists, neckline, shorts hem
 * and the underside of loose shirts. Instead, preserve every body triangle
 * and push covered skin *inward* in bind-pose space, with a smooth transition
 * to the visible skin. The existing 53-bone skinning then animates both.
 *
 * Pure geometry helper: no Three.js dependency or runtime morph targets.
 */
export const COVERED_BODY_ZONES = Object.freeze({
  shirt: ['torso','shoulder','upperArmTop','upperArm','forearm'],
  torso: ['torso','shoulder','upperArmTop'], // short-sleeved T-shirt
  hoodie: ['torso','shoulder','upperArmTop','upperArm','forearm'],
  legs: ['pelvis','thighUpper','thighLower','calfUpper','calfLower'],
  shorts: ['pelvis','thighUpper'],
  hips: ['pelvis','thighUpper'],
  feet: ['foot'],
  boots: ['foot','calfLower'],
  // Thin lingerie is not a full covering; do not deform the whole pelvis.
  underwear_m: [], underwear_f: [], bra: [],
  dress: ['torso','shoulder','upperArmTop','pelvis','thighUpper'],
  coat: ['torso','shoulder','upperArmTop','upperArm','forearm','pelvis','thighUpper'],
  jacket: ['shoulder','upperArmTop','upperArm','forearm'], // open-front jacket
});

const OPEN_SKIN = new Set(['head','neck','hand']);

function zoneForBone(name,y) {
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
  return 'torso';
}

function smoothstep(a,b,x){
  const t=Math.min(1,Math.max(0,(x-a)/(b-a)));
  return t*t*(3-2*t);
}
const xyz=a=>a.array.slice();

/** Capture *immutable* rest-pose data once, before any outfit is equipped. */
export function makeBodySkinZones(mesh){
  const geo=mesh.geometry;
  const index=geo.index;
  const positions=geo.getAttribute('position');
  const normals=geo.getAttribute('normal');
  const skinIds=geo.getAttribute('skinIndex');
  const skinWeights=geo.getAttribute('skinWeight');
  if(!index||!positions||!normals||!skinIds||!skinWeights)
    throw Error('Body requires indexed geometry, normals and four skin weights');

  const boneNames=mesh.skeleton.bones.map(b=>b.name);
  const vertexZones=new Array(positions.count);
  const dominantZones=new Array(positions.count);
  for(let v=0;v<positions.count;v++){
    const y=positions.getY(v);
    const names=[skinIds.getX(v),skinIds.getY(v),skinIds.getZ(v),skinIds.getW(v)];
    const weights=[skinWeights.getX(v),skinWeights.getY(v),skinWeights.getZ(v),skinWeights.getW(v)];
    const zones=new Map();
    for(let k=0;k<4;k++){
      const bone=boneNames[names[k]];
      if(weights[k]<=0||!bone)continue;
      const zone=zoneForBone(bone,y);
      zones.set(zone,(zones.get(zone)||0)+weights[k]);
    }
    vertexZones[v]=zones;
    dominantZones[v]=[...zones].sort((a,b)=>b[1]-a[1])[0]?.[0]||'torso';
  }

  const neighbors=Array.from({length:positions.count},()=>new Set());
  const regions=new Map();
  const idx=index.array;
  for(let i=0;i<idx.length;i+=3){
    const a=idx[i],b=idx[i+1],c=idx[i+2];
    for(const [u,v] of [[a,b],[b,c],[c,a]]){
      neighbors[u].add(v);
      neighbors[v].add(u);
    }
    const names=[dominantZones[a],dominantZones[b],dominantZones[c]];
    const zone=names[0]===names[1]||names[0]===names[2]?names[0]:names[1]===names[2]?names[1]:names[0];
    regions.set(zone,(regions.get(zone)||0)+1);
  }
  return {
    positions:xyz(positions),
    normals:xyz(normals),
    indices:idx.slice(),
    vertexZones,
    dominantZones,
    neighbors:[...neighbors].map(s=>[...s]),
    regions,
  };
}

/**
 * Build an inset body from clothing coverage, preserving *all* vertices and
 * triangles. No body index-buffer change, no open mesh edges, no holes.
 *
 * 30mm max inset is enough for typical skinned-clothing overlap. A protective
 * fade at cuffs/neck/hem avoids exposed seams becoming cut-off cylinders.
 * Neighbor smoothing blends weights at anatomical seams and UV boundaries.
 */
export function insetBodyPositions(body,equippedItems,{depth=.032,iterations=6}={}){
  const hidden=new Set();
  for(const item of equippedItems){
    for(const catalogZone of item.hidesBodyZones||[])
      for(const zone of COVERED_BODY_ZONES[catalogZone]||[])
        hidden.add(zone);
  }
  if(!hidden.size)return body.positions.slice();

  const factors=new Float32Array(body.vertexZones.length);
  const protectedVertices=new Uint8Array(body.vertexZones.length);
  for(let v=0;v<factors.length;v++){
    const zones=body.vertexZones[v];
    const main=body.dominantZones[v];
    const y=body.positions[v*3+1];

    // Always preserve exposed head, neck, hands/fingers: their skin joins
    // the inside of the garment naturally and fills the open sleeve/collar.
    if(OPEN_SKIN.has(main)){protectedVertices[v]=1;continue;}

    let coverage=0;
    for(const [zone,weight] of zones){
      if(hidden.has(zone))coverage+=weight;
    }
    coverage=Math.max(0,Math.min(1,coverage));

    // Protect visible skin at open collar and shirt hem. Vertex weights are
    // skin-space rather than arbitrary world coordinates.
    if(main==='torso'){
      coverage*=1-smoothstep(1.33,1.42,y); // neckline
      coverage*=smoothstep(.93,1.03,y);    // shirt hem
    }
    // Stay close to full body at shorts' bottom edge; leg remains visible.
    if(main==='thighUpper'&&hidden.has('thighUpper')&&!hidden.has('thighLower')){
      coverage*=smoothstep(.64,.73,y);
    }
    factors[v]=coverage;
  }

  // Diffuse the inset near seams without moving protected vertices.
  // Does not change topology, so no UV holes / cracks are introduced.
  for(let k=0;k<iterations;k++){
    const next=factors.slice();
    for(let v=0;v<next.length;v++){
      if(protectedVertices[v])continue;
      const adj=body.neighbors[v];
      if(!adj.length)continue;
      let sum=0;
      for(const other of adj)sum+=factors[other];
      next[v]=.62*factors[v]+.38*sum/adj.length;
    }
    factors.set(next);
  }

  const out=body.positions.slice();
  for(let v=0;v<factors.length;v++){
    const d=depth*factors[v];
    const i=3*v;
    // Vertex normals point outward on our human body. Inset must be inward.
    out[i]-=body.normals[i]*d;
    out[i+1]-=body.normals[i+1]*d;
    out[i+2]-=body.normals[i+2]*d;
  }
  return out;
}
