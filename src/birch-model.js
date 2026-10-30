// One procedural birch template per page; all world birches instance its meshes.
import {createBirch,BIRCH_PRESET} from './birch-foliage-cards.js?v=20261031-birch1';
import {trimSpruceFoliageGeometry} from './spruce-foliage-opt.js?v=20261031-procedural-spruce1';
export function generateBirchParts(){
  try{
    const template=createBirch(BIRCH_PRESET);
    const parts=[];
    for(const mesh of template.children){
      if(!mesh.isMesh||!mesh.geometry?.getAttribute('position'))continue;
      let geometry=mesh.geometry;
      const {material}=mesh;
      if(material.alphaTest>0 && material.map?.image && geometry.getAttribute('uv')){
        try{
          const canvas=material.map.image;
          const pixels=canvas.getContext('2d',{willReadFrequently:true})
            .getImageData(0,0,canvas.width,canvas.height);
          const result=trimSpruceFoliageGeometry(geometry,pixels);
          if(result){
            geometry=result.geometry;
            mesh.geometry.dispose();
            console.info('Procedural birch foliage trimmed',result.stats);
          }
        }catch(error){console.warn('Birch foliage trim unavailable',error);}
      }
      if(geometry.boundingSphere)geometry.boundingSphere.radius+=.45;
      const part={geometry,material,foliage:material.alphaTest>0};
      if(part.foliage){
        part.rareMaterial=material.clone();
        part.rareMaterial.color.set(0xb1ced2);
      }
      parts.push(part);
    }
    if(parts.length<3||!parts.some(part=>part.foliage))
      throw new Error('Birch generator must provide bark, branches and foliage');
    console.info('Procedural birch ready',template.userData.stats);
    return parts;
  }catch(error){
    console.warn('Procedural birch unavailable; using old low-poly birches',error);
    return null;
  }
}
