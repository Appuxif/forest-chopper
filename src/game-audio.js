// Browser WebAudio mixer. No CDN or procedural sound approximations: all
// samples ship locally. AudioContext is created only after user interaction.
import {AUDIO_FILES,AXE_VARIANTS,VOICE_CATEGORIES,VOICE_VARIANTS,MOB_VOICE_PROFILES,MOB_SOUND_CATEGORIES,MOB_SOUND_RULES,chooseVoiceClip,audioSetting,nightBlend,distanceGain,nearestLitFire,
 waterProximity,stepSurface,stepClip,stepVolumeKey} from './sound-rules.js?v=20261105-mob-hit-audio1';

export function createGameAudio(ctx,{
 doc=typeof document==='undefined'?null:document,
 win=typeof window==='undefined'?null:window,
 AudioContextClass=win?.AudioContext??win?.webkitAudioContext,
 fetchAudio=typeof fetch==='function'?fetch:null,
 random=Math.random,
}={}){
 let audio=null,master=null,ambience=null,effects=null,pending=null;
 let disposed=false,unlocked=false,stepDistance=0,lastPosition=null,stepNumber=0;
 let lastAmbient=-Infinity,nextTreeCreak=0;
 const buffers=new Map(),loops=new Map(),voices=new Set(),mobVoices=new Set();
 let audition=null;
 const assetUrl=name=>new URL('../assets/audio/'+AUDIO_FILES[name],import.meta.url).href;
 const config=()=>ctx.settings?.audio;
 function volume(name){return audioSetting(config(),name);}
 function connect(){
  audio=new AudioContextClass();
  master=audio.createGain();ambience=audio.createGain();effects=audio.createGain();
  ambience.connect(master);effects.connect(master);master.connect(audio.destination);
  ambience.gain.value=1;effects.gain.value=1;
  master.gain.value=volume('master');
 }
 function startLoop(name){
  if(!audio||loops.has(name)||!buffers.has(name))return;
  const source=audio.createBufferSource(),g=audio.createGain();
  source.buffer=buffers.get(name);source.loop=true;g.gain.value=0;
  source.connect(g);g.connect(ambience);source.start();
  loops.set(name,{source,g});
 }
 function load(){
  if(pending||!fetchAudio||!audio)return pending;
  pending=Promise.all(Object.keys(AUDIO_FILES).map(async name=>{
   try{
    const response=await fetchAudio(assetUrl(name));
    if(!response.ok)throw Error('HTTP '+response.status);
    const decoded=await audio.decodeAudioData(await response.arrayBuffer());
    if(!disposed)buffers.set(name,decoded);
   }catch(error){console.warn('Sound unavailable:',name,error);}
  })).then(()=>{
   if(!disposed)for(const name of ['fire','water','forest','birds','crickets'])startLoop(name);
  });
  return pending;
 }
 function unlock(){
  if(disposed||!AudioContextClass)return false;
  try{
   if(!audio)connect();
   if(audio.state!=='running')void audio.resume?.().catch(()=>{});
   unlocked=true;void load();
   return true;
  }catch(error){console.warn('WebAudio unavailable',error);return false;}
 }
 const resume=()=>unlock();
 doc?.addEventListener?.('pointerdown',resume,{capture:true,passive:true});
 doc?.addEventListener?.('keydown',resume,{capture:true});
 function play(name,category,gain=.7,{pitch=1,previewSeconds=0,mobVoice=false,pan=null}={}){
  if(!unlocked||disposed||!audio||!buffers.has(name)||volume('master')<=0||volume(category)<=0)return false;
  if(mobVoice&&mobVoices.size>=8)return false;
  const source=audio.createBufferSource(),g=audio.createGain();
  source.buffer=buffers.get(name);source.playbackRate.value=pitch;
  g.gain.value=gain*volume(category);
  let panner=null;source.connect(g);
  if(pan!==null&&typeof audio.createStereoPanner==='function'){panner=audio.createStereoPanner();panner.pan.value=Math.max(-1,Math.min(1,pan));g.connect(panner);panner.connect(effects);}
  else g.connect(effects);
  voices.add(source);
  if(mobVoice)mobVoices.add(source);
  source.onended=()=>{voices.delete(source);mobVoices.delete(source);if(audition===source)audition=null;source.disconnect();g.disconnect();panner?.disconnect();};
  source.start();
  // Audition buttons should never launch 30–45 second background recordings.
  if(previewSeconds>0){
   if(audition && audition!==source){try{audition.stop();}catch{}}
   audition=source;
   source.stop(audio.currentTime+Math.min(previewSeconds,source.buffer.duration??previewSeconds));
  }
  return true;
 }
 function effect(name,position){
  const mobRule=MOB_SOUND_RULES[name];
  if(mobRule){
   if(!Number.isFinite(position?.x)||!Number.isFinite(position?.z))return false;
   const dx=position.x-ctx.px,dz=position.z-ctx.pz,distance=Math.hypot(dx,dz),gain=distanceGain(distance,mobRule.radius);
   if(gain<=0)return false;
   const yaw=ctx.yaw??0,pan=(dx*Math.cos(yaw)-dz*Math.sin(yaw))/Math.max(1,distance);
   return play(name,mobRule.category,gain*mobRule.gain,{mobVoice:true,pan,pitch:1});
  }
  if(name==='axe'){
   const index=Math.min(AXE_VARIANTS.length-1,Math.floor(random()*AXE_VARIANTS.length));
   return play(AXE_VARIANTS[index],'axe',.83,{pitch:.97+random()*.06});
  }
  if(name==='treeFall')return play('tree_fall','treeFall',.85,{pitch:1});
  if(name==='fleshHit')return play('flesh_hit','fleshHit',.9,{pitch:1});
  if(name==='pickup')return play('pickup','pickup',.7,{pitch:1});
  if(name==='drop')return play('drop','drop',.7,{pitch:1});
  if(name==='chat')return play('chat_blip','chat',.5);
  return false;
 }
 function hurt(gender=ctx.avatarGender??ctx.characterGender??'male'){
  if(ctx.deathSystem?.active)return false;
  const clip=chooseVoiceClip(gender,'hurt',random());
  return clip?play(clip,gender==='female'?'hurtFemale':'hurtMale',.95,
    {pitch:.97+random()*.06}):false;
 }
 function jump(gender=ctx.avatarGender??ctx.characterGender??'male'){
  if(ctx.deathSystem?.active)return false;
  const clip=chooseVoiceClip(gender,'jump',random());
  return clip?play(clip,gender==='female'?'jumpFemale':'jumpMale',.75,
    {pitch:.97+random()*.06}):false;
 }
 function death(gender=ctx.avatarGender??ctx.characterGender??'male'){
  const clip=chooseVoiceClip(gender,'death',random());
  return clip?play(clip,gender==='female'?'deathFemale':'deathMale',.98):false;
 }
 function previewClip(id){
  const category=VOICE_CATEGORIES[id]??MOB_SOUND_CATEGORIES[id]??(AXE_VARIANTS.includes(id)?'axe':null);
  if(!category)return false;
  unlock();
  const playSample=()=>play(id,category,.75,{previewSeconds:8});
  if(buffers.has(id))return playSample();
  void pending?.then(playSample);
  return true;
 }
 function oneStep(sprinting){
  const surface=stepSurface(ctx),index=stepNumber++;
  return play(stepClip(surface,index),stepVolumeKey(surface),sprinting?.72:.48,
   {pitch:.92+random()*.18});
 }
 function setLoop(name,strength){
  const loop=loops.get(name);if(!loop||!audio)return;
  const category=name;
  loop.g.gain.setTargetAtTime(Math.max(0,strength)*volume(category),audio.currentTime,.35);
 }
 function tick(now){
  if(disposed)return;
  const position={x:ctx.px,z:ctx.pz};
  if(unlocked&&audio && lastPosition){
   const delta=Math.hypot(position.x-lastPosition.x,position.z-lastPosition.z);
   if(ctx.onGround&&!ctx.ragdoll?.active&&!ctx.deathSystem?.active&&delta<.6){
    stepDistance+=delta;
    const stride=ctx.sprinting?.78: .57;
    // At most two footsteps per tick on lag spikes.
    let steps=0;
    while(stepDistance>=stride&&steps++<2){stepDistance-=stride;oneStep(ctx.sprinting);}
   }else if(delta>.6||!ctx.onGround){stepDistance=0;}
  }
  lastPosition=position;
  if(!unlocked||!audio||!Number.isFinite(now)||now-lastAmbient<180)return;
  lastAmbient=now;
  master.gain.setTargetAtTime(volume('master'),audio.currentTime,.08);
  const night=nightBlend(ctx.dayCycle?.phaseAt?.(now)??0,
    ctx.dayCycle?.online||ctx.settings?.dayCycleEnabled===true);
  setLoop('forest',(1-night)*.45);
  setLoop('birds',(1-night)*.60);
  setLoop('crickets',night*.65);
  const fire=nearestLitFire(ctx.campStructures?.items,ctx.px,ctx.pz);
  setLoop('fire',fire?distanceGain(fire.distance,fire.item.kind==='torch'?9:17)*.72:0);
  setLoop('water',waterProximity(ctx.terrain,ctx.px,ctx.pz)*.65);
  if(ctx.settings?.windEnabled!==false && now>=nextTreeCreak){
   nextTreeCreak=now+21000+random()*30000;
   let closest=Infinity;
   for(const t of ctx.trees?.values?.()??[]){
    const dx=ctx.px-t.position.x,dz=ctx.pz-t.position.z;
    closest=Math.min(closest,Math.hypot(dx,dz));
    if(closest<4)break;
   }
   if(closest<17&&random()>.35)
    play('tree_creak','treeCreak',distanceGain(closest,22)*.48,{pitch:.9+random()*.18});
  }

 }
 function preview(category){
  unlock();
  const chosen=({footsteps:'step_leaves_1',footstepsWood:'step_wood_1',
   footstepsStone:'step_stone',footstepsMud:'step_mud',footstepsWater:'step_water',axe:'axe_chop_1',
   treeFall:'tree_fall',pickup:'pickup',drop:'drop',chat:'chat_blip',
   hurtMale:VOICE_VARIANTS.hurtMale[0],hurtFemale:VOICE_VARIANTS.hurtFemale[0],
   jumpMale:VOICE_VARIANTS.jumpMale[0],jumpFemale:VOICE_VARIANTS.jumpFemale[0],
   deathMale:VOICE_VARIANTS.deathMale[0],deathFemale:VOICE_VARIANTS.deathFemale[0],
   henDeath:MOB_VOICE_PROFILES.chicken.death,henAlarm:MOB_VOICE_PROFILES.chicken.alarm,henClucks:MOB_VOICE_PROFILES.chicken.clucks[0],
   fire:'fire',water:'water',forest:'forest',treeCreak:'tree_creak',birds:'birds',crickets:'crickets'})[category];
  if(chosen){
   const previewSeconds=category==='treeFall'?8:
     ['fire','water','forest','birds','crickets'].includes(category)?12:
     category==='treeCreak'?7:2.5;
   const playShort=()=>play(chosen,category,.6,{previewSeconds});
   if(buffers.has(chosen))playShort();else void pending?.then(playShort);
  }
 }
 function dispose(){
  if(disposed)return;disposed=true;
  doc?.removeEventListener?.('pointerdown',resume,{capture:true});
  doc?.removeEventListener?.('keydown',resume,{capture:true});
  for(const {source} of loops.values())source.stop();
  for(const source of voices)source.stop();
  loops.clear();voices.clear();mobVoices.clear();buffers.clear();
  void audio?.close?.();
 }
 return {unlock,tick,effect,hurt,jump,death,preview,previewClip,dispose,
  get unlocked(){return unlocked},get loaded(){return buffers.size},get activeLoops(){return loops.size}};
}
