// Runtime forest spruce. Generate a single shared template once per page load:
// all placed spruces use its geometry/material via per-chunk GPU instancing.
// No saved GLB or mesh regeneration while moving/chopping.
import {createSpruce, SPRUCE_PRESET} from './spruce-foliage-cards.js?v=20261031-spruce-bark1';
import {trimSpruceFoliageGeometry} from './spruce-foliage-opt.js?v=20261031-procedural-spruce1';

export function generateSpruceParts() {
  try {
    const template=createSpruce(SPRUCE_PRESET,{quality:'balanced',maxAnisotropy:4});
    const parts=[];
    for(const mesh of template.children){
      if(!mesh.isMesh || !mesh.geometry?.getAttribute('position'))continue;
      const {geometry,material}=mesh;
      const part={geometry,material};
      if(material.alphaTest>0 && material.map?.image && geometry.getAttribute('uv')){
        try{
          const canvas=material.map.image;
          const context=canvas.getContext('2d',{willReadFrequently:true});
          const pixels=context.getImageData(0,0,canvas.width,canvas.height);
          const optimized=trimSpruceFoliageGeometry(geometry,pixels);
          if(optimized){
            part.geometry=optimized.geometry;
            geometry.dispose();
            console.info('Procedural spruce foliage trimmed',optimized.stats);
          }
        }catch(error){console.warn('Procedural spruce foliage trim unavailable',error);}
      }
      geometry.boundingSphere && (part.geometry.boundingSphere.radius+=.45);
      if(material.alphaTest>0){
        part.rareMaterial=material.clone();
        part.rareMaterial.color.set(0xb1ced2);
      }
      parts.push(part);
    }
    if(parts.length!==2 || !parts.some(p=>p.material.alphaTest>0))
      throw new Error('Spruce generator must provide wood and foliage meshes');
    console.info('Procedural spruce ready',template.userData.spruceStats);
    return parts;
  }catch(error){
    console.warn('Procedural spruce unavailable; using classic cones',error);
    return null;
  }
}
