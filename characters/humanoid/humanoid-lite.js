/**
 * Forest Chopper: simple, game-oriented modular humanoid.
 * One 53-bone skinned armature per character, two fixed bodies, CC0 outfit library.
 * One game/body_{gender}.glb per gender, each with its own Action bank and face morph targets.
 * Outfit and hair GLBs remain separately skinned onto the active character rig.
 */
import * as THREE from 'https://esm.sh/three@0.170.0';
import {GLTFLoader} from 'https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'https://esm.sh/three@0.170.0/examples/jsm/utils/SkeletonUtils.js';
import {applyBodyMaskFromOutfit} from './body-mask-runtime.js?v=20261102-matrix1';

const BASE=new URL('./',import.meta.url);
const loader=new GLTFLoader();
const variantTextureLoader=new THREE.TextureLoader();
const variantTextures=new Map();
function loadClothingVariantTexture(itemId,variantId){
  const key=itemId+'/'+variantId;
  if(!variantTextures.has(key)){
    const url=new URL('textures/clothing/'+itemId+'/'+variantId+'.png',BASE).href;
    const request=variantTextureLoader.loadAsync(url).then(texture=>{
      // Clothing UVs were exported as glTF: keep same vertical orientation.
      texture.flipY=false;
      texture.colorSpace=THREE.SRGBColorSpace;
      texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
      texture.anisotropy=4;
      texture.needsUpdate=true;
      return texture;
    }).catch(error=>{variantTextures.delete(key);throw error});
    variantTextures.set(key,request);
  }
  return variantTextures.get(key);
}
const gltfCache=new Map();
const jsonCache=new Map();
const loadGLTF=relative=>{
  if(!gltfCache.has(relative))gltfCache.set(relative,
    loader.loadAsync(new URL(relative,BASE).href).catch(err=>{gltfCache.delete(relative);throw err}));
  return gltfCache.get(relative);
};
const loadJSON=relative=>{
  if(!jsonCache.has(relative))jsonCache.set(relative,
    fetch(new URL(relative,BASE)).then(r=>{if(!r.ok)throw Error('Missing '+relative);return r.json()}));
  return jsonCache.get(relative);
};
export const BODIES=['male','female'];
export const FACE_PRESETS=['default','angular','soft'];
export const SOCKET_BONES={
  handRight:'hand_r',handLeft:'hand_l',head:'head',
  back:'spine_03',chest:'spine_03',waist:'pelvis'
};
export const DEFAULT_APPEARANCE={
  body:'male',face:'default',skin:'default',hair:'short02',hairColor:'#ffffff',
  top:'shirt',bottom:'jeans',shoes:'shoes',outerwear:null
};
const COLORS={
  skin:{
    default:'#ffffff',pale:'#ffede6',warm:'#edc9b2',
    tan:'#dcae91',deep:'#a3725f'
  }
};
export async function getHumanoidCatalog(){
 const [clothing,hair,variants]=await Promise.all([
   loadJSON('source/clothing.json'),loadJSON('source/hair.json'),
   loadJSON('source/clothing-variants.json')
 ]);
 return {clothing,hair,variants};
}
const gearName=(file,gender)=>'lite/'+file.replace(/\.glb$/,'')+'_'+gender+'.glb'+(file==='clothing_shirt.glb'||file==='clothing_tshirt.glb'?'?open-cuffs=20261102':'');

