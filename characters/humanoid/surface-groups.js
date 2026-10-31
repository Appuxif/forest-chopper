/**
 * Modifiable skinned surface. Body geometry never has triangles deleted:
 * exposed surfaces keep skin, covered surfaces become the inner fabric of
 * the currently equipped garment. One shared 53-bone rig, no open cuts.
 *
 * Body is essentially an undergarment/inner-lining module, not naked skin
 * under the outfit. Under a sleeve you see fabric, not an exposed arm.
 */
import {resolveSkinAssembly} from './skin-assembly.js';

const fabricColors={
  shirt:'#bac9ce',
  tshirt:'#164887',
  jeans:'#254875',
  shorts:'#776042',
  shoes:'#65412d',
  boots:'#583820',
};
export function surfaceColor(id){return fabricColors[id]||'#737576';}

function regionFor(zone,x) {
 const side=x<0?'L':'R';
 if(zone==='head')return 'head';
 if(zone==='neck')return 'neck';
 if(zone==='torso'||zone==='shoulder')return 'torso';
 if(zone==='upperArmTop')return 'sleeve'+side;
 if(zone==='upperArm')return 'upperArm'+side;
 if(zone==='forearm')return 'forearm'+side;
 if(zone==='hand')return 'hand'+side;
 if(zone==='pelvis')return 'pelvis';
 if(zone==='thighUpper'||zone==='thighLower')return 'thigh'+side;
 if(zone==='calfUpper'||zone==='calfLower')return 'calf'+side;
 if(zone==='foot')return 'foot'+side;
 throw Error('Unknown skin region '+zone);
}

/** Partition each original triangle into material groups; never discard it.
 *
 * Returned geometry can be drawn in TWO groups: visible skin and opaque
 * fabric-colored inner body (independent of the actual cloth outer mesh).
 * Fabric material can be assigned by current clothing owner via 2..N groups.
 */
export function compileSurfaceGroups(body,gear={}){
 const assembly=resolveSkinAssembly(gear);
 const groups=new Map(); // owner material key => array of triangle indices
 const indices=body.indices;
 for(let i=0;i<indices.length;i+=3){
   const tri=[indices[i],indices[i+1],indices[i+2]];
   const owned=tri.map(vertex=>{
     const zone=body.dominantZones[vertex];
     const x=body.positions[vertex*3];
     return assembly.owners[regionFor(zone,x)];
   });
   // Choosing a dominant owner is safe: no triangle is ever dropped.
   const fullOwner=owned[0]===owned[1]||owned[0]===owned[2]?owned[0]:owned[1]===owned[2]?owned[1]:owned[0];
   const owner=fullOwner.startsWith('skin:')?'skin':fullOwner;
   if(!groups.has(owner))groups.set(owner,[]);
   groups.get(owner).push(...tri);
 }
 // Render all skin as one material group even when discontinuous.
 const ordered=[...groups].sort((a,b)=>{
   const aSkin=a[0]==='skin';
   const bSkin=b[0]==='skin';
   return aSkin===bSkin?a[0].localeCompare(b[0]):(aSkin?-1:1);
 });
 const indicesOut=new body.indices.constructor(indices.length);
 const chunks=[];
 let offset=0;
 for(const [owner,tri] of ordered){
   indicesOut.set(tri,offset);
   chunks.push({owner,start:offset,count:tri.length});
   offset+=tri.length;
 }
 if(offset!==indices.length)throw Error('Surface ownership lost triangles');
 return {indices:indicesOut,chunks,assembly};
}
