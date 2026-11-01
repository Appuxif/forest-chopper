// Same deterministic decor positions/species as src/world.js.
// Existing scene meshes are collectible; no duplicate models are created.
export const DECOR_CHUNK_SIZE=24;
export const DECOR_SLOTS=25;
export const MUSHROOM_IDS=['fly_agaric','boletus','death_cap','milkcap'];
export const FLOWER_IDS=['daisy','buttercup','pink_wildflower','blue_wildflower'];
export const DECOR_ITEM_IDS=[
  ...MUSHROOM_IDS.map(id=>'mushroom:'+id),
  ...FLOWER_IDS.map(id=>'flower:'+id),
  'dry_grass',
];
export const DECOR_ITEM_NAMES={
  'mushroom:fly_agaric':'Мухомор',
  'mushroom:boletus':'Боровик',
  'mushroom:death_cap':'Бледная поганка',
  'mushroom:milkcap':'Груздь',
  'flower:daisy':'Ромашка',
  'flower:buttercup':'Лютик',
  'flower:pink_wildflower':'Розовый полевой цветок',
  'flower:blue_wildflower':'Синий полевой цветок',
  dry_grass:'Сухая трава',
};
export const decorResourceId=(cx,cz,i)=>'d:'+cx+','+cz+':'+i;
export function decorRand(seed,cx,cz,channel){
  const v=Math.sin(cx*127.1+cz*311.7+channel*78.233+seed)*43758.5453;
  return v-Math.floor(v);
}
export function decorResource(seed,cx,cz,i){
  if(!Number.isInteger(cx)||!Number.isInteger(cz)||!Number.isInteger(i)
    ||i<0||i>=DECOR_SLOTS||Math.abs(cx)>10001||Math.abs(cz)>10001)return null;
  if(decorRand(seed,cx,cz,300+i)>.86)return null; // Existing rock, not collectible.
  let kind;
  if(decorRand(seed,cx,cz,800+i)>.94)
    kind='mushroom:'+MUSHROOM_IDS[Math.floor(decorRand(seed,cx,cz,1000+i)*4)];
  else if(decorRand(seed,cx,cz,900+i)>.79)
    kind='flower:'+FLOWER_IDS[Math.floor(decorRand(seed,cx,cz,1100+i)*4)];
  else
    kind='dry_grass'; // Every decorative grass tuft yields the same dry-grass resource.
  return {
    id:decorResourceId(cx,cz,i),
    kind,
    x:cx*DECOR_CHUNK_SIZE+decorRand(seed,cx,cz,100+i*2)*DECOR_CHUNK_SIZE,
    z:cz*DECOR_CHUNK_SIZE+decorRand(seed,cx,cz,101+i*2)*DECOR_CHUNK_SIZE,
  };
}
export function nearbyDecorResources(seed,x,z,cooldowns={},now=Date.now()/1000){
  const cx=Math.floor(x/DECOR_CHUNK_SIZE),cz=Math.floor(z/DECOR_CHUNK_SIZE),result=[];
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)
    for(let i=0;i<DECOR_SLOTS;i++){
      const resource=decorResource(seed,cx+dx,cz+dz,i);
      if(resource&&(cooldowns[resource.id]??0)<=now)result.push(resource);
    }
  return result;
}
export function isDecorResourceId(id){
  return typeof id==='string'&&/^d:-?\d+,-?\d+:(?:[0-9]|1[0-9]|2[0-4])$/.test(id);
}