export class LiteHumanoid {
  constructor(scene,clips,appearance,catalog){
    this.root=new THREE.Group();this.root.name='Humanoid.'+appearance.body;
    this.model=scene;this.root.add(scene);
    this.appearance={...appearance,clothingVariants:{...(appearance.clothingVariants||{})}};
    this.catalog=catalog;
    this.bones=new Map();this.meshes=[];
    scene.traverse(o=>{
      if(o.isBone)this.bones.set(o.name,o);
      if(o.isSkinnedMesh){this.meshes.push(o);o.castShadow=true;o.frustumCulled=false;}
    });
    if(this.bones.size!==53)throw Error('Expected exactly 53 humanoid joints');
    this.body=this.meshes.find(o=>o.name==='Body')||this.meshes[0];
    this.skeleton=this.body.skeleton;
    // The only skin visibility rule is an authored UV PNG mask matrix.
    // Materials must be per-avatar, but the precomposed PNG atlas is shared.
    this.body.material=this.body.material.clone();
    const originalTint=this.body.material.userData.originalColor;
    if(originalTint!==undefined)
      this.body.material.userData.originalColor=originalTint?.isColor
        ?originalTint.clone():new THREE.Color(originalTint);
    this.maskEditor=appearance.maskEditor===true;
    this._bodyMaskRevision=0;
    this.mixer=new THREE.AnimationMixer(this.root);
    this.clips=clips;
    this.action=null;
    this.parts=new Map();this.sockets=new Map();
    // Not reliable for open jackets: the projection cuts visible undershirts.
    // Only enable this legacy experiment when the caller explicitly opts in.
    for(const [name,boneName] of Object.entries(SOCKET_BONES)){
      const parent=this.bones.get(boneName);
      if(!parent)throw Error('Missing socket bone: '+boneName);
      const socket=new THREE.Object3D();socket.name='Socket.'+name;
      parent.add(socket);this.sockets.set(name,socket);
    }
    this.setSkinColor(appearance.skin);
    this.setFacePreset(appearance.face);
  }
  setFacePreset(face='default'){
    if(!FACE_PRESETS.includes(face))throw Error('Unknown face preset: '+face);
    for(const mesh of this.meshes){
      const dict=mesh.morphTargetDictionary||{};
      const values=mesh.morphTargetInfluences;
      if(!values)continue;
      if(dict.angular!==undefined)values[dict.angular]=face==='angular'?1:0;
      if(dict.soft!==undefined)values[dict.soft]=face==='soft'?1:0;
    }
    this.appearance.face=face;
    return this;
  }
  setSkinColor(color){
    const tint=COLORS.skin[color]||color||'#ffffff';
    for(const mesh of this.meshes){
      // Only skin, not eyes, eyelashes, eyebrow textures, clothing etc.
      if(mesh.name!=='Body')continue;
      if(!mesh.material.userData.originalColor) {
        mesh.material=mesh.material.clone();
        mesh.material.userData.originalColor=mesh.material.color.clone();
      }
      mesh.material.color.copy(mesh.material.userData.originalColor).multiply(new THREE.Color(tint));
    }
    this.appearance.skin=color;
    return this;
  }
  setHairColor(color){
    this.appearance.hairColor=color;
    const hair=this.parts.get('hair');
    if(!hair)return this;
    if(!hair.material.userData.baseHairColor) hair.material.userData.baseHairColor=hair.material.color.clone();
    hair.material.color.copy(hair.material.userData.baseHairColor).multiply(new THREE.Color(color));
    return this;
  }
  /**
   * Switch a clothing material without replacing the skinned mesh.
   * Authored body UV masks and animations remain untouched.
   */
  async setClothingVariant(slot,variantId='default'){
    const mesh=this.parts.get(slot);
    if(!mesh||slot==='hair')return this;
    const itemId=mesh.userData.assetId;
    const options=this.catalog.variants?.items?.[itemId]||[];
    const choice=options.find(x=>x.id===variantId)||options[0];
    if(!choice)return this;
    const material=mesh.material;
    if(!mesh.userData.clothingVariantBase){
      mesh.userData.clothingVariantBase={
        map:material.map,color:material.color.clone(),
        roughness:material.roughness,metalness:material.metalness
      };
    }
    const revision=(mesh.userData.clothingVariantRevision||0)+1;
    mesh.userData.clothingVariantRevision=revision;
    const original=mesh.userData.clothingVariantBase;
    if(choice.original){
      material.map=original.map;
      material.color.copy(original.color);
      material.roughness=original.roughness;
      material.metalness=original.metalness;
    }else{
      const map=await loadClothingVariantTexture(itemId,choice.id);
      // A new item or newer selection may have arrived while loading PNG.
      if(this.parts.get(slot)!==mesh||mesh.userData.clothingVariantRevision!==revision)
        return this;
      material.map=map;
      material.color.set('#ffffff');
      material.roughness={
        leather:.72,suede:.94,denim:.88,plaid:.92,
        fleece:.98,canvas:.90,waxed:.70,cotton:.91
      }[choice.style]??original.roughness;
      material.metalness=0;
    }
    material.needsUpdate=true;
    mesh.userData.clothingVariant=choice.id;
    this.appearance.clothingVariants[slot]=choice.id;
    return this;
  }
  async equip(slot,id){
    const {clothing,hair}=this.catalog;
    if(slot!=='hair'&&!clothing.slots.includes(slot))throw Error('Unknown slot '+slot);
    if(!id||id==='none'){
      this.unequip(slot);
      return this;
    }
    const catalog=slot==='hair'?hair.styles:clothing.items;
    const item=catalog.find(x=>x.id===id&&(slot==='hair'||x.slot===slot));
    if(!item)throw Error('Unknown '+slot+' item '+id);
    const {scene}=await loadGLTF(gearName(item.file,this.appearance.body));
    const copy=cloneSkinned(scene);
    copy.updateMatrixWorld(true);
    const skinned=[];copy.traverse(o=>{if(o.isSkinnedMesh)skinned.push(o)});
    if(skinned.length!==1)throw Error(item.id+': needs precisely one skinned mesh');
    const mesh=skinned[0];
    const template=mesh.skeleton;
    const mapped=template.bones.map(b=>{
      const bone=this.bones.get(b.name);
      if(!bone)throw Error(item.id+' incompatible: '+b.name);
      return bone;
    });
    const skeleton=new THREE.Skeleton(mapped,template.boneInverses.map(m=>m.clone()));
    const pose=mesh.matrixWorld.clone();
    mesh.removeFromParent();
    mesh.matrix.copy(pose);mesh.matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);
    this.model.add(mesh);
    mesh.bind(skeleton,mesh.bindMatrix.clone());
    mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;
    mesh.name='Equip.'+slot+'.'+id;
    mesh.material=mesh.material.clone();
    // Garments are thin shells; their inside must remain visible when viewed
    // through collars, open sleeves, or from beneath the shirt/coat.
    if(slot!=='hair'){
      for(const material of (Array.isArray(mesh.material)?mesh.material:[mesh.material])){
        material.side=THREE.DoubleSide;
        material.needsUpdate=true;
      }
    }
    mesh.userData.assetId=id;
    this.unequip(slot,{refresh:false});
    this.parts.set(slot,mesh);
    mesh.userData.catalogId=id;
    if(slot==='hair')this.setHairColor(this.appearance.hairColor);
    else await this.setClothingVariant(slot,this.appearance.clothingVariants?.[slot]||'default');
    this.appearance[slot]=id;
    this.refreshOutfitVisibility();
    if(!this._maskBatch&&!this.maskEditor)await applyBodyMaskFromOutfit(this);
    return this;
  }
  unequip(slot,{refresh=true}={}){
    const previous=this.parts.get(slot);
    if(previous){
      previous.removeFromParent();previous.skeleton.dispose();this.parts.delete(slot);
    }
    this.appearance[slot]=null;
    this.refreshOutfitVisibility();
    if(refresh&&!this._maskBatch&&!this.maskEditor)void applyBodyMaskFromOutfit(this)
      .catch(error=>console.error('[Humanoid] Skin mask reload failed',error));
    return this;
  }
  // No garment visibility shortcuts: the PNG body masks only control skin.
  refreshOutfitVisibility(){
    for(const [slot,mesh] of this.parts)if(slot!=='hair')mesh.visible=true;
    return this;
  }
  attach(slot,object,{position,rotation,scale}={}){
    const socket=this.sockets.get(slot);
    if(!socket)throw Error('Unknown attachment socket: '+slot);
    if(position)socket.position.fromArray(position);
    if(rotation)socket.rotation.set(...rotation);
    if(scale)socket.scale.fromArray(scale);
    socket.add(object);
    return object;
  }
  play(name,{loop=true,fade=.15,speed=1}={}){
    const clip=this.clips.find(c=>c.name===name);
    if(!clip)throw Error('Unknown humanoid clip: '+name);
    const next=this.mixer.clipAction(clip);
    if(next===this.action)return this;
    next.reset().setEffectiveTimeScale(speed);
    next.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);
    next.clampWhenFinished=!loop;
    next.play();
    if(this.action)next.crossFadeFrom(this.action,fade,true);
    this.action=next;return this;
  }
  update(dt){
    this.mixer.update(Math.min(.10,Math.max(0,dt)));
  }
  stats(){
    let triangles=0,drawables=0;
    this.root.traverse(o=>{
      if(!o.isSkinnedMesh)return;
      drawables++;
      const geo=o.geometry;
      triangles+=(geo.index?.count||geo.attributes.position.count)/3;
    });
    return {
      triangles:Math.round(triangles),bones:this.bones.size,
      skinnedMeshes:drawables,
      morphs:this.body.morphTargetInfluences?.length||0,
      facePresets:FACE_PRESETS,
      gear:[...this.parts.keys()],
      animationClips:this.clips.length
    };
  }
}
export async function createLiteHumanoid(options={}){
 const appearance={...DEFAULT_APPEARANCE,...options};
 if(!BODIES.includes(appearance.body))throw Error('Unknown body: '+appearance.body);
 if(!FACE_PRESETS.includes(appearance.face))throw Error('Unknown face preset: '+appearance.face);
 const [glb,catalog]=await Promise.all([
   loadGLTF('game/body_'+appearance.body+'.glb?v=fc-walk-rootmotion-20261104'),getHumanoidCatalog()
 ]);
 const model=cloneSkinned(glb.scene);
 const actor=new LiteHumanoid(model,glb.animations,appearance,catalog);
 actor._maskBatch=true;
 try{
   for(const slot of ['underwear','bra','top','bottom','shoes','outerwear','hair']){
     if(appearance[slot])await actor.equip(slot,appearance[slot]);
   }
 }finally{
   actor._maskBatch=false;
 }
 if(!actor.maskEditor)await applyBodyMaskFromOutfit(actor);
 actor.play('idle',{fade:0});
 return actor;
}
