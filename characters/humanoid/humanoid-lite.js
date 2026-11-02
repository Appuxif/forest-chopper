/**
 * Forest Chopper: simple, game-oriented modular humanoid.
 * One 53-bone skinned armature per character, two fixed bodies, CC0 outfit library.
 * No morph targets at runtime. Blender-build assets stored in ./lite/*.glb.
 */
import * as THREE from 'https://esm.sh/three@0.170.0';
import {GLTFLoader} from 'https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'https://esm.sh/three@0.170.0/examples/jsm/utils/SkeletonUtils.js';
import {makeBodySkinZones,insetBodyPositions} from './body-zones.js';
import {applyClothingLayerMask,clearClothingLayerMask,CLOTHING_LAYER_RANK} from './clothing-layer-mask.js';

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
const gearName=(file,gender)=>'lite/'+file.replace(/\.glb$/,'')+'_'+gender+'.glb'+(file==='clothing_shirt.glb'||file==='clothing_tshirt.glb'?'?sealed=1':'');

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
    // Every avatar gets its own body geometry: garments may inset skin without
    // changing other players' bodies or the cached GLB templates.
    this.body.geometry=this.body.geometry.clone();
    this._bodySkinZones=makeBodySkinZones(this.body);
    this.mixer=new THREE.AnimationMixer(this.root);
    this.clips=clips;
    this.action=null;
    // The stock unisex idle clip was authored on a wider male silhouette.
    // On the narrower female body, it brings hands through the hips. Apply a
    // small, rig-space shoulder abduction *after* the mixer without morphs.
    this._femaleArmOutset=0;
    this._armAxis=new THREE.Vector3(0,0,1);
    this._armWorldAxis=new THREE.Vector3();
    this._armQuat=new THREE.Quaternion();
    this._armParentQuat=new THREE.Quaternion();
    this._armLocalQuat=new THREE.Quaternion();
    this._rootWorldQuat=new THREE.Quaternion();
    this._unadjustedArmRotations=new Map();
    this.parts=new Map();this.sockets=new Map();
    // Not reliable for open jackets: the projection cuts visible undershirts.
    // Only enable this legacy experiment when the caller explicitly opts in.
    this.layerMaskEnabled=appearance.layerMaskEnabled===true;
    this.layerMaskPadding=appearance.layerMaskPadding??2;
    this.layerMaskStats={};
    this._layerMaskBatch=false;
    for(const [name,boneName] of Object.entries(SOCKET_BONES)){
      const parent=this.bones.get(boneName);
      if(!parent)throw Error('Missing socket bone: '+boneName);
      const socket=new THREE.Object3D();socket.name='Socket.'+name;
      parent.add(socket);this.sockets.set(name,socket);
    }
    this.setSkinColor(appearance.skin);
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
   * Existing body/garment masks and animations remain untouched.
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
    // The stock MakeHuman shirts flare away from the abdomen; a restrained
    // torso-only fit (~1 cm) makes them less hollow while keeping free arms.
    // Clone the geometry before editing: other players share the source GLB.
    if(slot==='top'&&(id==='shirt'||id==='tshirt')){
      const geo=mesh.geometry=mesh.geometry.clone();
      const position=geo.getAttribute('position');
      const smooth=(a,b,x)=>{
        const t=Math.min(1,Math.max(0,(x-a)/(b-a)));
        return t*t*(3-2*t);
      };
      for(let i=0;i<position.count;i++){
        const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
        const center=1-smooth(.23,.32,Math.abs(x));
        const shoulderFade=1-smooth(1.30,1.40,y);
        const fit=.055*center*shoulderFade;
        position.setXYZ(i,x*(1-fit),y,z*(1-fit));
      }
      position.needsUpdate=true;
      geo.computeVertexNormals();
    }
    mesh.material=mesh.material.clone();
    // Garments are thin shells; their inside must remain visible when viewed
    // through collars, open sleeves, or from beneath the shirt/coat.
    if(slot!=='hair'){
      for(const material of (Array.isArray(mesh.material)?mesh.material:[mesh.material])){
        material.side=THREE.DoubleSide;
        // Low-key textured bounce light: otherwise the inward-facing collar,
        // wrist and hem linings appear as a featureless black hole when seen
        // from below, even though there is real skinned fabric geometry.
        if(slot==='top'&&(id==='shirt'||id==='tshirt')&&material.map){
          material.emissive.set(0xffffff);
          material.emissiveMap=material.map;
          material.emissiveIntensity=.14;
        }
        material.needsUpdate=true;
      }
    }
    mesh.userData.assetId=id;
    this.unequip(slot,{refresh:false});
    this.parts.set(slot,mesh);
    mesh.userData.catalogId=id;
    this.updateBodyVisibility();
    if(slot==='hair')this.setHairColor(this.appearance.hairColor);
    else await this.setClothingVariant(slot,this.appearance.clothingVariants?.[slot]||'default');
    this.appearance[slot]=id;
    this.refreshOutfitVisibility();
    if(!this._layerMaskBatch&&slot!=='hair')this.refreshClothingLayers();
    return this;
  }
  unequip(slot,{refresh=true}={}){
    const previous=this.parts.get(slot);
    if(previous){
      clearClothingLayerMask(previous);
      previous.removeFromParent();previous.skeleton.dispose();this.parts.delete(slot);
    }
    this.appearance[slot]=null;
    this.updateBodyVisibility();
    this.refreshOutfitVisibility();
    if(refresh&&!this._layerMaskBatch&&slot!=='hair')this.refreshClothingLayers();
    return this;
  }
  // Hoodie replaces the visible top layer but does not unequip it.
  // Taking hoodie off (or replacing it with a jacket) restores the top.
  refreshOutfitVisibility(){
    const hideTop=this.parts.get('outerwear')?.userData.assetId==='hoodie';
    for(const [slot,mesh] of this.parts){
      if(slot!=='hair')mesh.visible=!(slot==='top'&&hideTop);
    }
    return this;
  }
  setClothingLayerMaskEnabled(enabled){
    this.layerMaskEnabled=Boolean(enabled);
    this.refreshClothingLayers();
    return this;
  }
  setClothingLayerPadding(padding){
    this.layerMaskPadding=Math.min(6,Math.max(0,Number(padding)||0));
    this.refreshClothingLayers();
    return this;
  }
  refreshClothingLayers(){
    // No per-combination assets or hand-painted clothing-to-clothing masks:
    // the higher garment is projected onto each lower garment's UVs.
    for(const mesh of this.parts.values())clearClothingLayerMask(mesh);
    this.layerMaskStats={};
    if(!this.layerMaskEnabled)return this;
    const order=Object.entries(CLOTHING_LAYER_RANK)
      .filter(([slot])=>this.parts.has(slot));
    const canCover=(outer,inner)=>(
      outer==='outerwear'&&['top','underwear','bra'].includes(inner)||
      outer==='top'&&['underwear','bra'].includes(inner)||
      // Pants and footwear need separate leg-aware coverage. The current
      // cylindrical atlas groups both legs into 'torso', and projecting boots
      // onto trousers cuts long, incorrect holes around the ankles.
      outer==='bottom'&&['underwear'].includes(inner)
    );
    for(const [slot] of order){
      const mesh=this.parts.get(slot);
      const outerMeshes=order.filter(([o])=>canCover(o,slot))
        .map(([o])=>this.parts.get(o)).filter(Boolean);
      if(!outerMeshes.length)continue;
      const result=applyClothingLayerMask(mesh,outerMeshes,
        {padding:this.layerMaskPadding});
      if(result)this.layerMaskStats[slot]=result;
    }
    return this;
  }
  updateBodyVisibility(){
    const equipped=[...this.parts.values()]
      .map(p=>this.catalog.clothing.items.find(i=>i.id===p.userData.catalogId))
      .filter(Boolean);
    const coordinates=insetBodyPositions(this._bodySkinZones,equipped);
    const geometry=this.body.geometry;
    const position=geometry.getAttribute('position');
    position.array.set(coordinates);
    position.needsUpdate=true;
    if(equipped.some(item=>item.hidesBodyZones?.length)){
      geometry.computeVertexNormals();
    }else{
      const normal=geometry.getAttribute('normal');
      normal.array.set(this._bodySkinZones.normals);
      normal.needsUpdate=true;
    }
    // Full index buffer stays in place: collar, wrists, hems and underside
    // always have a continuous skin surface. No holes, no additional meshes.
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
    const delta=Math.min(.10,Math.max(0,dt));
    // Undo last frame's procedural adjustment before the mixer evaluates.
    // In particular, paused clips must never accumulate shoulder rotation.
    for(const [name,rotation] of this._unadjustedArmRotations){
      this.bones.get(name).quaternion.copy(rotation);
    }
    this.mixer.update(delta);
    if(this.appearance.body!=='female')return;

    // Keep the arms relaxed but visibly clear of the narrower torso.
    // Gentle correction for locomotion; none for dramatic fall/jump poses.
    const name=this.motionName??this.action?.getClip()?.name??'idle';
    const target=name.startsWith('idle')?0.17
      : name==='walk'||name==='walk_back'||name.startsWith('strafe_')?0.12
      : name==='run'?0.085 : 0;
    this._femaleArmOutset+=(target-this._femaleArmOutset)*(1-Math.exp(-12*delta));
    if(this._femaleArmOutset<0.0001)return;

    // A body-relative forward axis ensures this works when players turn.
    this.root.getWorldQuaternion(this._rootWorldQuat);
    this._armWorldAxis.copy(this._armAxis).applyQuaternion(this._rootWorldQuat);
    for(const [boneName,sign] of [['upperarm_l',1],['upperarm_r',-1]]){
      const bone=this.bones.get(boneName);
      if(!this._unadjustedArmRotations.has(boneName)){
        this._unadjustedArmRotations.set(boneName,new THREE.Quaternion());
      }
      this._unadjustedArmRotations.get(boneName).copy(bone.quaternion);
      bone.parent.getWorldQuaternion(this._armParentQuat);
      this._armQuat.setFromAxisAngle(this._armWorldAxis,sign*this._femaleArmOutset);
      this._armLocalQuat.copy(this._armParentQuat).invert()
        .multiply(this._armQuat).multiply(this._armParentQuat);
      bone.quaternion.premultiply(this._armLocalQuat);
    }
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
      morphs:0,
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
   loadGLTF(appearance.game?'game/body_'+appearance.body+'.glb?v=fc-unified-1':'lite/body_'+appearance.body+(appearance.face==='default'?'':'_'+appearance.face)+'.glb'),getHumanoidCatalog()
 ]);
 const model=cloneSkinned(glb.scene);
 const actor=new LiteHumanoid(model,glb.animations,appearance,catalog);
 actor._layerMaskBatch=true;
 try{
   for(const slot of ['underwear','bra','top','bottom','shoes','outerwear','hair']){
     if(appearance[slot])await actor.equip(slot,appearance[slot]);
   }
 }finally{
   actor._layerMaskBatch=false;
   actor.refreshClothingLayers();
 }
 actor.play('idle',{fade:0});
 return actor;
}
