/**
 * Forest Chopper Modular Humanoid
 *
 * Runtime code is original; source humanoid/garment/hair assets are CC0-1.0,
 * https://github.com/kblood/CharacterCreator/blob/master/LICENSE-NOTES.md
 *
 * A single 53-joint skeleton drives an anatomical SkinnedMesh, face meshes,
 * compatible 53-bone clothing, hair, weapon and equipment sockets.
 *
 * The body and interchangeable garments share 92 morph target names.
 * Large body-shape deviations need per-morph bind-joint corrections; an
 * experimental corrective API is reserved below (see README).
 */
import * as THREE from 'https://esm.sh/three@0.170.0';
import {GLTFLoader} from 'https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'https://esm.sh/three@0.170.0/examples/jsm/utils/SkeletonUtils.js';

const ASSET_URL = new URL('./source/', import.meta.url);
const SOURCE = {
  base: 'makehuman-morph-base.cc0.glb',
  animations: 'humanoid-base-animated.cc0.glb',
  hair: 'hair.json',
  clothing: 'clothing.json',
};
const loader = new GLTFLoader();
const modelCache = new Map();
const jsonCache = new Map();
const getGLTF = file => {
  if (!modelCache.has(file))
    modelCache.set(file,loader.loadAsync(new URL(file,ASSET_URL).href).catch(err=>{modelCache.delete(file);throw err}));
  return modelCache.get(file);
};
const getJSON = file => {
  if (!jsonCache.has(file)) jsonCache.set(file,fetch(new URL(file,ASSET_URL))
    .then(r=>{if(!r.ok)throw Error(file+' fetch failed: '+r.status);return r.json()}));
  return jsonCache.get(file);
};
const clamp = (v,a=0,b=1)=>Math.min(b,Math.max(a,Number(v)||0));

export const HUMANOID_SOCKETS=Object.freeze({
  head:'head', rightHand:'hand_r', leftHand:'hand_l',
  back:'spine_03', waist:'pelvis', chest:'spine_03',
});
export const MORPH_PRESETS=Object.freeze({
  male:{gender_male:.8},
  female:{gender_female:.8},
  athletic:{gender_male:.7,muscle_max:.38},
  slim:{gender_male:.65,weight_min:.38},
  heavy:{gender_male:.7,weight_max:.40},
});
export const RIG_CONTRACT = Object.freeze({
  version:1,format:'MakeHuman game_engine',bones:53,unit:'meter',
  orientation:'Y up, +Z forward',skinning:'skinned, max 4 influences',
  clothing:'same bind skeleton and shape key names',
  animation:'shared bone names',
});

