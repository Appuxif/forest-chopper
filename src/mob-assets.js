import {selectMobSubcategory} from './mob-types.js';
// Asset ownership is per catalog, skeleton/mixer ownership is per actor.
export async function loadMobAssets(THREE,registry,{loadModel,cloneModel,loadTexture}={}){
 if(!loadModel||!cloneModel){
  const [{GLTFLoader},{clone}]=await Promise.all([
   import('https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js'),
   import('https://esm.sh/three@0.170.0/examples/jsm/utils/SkeletonUtils.js')]);
  loadModel??=url=>new GLTFLoader().loadAsync(url);cloneModel??=clone;
 }
 loadTexture??=url=>new THREE.TextureLoader().loadAsync(url);
 const files=new Map(),assets=new Map();
 for(const definition of registry.list()){
  const model=definition.model;
  if(!files.has(model.url))files.set(model.url,loadModel(model.url));
  const gltf=await files.get(model.url),clips=new Map(),speeds=new Map(),variants=new Map();
  for(const source of gltf.animations){
   const clip=source.clone(),start=Math.min(...clip.tracks.map(t=>t.times[0]));
   if(Number.isFinite(start)&&start>0){for(const track of clip.tracks)for(let i=0;i<track.times.length;i++)track.times[i]-=start;clip.duration-=start;}
   for(const track of clip.tracks){
    if(!/^Root\.position$/i.test(track.name))continue;
    const a=track.values,b=a.length-3;speeds.set(clip.name,Math.hypot(a[b]-a[0],a[b+2]-a[2])*model.scale/clip.duration);
    for(let i=0;i<a.length;i+=3){a[i]=0;a[i+2]=0;}
   }
   clips.set(clip.name,clip);
  }
  const roles=definition.animations;
  for(const name of new Set([roles.idle,roles.walk,roles.fast,roles.run,roles.rest,...roles.forage]))if(!clips.has(name))throw new Error(`Missing animation ${name} for ${definition.id}`);
  for(const variant of Object.values(definition.subcategories)){
   if(!variant.texture)continue;
   const texture=await loadTexture(variant.texture);texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;
   const materials=new Map();
   gltf.scene.traverse(node=>{if(!node.isMesh)return;for(const material of Array.isArray(node.material)?node.material:[node.material]){
    if(!model.variantMaterial||!material.name.includes(model.variantMaterial)||materials.has(material))continue;
    const copy=material.clone();copy.map=texture;materials.set(material,copy);
   }});
   variants.set(variant.id,materials);
  }
  assets.set(definition.id,{definition,clips,speeds,create(record,seed){
   const group=new THREE.Group(),visual=cloneModel(gltf.scene),subcategory=record.subcategory??selectMobSubcategory(definition,seed,record.id);
   visual.scale.multiplyScalar(model.scale);group.add(visual);
   const materials=variants.get(subcategory);
   visual.traverse(node=>{if(!node.isMesh)return;node.castShadow=true;node.receiveShadow=true;node.frustumCulled=false;
    if(materials)node.material=Array.isArray(node.material)?node.material.map(m=>materials.get(m)??m):materials.get(node.material)??node.material;
   });
   return {group,visual};
  }});
 }
 return assets;
}
