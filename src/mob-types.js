// Species data is separate from simulation, presentation, AI and physics.
// Server equivalents live in mob_definitions.py; parity is covered by tests.
export const CHICKEN_TYPE={
 id:'chicken',name:'Курица',category:'chicken',faction:'wildlife',voiceProfile:'chicken',
 subcategories:Object.fromEntries(['russet','white','black','golden','speckled'].map(id=>[id,{id,name:({russet:'Рыжая',white:'Белая',black:'Чёрная',golden:'Золотистая',speckled:'Пёстрая'})[id],texture:`./assets/models/hen/textures/hen_plumage_${id}.png`}])),
 stats:{maxHealth:1,damage:0,speeds:{walk:.34,fast:1.17,run:3.6}},
 behavior:{flock:{radius:6,catchUpRadius:12,separation:1,cohesion:.7},id:'wary',noticeRadius:6,safeRadius:10,calmSeconds:3,actionSeconds:[3,8]},
 physics:{radius:.16,height:.65,maxWaterDepth:.15,stepHeight:.08},
 model:{url:'./assets/models/hen.glb',scale:.4,ragdoll:'chicken',variantMaterial:'Hen Plumage'},
 animations:{idle:'Idle',walk:'Walk',fast:'Walk_Fast',run:'Run',rest:'Sit',forage:['Peck_1','Peck_2','Peck'],durations:{Peck_1:38/24,Peck_2:52/24,Peck:3},
  peaceful:[{clip:'Sit',weight:.25},{clip:'Walk',weight:.30},{clip:'Walk_Fast',weight:.15},{clip:'Peck_1',weight:.12},{clip:'Peck_2',weight:.09},{clip:'Peck',weight:.06},{clip:'Idle',weight:.03}]},
 spawn:{idPrefix:'hen',cellSize:96,chance:.25,groupMin:1,groupMax:3,starterCount:3,activeRadius:120,liveLimit:24,corpseLimit:32,respawnSeconds:2880,corpseTTLSeconds:3600},
 loot:{chicken_meat:{min:1,max:3},feather:{min:1,max:5}},
};
export function validateMobType(d){
 const positive=n=>Number.isFinite(n)&&n>0,nonnegative=n=>Number.isFinite(n)&&n>=0;
 if(!d||!/^[-a-z0-9_]+$/.test(d.id??'')||typeof d.name!=='string'||!d.name||typeof d.faction!=='string'||typeof d.category!=='string'||!d.category)return false;
 if(d.voiceProfile!==undefined&&(typeof d.voiceProfile!=='string'||!d.voiceProfile))return false;
 if(!positive(d.stats?.maxHealth)||!nonnegative(d.stats?.damage)||!['walk','fast','run'].every(k=>nonnegative(d.stats?.speeds?.[k])))return false;
 if(typeof d.behavior?.id!=='string'||!positive(d.behavior.noticeRadius)||!positive(d.behavior.safeRadius)||d.behavior.safeRadius<d.behavior.noticeRadius||!nonnegative(d.behavior.calmSeconds))return false;
 if(!Array.isArray(d.behavior.actionSeconds)||d.behavior.actionSeconds.length!==2||!d.behavior.actionSeconds.every(positive)||d.behavior.actionSeconds[1]<d.behavior.actionSeconds[0])return false;
 const f=d.behavior.flock;if(f&&(!positive(f.radius)||!positive(f.catchUpRadius)||f.catchUpRadius<=f.radius||!positive(f.separation)||!nonnegative(f.cohesion)||f.cohesion>1))return false;
 const s=d.spawn;if(!s||!/^[-a-z0-9_]+$/.test(s.idPrefix??'')||!['cellSize','activeRadius','liveLimit','corpseLimit','respawnSeconds','corpseTTLSeconds'].every(k=>positive(s[k]))||!nonnegative(s.chance)||s.chance>1)return false;
 if(!['groupMin','groupMax','starterCount','liveLimit','corpseLimit'].every(k=>Number.isSafeInteger(s[k])&&s[k]>=0)||s.groupMin<1||s.groupMax<s.groupMin||s.starterCount>s.groupMax)return false;
 if(!d.loot||typeof d.loot!=='object'||Array.isArray(d.loot)||!Object.entries(d.loot).every(([id,r])=>id&&r&&Number.isSafeInteger(r.min)&&Number.isSafeInteger(r.max)&&r.min>=0&&r.max>=r.min))return false;
 if(typeof d.model?.url!=='string'||!d.model.url||!positive(d.model.scale))return false;
 if(d.physics&&(!positive(d.physics.radius)||!positive(d.physics.height)||!nonnegative(d.physics.maxWaterDepth)||!nonnegative(d.physics.stepHeight)))return false;
 const a=d.animations;if(!a||!['idle','walk','fast','run','rest'].every(k=>typeof a[k]==='string')||!Array.isArray(a.forage)||!a.forage.every(n=>typeof n==='string')||!Array.isArray(a.peaceful)||!a.peaceful.length||!a.peaceful.every(p=>typeof p.clip==='string'&&positive(p.weight)))return false;
 if(!a.durations||!a.forage.every(clip=>positive(a.durations[clip])))return false;
 const clips=new Set([a.idle,a.walk,a.fast,a.run,a.rest,...a.forage]);if(!a.peaceful.every(p=>clips.has(p.clip)))return false;
 return !!d.subcategories&&Object.keys(d.subcategories).length>0&&Object.entries(d.subcategories).every(([id,v])=>v&&v.id===id&&typeof v.id==='string');
}
export const ENABLED_MOB_TYPES=Object.freeze([CHICKEN_TYPE]);
export function createMobTypeRegistry(types=ENABLED_MOB_TYPES){
 const entries=new Map(),prefixes=new Set();
 function register(type){
  if(!validateMobType(type))throw new TypeError('Invalid mob type');
  if(entries.has(type.id)||prefixes.has(type.spawn.idPrefix))throw new Error('Duplicate mob type or ID prefix');
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  const copy=freeze(JSON.parse(JSON.stringify(type)));entries.set(copy.id,copy);prefixes.add(copy.spawn.idPrefix);return copy;
 }
 for(const type of types)register(type);
 return {register,get:id=>entries.get(id),list:()=>[...entries.values()]};
}
export function selectMobSubcategory(type,seed,id){
 const variants=Object.keys(type.subcategories);let hash=2166136261;
 for(const char of `${seed}:${id}:appearance`){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
 return variants[(hash>>>0)%variants.length];
}