export class ModularHumanoid {
  constructor(bodyScene, bodyMeshes, animations, catalog) {
    this.root = new THREE.Group();
    this.root.name = 'Humanoid | one skeleton, all equipment';
    this.model = bodyScene;
    this.root.add(bodyScene);
    this.bodyMeshes = bodyMeshes;
    this.body = bodyMeshes.find(m=>m.name==='Body') || bodyMeshes[0];
    this.bones = new Map();
    this.model.traverse(o=>{if(o.isBone)this.bones.set(o.name,o)});
    if(this.bones.size!==53)throw Error('53-bone base expected, got '+this.bones.size);
    this.skeleton=this.body.skeleton;
    this.clips=animations;
    this.mixer=new THREE.AnimationMixer(this.root);
    this.activeAction=null;
    this.parts=new Map();
    this.sockets=new Map();
    this.catalog=catalog;
    this.morphs={};
    this._bodyGeometry=this.body.geometry.clone();
    this.body.geometry=this._bodyGeometry; // per-character body hiding without touching shared cache
    this._allIndices=Array.from(this.body.geometry.index?.array || []);
    this._bodyZones=this.body.geometry.getAttribute('_cczone') || this.body.geometry.getAttribute('_CCZONE');
    for(const [name,bone] of Object.entries(HUMANOID_SOCKETS)) {
      const parent=this.bones.get(bone);
      if(!parent)throw Error('Missing socket bone: '+bone);
      const socket=new THREE.Object3D();
      socket.name='Socket.'+name;
      socket.userData.mountBone=bone;
      parent.add(socket);
      this.sockets.set(name,socket);
    }
    this.model.traverse(o=>{if(o.isSkinnedMesh){o.castShadow=true;o.frustumCulled=false;}});
  }
  async setMorphs(morphs) {
    this.morphs={...morphs};
    for(const mesh of [...this.bodyMeshes,...this.parts.values()]) {
      const dictionary=mesh.morphTargetDictionary || {};
      for(const [name,index] of Object.entries(dictionary)){
        if(mesh.morphTargetInfluences)mesh.morphTargetInfluences[index]=clamp(this.morphs[name]??0);
      }
    }
    // Shape-key vertex deltas work at any weight, but for very large macro
    // morph weights bones should be recentered using the sidecar morph joints.
    return this;
  }
  async setPreset(name) {
    if(!MORPH_PRESETS[name])throw Error('Unknown body preset: '+name);
    return this.setMorphs(MORPH_PRESETS[name]);
  }
  _updateBodyZones() {
    if(!this._bodyZones||!this._allIndices.length)return;
    let hidden=0;
    for(const [slot,part] of this.parts){
      const category=this.catalog.clothing.items.find(i=>i.id===part.userData.catalogId);
      if(category)for(const key of category.hidesBodyZones||[])
        hidden|=this.catalog.clothing.bodyZones[key]||0;
    }
    if(!hidden) {
      this.body.geometry.setIndex(this._allIndices);
      return;
    }
    const a=this._bodyZones;
    const selected=[];
    for(let i=0;i<this._allIndices.length;i+=3) {
      const ia=this._allIndices[i],ib=this._allIndices[i+1],ic=this._allIndices[i+2];
      const n=Number(Boolean((Math.round(a.getX(ia))&hidden)))+
             Number(Boolean((Math.round(a.getX(ib))&hidden)))+
             Number(Boolean((Math.round(a.getX(ic))&hidden)));
      if(n<2)selected.push(ia,ib,ic);
    }
    this.body.geometry.setIndex(selected);
  }
  async equip(slot,id,color) {
    if(!['hair',...this.catalog.clothing.slots].includes(slot))throw Error('Unknown skinned equipment slot: '+slot);
    if(id===null||id==='none'||id===''){
      this.unequip(slot);
      return this;
    }
    const catalog=slot==='hair'?this.catalog.hair.styles:this.catalog.clothing.items;
    const asset=catalog.find(x=>x.id===id && (slot==='hair'||x.slot===slot));
    if(!asset)throw Error('No equipment asset '+slot+':'+id);
    const gltf=await getGLTF(asset.file);
    const source=cloneSkinned(gltf.scene);
    source.updateMatrixWorld(true);
    const meshList=[];
    source.traverse(o=>{if(o.isSkinnedMesh)meshList.push(o)});
    if(meshList.length!==1)throw Error(asset.file+': expected one SkinnedMesh');
    const mesh=meshList[0];
    const templateSkin=mesh.skeleton;
    // IMPORTANT: rebind instead of keeping each item's private armature,
    // otherwise animations and equipment drift apart.
    const bones=templateSkin.bones.map(b=>{
      const mapped=this.bones.get(b.name);
      if(!mapped)throw Error(asset.file+': incompatible bone '+b.name);
      return mapped;
    });
    const mappedSkin=new THREE.Skeleton(bones,templateSkin.boneInverses.map(m=>m.clone()));
    const transform=mesh.matrixWorld.clone();
    mesh.removeFromParent();
    mesh.position.set(0,0,0);mesh.quaternion.identity();mesh.scale.set(1,1,1);
    this.model.add(mesh);
    mesh.matrix.copy(transform);
    mesh.matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);
    mesh.bind(mappedSkin,mesh.bindMatrix.clone());
    mesh.frustumCulled=false;
    mesh.castShadow=true;
    mesh.name='Equip.'+slot+'.'+id;
    mesh.userData.catalogId=id;
    mesh.userData.equipmentSlot=slot;
    if(color) {
      if(Array.isArray(mesh.material))mesh.material=mesh.material.map(m=>m.clone());
      else mesh.material=mesh.material.clone();
      const m=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
      if(m.color)m.color.set(color);
    }
    this.unequip(slot);
    this.parts.set(slot,mesh);
    await this.setMorphs(this.morphs);
    this._updateBodyZones();
    return this;
  }
  unequip(slot) {
    const old=this.parts.get(slot);
    if(old){old.removeFromParent();old.skeleton.dispose();this.parts.delete(slot);}
    this._updateBodyZones();
    return this;
  }
  attach(name,object,{position,rotation,scale}={}) {
    if(!this.sockets.has(name))throw Error('Unknown bone socket '+name);
    const slot=this.sockets.get(name);
    if(position)slot.position.fromArray(position);
    if(rotation)slot.rotation.set(...rotation);
    if(scale)slot.scale.fromArray(scale);
    slot.add(object);
    return object;
  }
  play(name,{loop=true,fade=.15,speed=1}={}) {
    const clip=this.clips.find(c=>c.name===name);
    if(!clip)throw Error('Unknown animation: '+name);
    const next=this.mixer.clipAction(clip);
    if(this.activeAction===next)return this;
    next.reset();
    next.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);
    next.clampWhenFinished=!loop;
    next.setEffectiveTimeScale(speed);
    if(this.activeAction) {
      next.play();
      next.crossFadeFrom(this.activeAction,fade,true);
    } else next.play();
    this.activeAction=next;
    return this;
  }
  update(deltaTime) {this.mixer.update(Math.max(0,Math.min(.1,deltaTime)));}
  getStats() {
    let triangles=0,skinnedMeshes=0;
    this.root.traverse(o=>{
      if(o.isSkinnedMesh){
        skinnedMeshes++;
        triangles+=(o.geometry.index?.count ?? o.geometry.attributes.position.count)/3;
      }
    });
    return {bones:this.bones.size,triangles:Math.round(triangles),skinnedMeshes,parts:[...this.parts.keys()],morphs:Object.keys(this.body.morphTargetDictionary||{}).length,animations:this.clips.length};
  }
}

export async function loadHumanoidCatalog() {
  const [clothing,hair]=await Promise.all([getJSON(SOURCE.clothing),getJSON(SOURCE.hair)]);
  return {clothing,hair};
}
export async function createHumanoid({
  preset='male',morphs={},
  hair='short02',top='shirt',bottom='jeans',shoes='shoes',outerwear=null
}={}) {
  const [base,anim,catalog]=await Promise.all([
    getGLTF(SOURCE.base),getGLTF(SOURCE.animations),loadHumanoidCatalog()
  ]);
  const scene=cloneSkinned(base.scene);
  const meshes=[];
  scene.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o)});
  if(!meshes.length)throw Error('No base SkinnedMesh');
  const actor=new ModularHumanoid(scene,meshes,anim.animations,catalog);
  await actor.setMorphs({...MORPH_PRESETS[preset],...morphs});
  for(const [slot,id] of Object.entries({top,bottom,shoes,hair,outerwear}))
    if(id)await actor.equip(slot,id);
  actor.play('idle', {fade:0});
  return actor;
}
