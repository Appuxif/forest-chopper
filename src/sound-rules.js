// Keep the voice sets inspectable and consistent with VOICE_CUTS.json.
// Female files retain their original source numbering for easier review.
export const VOICE_VARIANTS=Object.freeze({
 hurtMale:Object.freeze(Array.from({length:7},(_,i)=>`hurt_male_${i+1}`)),
 hurtFemale:Object.freeze([3,4,5,20].map(i=>`hurt_female_${i}`)),
 jumpFemale:Object.freeze([24,25,26,27,28].map(i=>`jump_female_${i}`)),
 jumpMale:Object.freeze(['jump_male_1','jump_male_2']),
 deathMale:Object.freeze(['death_male_1']),
 deathFemale:Object.freeze(['death_female_1']),
});
export const VOICE_CATEGORIES=Object.freeze(
 Object.fromEntries(Object.entries(VOICE_VARIANTS).flatMap(([key,sounds])=>sounds.map(name=>[name,key]))));
export function chooseVoiceClip(gender,kind,random=Math.random){
 const key=(['death','jump'].includes(kind)?kind:'hurt')+(gender==='female'?'Female':'Male');
 const set=VOICE_VARIANTS[key];
 if(!set?.length)return null;
 const unit=Math.min(Math.max(Number.isFinite(random)?random:0,0),1-Number.EPSILON);
 return set[Math.floor(unit*set.length)];
}
export const AXE_VARIANTS=Object.freeze(Array.from({length:7},(_,i)=>`axe_chop_${i+1}`));
export const MOB_VOICE_PROFILES=Object.freeze({
 chicken:Object.freeze({alarm:'hen_alarm',death:'hen_death',deathControl:'henDeath',alarmControl:'henAlarm',cluckControl:'henClucks',clucks:Object.freeze(Array.from({length:5},(_,i)=>`hen_cluck_${i+1}`)),
  radius:14,alarmPause:.65,panicGap:Object.freeze([.25,.55]),idleGap:Object.freeze([12,28]),burstGap:Object.freeze([.25,.45]),burstCount:Object.freeze([2,4])}),
});
export const MOB_SOUND_RULES=Object.freeze(Object.fromEntries(Object.values(MOB_VOICE_PROFILES).flatMap(profile=>[
 [profile.alarm,Object.freeze({category:profile.alarmControl,radius:profile.radius,gain:.9})],
 [profile.death,Object.freeze({category:profile.deathControl,radius:profile.radius,gain:.9})],
 ...profile.clucks.map(id=>[id,Object.freeze({category:profile.cluckControl,radius:profile.radius,gain:.7})]),
])));
export const MOB_SOUND_CATEGORIES=Object.freeze(Object.fromEntries(Object.entries(MOB_SOUND_RULES).map(([id,rule])=>[id,rule.category])));
// Sound registry shared by the mixer and the Settings / Sound tab.
// A new sound category is registered only here; it automatically gets a slider.
export const AUDIO_FILES=Object.freeze({
 step_leaves_1:'footsteps/step_leaves_1.mp3',step_leaves_2:'footsteps/step_leaves_2.mp3',
 step_wood_1:'footsteps/step_wood_1.mp3',step_wood_2:'footsteps/step_wood_2.mp3',
 step_stone:'footsteps/step_stone.mp3',step_mud:'footsteps/step_mud.mp3',step_water:'footsteps/step_water.mp3',
 ...Object.fromEntries(AXE_VARIANTS.map(id=>[id,`chopping/${id}.mp3`])),
 tree_fall:'chopping/tree_fall.mp3',flesh_hit:'combat/flesh_hit.wav',tree_creak:'ambience/tree_creak.mp3',
 fire:'ambience/fire.mp3',water:'ambience/water.mp3',forest:'ambience/forest_base.mp3',birds:'ambience/forest_day.mp3',
 crickets:'ambience/forest_night.mp3',pickup:'inventory/pickup.mp3',drop:'inventory/drop.mp3',chat_blip:'ui/chat_blip.mp3',
 hen_alarm:'voices/hen/01_long_cluck_scream.wav',hen_death:'voices/hen/07_hen_death.wav',
 ...Object.fromEntries(MOB_VOICE_PROFILES.chicken.clucks.map((id,i)=>[id,`voices/hen/${String(i+2).padStart(2,'0')}_short_cluck_${String(i+1).padStart(2,'0')}.wav`])),
 ...Object.fromEntries(Object.values(VOICE_VARIANTS).flatMap(sounds=>sounds.map(id=>[id,`voices/${id.includes('female')?'female':'male'}/${id.startsWith('hurt_')?'hurt':id.startsWith('jump_')?'jump':'death'}/${id}.mp3`]))),
});
export const SOUND_CONTROLS=Object.freeze([
 {key:'master',label:'Общая громкость',group:'main',default:65},
 {key:'footsteps',label:'Шаги по земле и листве',group:'effects',default:58},
 {key:'footstepsWood',label:'Шаги по дереву',group:'effects',default:55},
 {key:'footstepsStone',label:'Шаги по камням',group:'effects',default:50},
 {key:'footstepsMud',label:'Шаги по сырой земле',group:'effects',default:48},
 {key:'footstepsWater',label:'Шаги по воде',group:'effects',default:50},
 {key:'axe',label:'Удары топора',group:'effects',default:77},
 {key:'treeFall',label:'Падение дерева',group:'effects',default:72},
 {key:'fleshHit',label:'Удары по существам',group:'effects',default:77},
 {key:'pickup',label:'Подбор предметов',group:'effects',default:30},
 {key:'drop',label:'Выбрасывание предметов',group:'effects',default:30},
 {key:'chat',label:'Сообщения чата',group:'effects',default:28},
 {key:'jumpMale',label:'Прыжок — мужской голос',group:'effects',default:58},
 {key:'jumpFemale',label:'Прыжок — женский голос',group:'effects',default:58},
 {key:'hurtMale',label:'Урон — мужской голос',group:'effects',default:78},
 {key:'hurtFemale',label:'Урон — женский голос',group:'effects',default:78},
 {key:'deathMale',label:'Смерть — мужской голос',group:'effects',default:76},
 {key:'deathFemale',label:'Смерть — женский голос',group:'effects',default:76},
 {key:'henAlarm',label:'Курица — крик тревоги',group:'effects',default:100},
 {key:'henDeath',label:'Курица — попадание топором',group:'effects',default:100},
 {key:'henClucks',label:'Курица — кудахтанье',group:'effects',default:100},
 {key:'fire',label:'Треск костра и факелов',group:'ambience',default:40},
 {key:'water',label:'Тихая вода у озера',group:'ambience',default:40},
 {key:'forest',label:'Шорох леса и ветер',group:'ambience',default:40},
 {key:'treeCreak',label:'Скрип деревьев на ветру',group:'ambience',default:22},
 {key:'birds',label:'Дневные птицы',group:'ambience',default:46},
 {key:'crickets',label:'Ночные сверчки',group:'ambience',default:42},
]);
const CONTROL_SET=new Set(SOUND_CONTROLS.map(s=>s.key));
export const DEFAULT_AUDIO=Object.freeze(Object.fromEntries(SOUND_CONTROLS.map(s=>[s.key,s.default])));
export function sanitizeAudioSettings(source){
 return Object.fromEntries(SOUND_CONTROLS.map(({key,default:value})=>{
  const candidate=source?.[key];
  return [key,Number.isFinite(candidate)&&candidate>=0&&candidate<=100?Math.round(candidate):value];
 }));
}
export function audioSetting(audio,key){return CONTROL_SET.has(key)?(audio?.[key]??DEFAULT_AUDIO[key])/100:0;}
export const clamp01=n=>Math.max(0,Math.min(1,Number.isFinite(n)?n:0));
export const smoothstep=(a,b,x)=>{const t=clamp01((x-a)/(b-a));return t*t*(3-2*t);};
export function nightBlend(phase,enabled=true){
 if(!enabled)return 0;
 const p=((phase%1)+1)%1;
 return smoothstep(.26,.43,p)*(1-smoothstep(.59,.76,p));
}
export function distanceGain(distance,radius=12){
 if(!Number.isFinite(distance)||distance<0)return 0;
 return (1-smoothstep(radius*.12,radius,distance))**2;
}
export function nearestLitFire(items,x,z){
 let nearest=null,distance=Infinity;
 for(const item of items?.values?.()??[]){
  if(!item.lit||!['campfire','torch'].includes(item.kind))continue;
  const d=Math.hypot(x-item.x,z-item.z);
  if(d<distance){distance=d;nearest=item;}
 }
 return nearest?{item:nearest,distance}:null;
}
export function waterProximity(terrain,x,z){
 if(typeof terrain?.waterDepthAt!=='function')return 0;
 let strength=0;
 for(const [dx,dz] of [[0,0],[3,0],[-3,0],[0,3],[0,-3],[6,0],[-6,0],[0,6],[0,-6]]){
  if(terrain.waterDepthAt(x+dx,z+dz)>.06)
   strength=Math.max(strength,1-Math.hypot(dx,dz)/10);
 }
 return strength;
}
export function stepSurface(ctx){
 const x=ctx.px,z=ctx.pz,y=ctx.feetY;
 if((ctx.terrain?.waterDepthAt?.(x,z)??0)>.12)return 'water';
 const shapes=ctx.collisionWorld?.collect?.(x,z,1.2)??[];
 for(const s of shapes){
  if(!['log','structure','rock'].includes(s.kind))continue;
  const top=s.shape==='capsule'?(s.axis==='y'?s.y+s.halfLength+s.radius:s.y+s.radius)
    :s.y+(s.local?.y??0)+(s.hy??0);
  if(Math.abs(top-y)>.19)continue;
  if(s.kind==='rock'){
   if(Math.hypot(x-s.x,z-s.z)<s.radius+.14)return 'stone';
  }else if(Math.hypot(x-s.x,z-s.z)<(s.kind==='log'?1.6:2.3))return 'wood';
 }
 if(waterProximity(ctx.terrain,x,z)>.50)return 'mud';
 return 'leaves';
}
export function stepClip(surface,index){
 if(surface==='water')return 'step_water';
 if(surface==='stone')return 'step_stone';
 if(surface==='mud')return 'step_mud';
 const type=surface==='wood'?'wood':'leaves';
 return `step_${type}_${index%2+1}`;
}
export function stepVolumeKey(surface){
 return surface==='wood'?'footstepsWood':surface==='stone'?'footstepsStone':
  surface==='water'?'footstepsWater':surface==='mud'?'footstepsMud':'footsteps';
}
