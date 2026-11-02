/** Runtime body UV alpha mask from the SAME library and item matrix as the editor.
 * No vertex insets, no anatomical-zone masks, no garment projection.
 * Cached composited textures are shared between avatar instances.
 */
import * as THREE from 'https://esm.sh/three@0.170.0';
import {outfitMaskNames} from './skin-mask-matrix.js';
const ROOT=new URL('./masks/',import.meta.url);
let sourcePromise;
const pngCache=new Map();
const composites=new Map();

async function source(){
  if(!sourcePromise){
    sourcePromise=Promise.all([
      fetch(new URL('clothing-matrix.json',ROOT),{cache:'no-store'}),
      fetch(new URL('manifest.json',ROOT),{cache:'no-store'}),
    ]).then(async ([matrix,manifest])=>{
      if(!matrix.ok||!manifest.ok)throw Error(`Could not load skin mask matrix/manifest (${matrix.status}/${manifest.status})`);
      const [mapping,index]=await Promise.all([matrix.json(),manifest.json()]);
      if(mapping.resolution!==1024||index.resolution!==1024)throw Error('Skin mask resolution mismatch (expected 1024)');
      return {mapping,index};
    }).catch(error=>{sourcePromise=null;throw error});
  }
  return sourcePromise;
}
async function imageFor(gender,name){
  const key=gender+'/'+name;
  if(!pngCache.has(key)){
    pngCache.set(key,new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>image.width===1024&&image.height===1024?resolve(image):reject(Error('Unexpected PNG mask size: '+key));
      image.onerror=()=>reject(Error('Could not decode PNG mask: '+key));
      image.src=new URL(`${gender}/${name}.png`,ROOT).href;
    }).catch(error=>{pngCache.delete(key);throw error}));
  }
  return pngCache.get(key);
}
async function composition(gender,names){
  if(!names.length)return null;
  const key=gender+':'+names.join(',');
  if(!composites.has(key)){
    composites.set(key,(async()=>{
      const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;
      const ctx=canvas.getContext('2d');
      if(!ctx)throw Error('Skin masks require canvas 2D rendering');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,1024,1024);
      const images=await Promise.all(names.map(name=>imageFor(gender,name)));
      ctx.globalCompositeOperation='darken';
      for(const image of images)ctx.drawImage(image,0,0);
      ctx.globalCompositeOperation='source-over';
      const texture=new THREE.CanvasTexture(canvas);
      texture.flipY=false;
      texture.colorSpace=THREE.NoColorSpace;
      texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
      texture.minFilter=THREE.LinearMipmapLinearFilter;
      texture.magFilter=THREE.LinearFilter;
      return texture;
    })().catch(error=>{composites.delete(key);throw error}));
  }
  return composites.get(key);
}
export async function applyBodyMaskFromOutfit(actor){
  const revision=actor._bodyMaskRevision=(actor._bodyMaskRevision||0)+1;
  const {mapping,index}=await source();
  const equipment=Object.fromEntries([...actor.parts].filter(([slot])=>slot!=='hair')
    .map(([slot,mesh])=>[slot,mesh.userData.catalogId]));
  const names=outfitMaskNames(mapping,actor.appearance.body,equipment);
  const known=new Set(index.masks?.[actor.appearance.body]||[]);
  const missing=names.filter(name=>!known.has(name));
  if(missing.length)throw Error('Missing authored masks: '+actor.appearance.body+'/'+missing.join(','));
  const texture=await composition(actor.appearance.body,names);
  if(revision!==actor._bodyMaskRevision)return actor;
  const material=actor.body.material;
  material.alphaMap=texture;
  material.alphaTest=texture?.5:0;
  material.alphaToCoverage=Boolean(texture);
  material.needsUpdate=true;
  actor.body.userData.activeSkinMasks=names;
  return actor;
}
