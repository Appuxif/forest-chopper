// Pure player survival state. No death/respawn until a later game feature.
export const MAX_VITALS=5;
export const LOW_VITALS_THRESHOLD=1;
export const HUNGER_INTERVAL_SECONDS=300;
export const FOOD_EFFECTS=Object.freeze({
  'mushroom:fly_agaric': {health:-1,hunger:0},
  'mushroom:death_cap': {health:-1,hunger:0},
  'mushroom:milkcap': {health:0,hunger:1},
  'mushroom:boletus': {health:0,hunger:1},
  'flower:daisy': {health:1,hunger:0},
  'flower:buttercup': {health:0,hunger:0},
  'flower:pink_wildflower': {health:0,hunger:0},
  'flower:blue_wildflower': {health:0,hunger:0},
});
const clamp=n=>Math.max(0,Math.min(MAX_VITALS,n));
export const isFood=id=>Object.hasOwn(FOOD_EFFECTS,id);
export const canChop=({health,hunger})=>health>LOW_VITALS_THRESHOLD&&hunger>LOW_VITALS_THRESHOLD;
export function eatEffect(health,hunger,id){
  if(!isFood(id))return null;
  const effect=FOOD_EFFECTS[id];
  return {health:clamp(health+effect.health),hunger:clamp(hunger+effect.hunger)};
}
export function createVitals({now=()=>performance.now()/1000}={}){
  let health=MAX_VITALS,hunger=MAX_VITALS,progress=0,lastTick=now();
  function snapshot(){return {health,hunger,hungerProgress:progress};}
  function restore(value){
    if(!value||!Number.isInteger(value.health)||value.health<0||value.health>MAX_VITALS
      ||!Number.isInteger(value.hunger)||value.hunger<0||value.hunger>MAX_VITALS
      ||!Number.isFinite(value.hungerProgress)||value.hungerProgress<0
      ||value.hungerProgress>=HUNGER_INTERVAL_SECONDS)return false;
    health=value.health;hunger=value.hunger;progress=value.hungerProgress;
    lastTick=now();return true;
  }
  function reset(){health=MAX_VITALS;hunger=MAX_VITALS;progress=0;lastTick=now();}
  function tick(){
    const time=now();
    const delta=Math.max(0,Math.min(time-lastTick,3600));lastTick=time;
    if(hunger===0)return false;
    progress+=delta;
    const steps=Math.floor(progress/HUNGER_INTERVAL_SECONDS);
    if(!steps)return false;
    progress%=HUNGER_INTERVAL_SECONDS;hunger=clamp(hunger-steps);
    if(hunger===0)progress=0;
    return true;
  }
  function eat(id){
    const result=eatEffect(health,hunger,id);
    if(!result)return false;
    health=result.health;hunger=result.hunger;
    return true;
  }
  return {tick,eat,reset,restore,snapshot,
    get health(){return health},get hunger(){return hunger},
    get canChop(){return canChop({health,hunger})}};
}
