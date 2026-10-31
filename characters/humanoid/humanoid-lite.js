/**
 * Forest Chopper: simple, game-oriented modular humanoid.
 * One 53-bone skinned armature per character, two fixed bodies, CC0 outfit library.
 * No morph targets at runtime. Blender-build assets stored in ./lite/*.glb.
 */
import * as THREE from 'https://esm.sh/three@0.170.0';
import {GLTFLoader} from 'https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'https://esm.sh/three@0.170.0/examples/jsm/utils/SkeletonUtils.js';
import {makeBodySkinZones,visibleBodyIndices} from './body-zones.js';

const BASE=new URL('./',import.meta.url);
const loader=new GLTFLoader();
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
 const [clothing,hair]=await Promise.all([loadJSON('source/clothing.json'),loadJSON('source/hair.json')]);
 return {clothing,hair};
}
const gearName=(file,gender)=>'lite/'+file.replace(/\.glb$/,'')+'_'+gender+'.glb';

export class LiteHumanoid {
  constructor(scene,clips,appearance,catalog){
    this.root=new THREE.Group();this.root.name='Humanoid.'+appearance.body;
    this.model=scene;this.root.add(scene);
    this.appearance={...appearance};
    this.catalog=catalog;
    this.bones=new Map();this.meshes=[];
    scene.traverse(o=>{
      if(o.isBone)this.bones.set(o.name,o);
      if(o.isSkinnedMesh){this.meshes.push(o);o.castShadow=true;o.frustumCulled=false;}
    });
    if(this.bones.size!==53)throw Error('Expected exactly 53 humanoid joints');
    this.body=this.meshes.find(o=>o.name==='Body')||this.meshes[0];
    this.skeleton=this.body.skeleton;
    // Clone indexed geometry per avatar: hiding skin must not modify cached GLBs
    // or other multiplayer characters with a different wardrobe.
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
    mesh.userData.assetId=id;
    this.unequip(slot);
    this.parts.set(slot,mesh);
    mesh.userData.catalogId=id;
    this.updateBodyVisibility();
    if(slot==='hair')this.setHairColor(this.appearance.hairColor);
    this.appearance[slot]=id;
    return this;
  }
  unequip(slot){
    const previous=this.parts.get(slot);
    if(previous){previous.removeFromParent();previous.skeleton.dispose();this.parts.delete(slot);}
    this.appearance[slot]=null;
    this.updateBodyVisibility();
    return this;
  }
  updateBodyVisibility(){
    const equipped=[...this.parts.values()]
      .map(p=>this.catalog.clothing.items.find(i=>i.id===p.userData.catalogId))
      .filter(Boolean);
    const indices=visibleBodyIndices(this._bodySkinZones,equipped);
    // Body geometry is actor-owned: index updates cannot affect other actors.
    this.body.geometry.setIndex(new THREE.BufferAttribute(indices,1));
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
    const name=this.action?.getClip()?.name||'idle';
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
   loadGLTF('lite/body_'+appearance.body+(appearance.face==='default'?'':'_'+appearance.face)+'.glb'),getHumanoidCatalog()
 ]);
 const model=cloneSkinned(glb.scene);
 const actor=new LiteHumanoid(model,glb.animations,appearance,catalog);
 for(const slot of ['underwear','bra','top','bottom','shoes','outerwear','hair']){
   if(appearance[slot])await actor.equip(slot,appearance[slot]);
 }
 actor.play('idle',{fade:0});
 return actor;
}
