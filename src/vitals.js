import {sanitizeEffects,applyTimedEffect,staminaRegenMultiplier,hasStatusEffect,lumberjackDamageMultiplier,sprintDrainMultiplier} from './status-effects.js';
// Pure player survival state, including starvation damage.
export const MAX_VITALS=5;
export const LOW_VITALS_THRESHOLD=1;
export const HUNGER_INTERVAL_SECONDS=300;
export const STARVATION_DAMAGE_INTERVAL=10;
export const STAMINA_SPRINT_DRAIN=0.8; // slots per second of sprinting
export const STAMINA_REGEN=0.65; // slots per second walking/resting
export const STAMINA_HIT_COST=1;
export const STAMINA_JUMP_COST=1;
export const STAMINA_MIN_ACTION=1;
export const STAMINA_SPRINT_RECOVER=0.5;
export const FOOD_EFFECTS=Object.freeze({
  'mushroom:fly_agaric': {health:-1,hunger:0},
  'mushroom:death_cap': {health:-1,hunger:0},
  'mushroom:milkcap': {health:0,hunger:1},
  'mushroom:boletus': {health:0,hunger:1},
  'flower:daisy': {health:1,hunger:0},
  'flower:buttercup': {health:0,hunger:0},
  'flower:pink_wildflower': {health:0,hunger:0},
  'flower:blue_wildflower': {health:0,hunger:0},
  'potion:health':{health:3,hunger:1},
  'potion:stamina':{health:0,hunger:0},
  'potion:lumberjack':{health:-1,hunger:0},
  'potion:light_feet':{health:0,hunger:-1},
  'potion:night_vision':{health:-1,hunger:0},
  'food:mushroom_stew':{health:0,hunger:3},
  'food:herbal_mushroom_stew':{health:1,hunger:3},
});
const clamp=n=>Math.max(0,Math.min(MAX_VITALS,n));
export const isFood=id=>Object.hasOwn(FOOD_EFFECTS,id);
export function chopBlockedReason({health,hunger,stamina=MAX_VITALS}){
  if(health<=LOW_VITALS_THRESHOLD)return 'Мало жизней';
  if(hunger<=LOW_VITALS_THRESHOLD)return 'Вы голодны';
  if(stamina<=STAMINA_MIN_ACTION+1e-6)return 'Нет сил';
  return '';
}
export const canChop=({health,hunger,stamina=MAX_VITALS})=>health>LOW_VITALS_THRESHOLD&&hunger>LOW_VITALS_THRESHOLD&&stamina>STAMINA_MIN_ACTION+1e-6;
export function eatEffect(health,hunger,id){
  if(!isFood(id))return null;
  const effect=FOOD_EFFECTS[id];
  return {health:clamp(health+effect.health),hunger:clamp(hunger+effect.hunger)};
}
export function createVitals({now=()=>performance.now()/1000,epoch=()=>Date.now()/1000}={}){
  let health=MAX_VITALS,hunger=MAX_VITALS,stamina=MAX_VITALS,progress=0,starvationProgress=0,lastTick=now(),sprintLocked=false,effects=[];
  function snapshot(){return {health,hunger,stamina,staminaLocked:sprintLocked,hungerProgress:progress,starvationProgress,...(effects.length?{effects:effects.map(e=>({...e}))}:{})};}
  function restore(value){
    if(!value||!Number.isInteger(value.health)||value.health<0||value.health>MAX_VITALS
      ||!Number.isInteger(value.hunger)||value.hunger<0||value.hunger>MAX_VITALS
      ||(value.stamina!==undefined&&(!Number.isFinite(value.stamina)||value.stamina<0||value.stamina>MAX_VITALS))
      ||(value.staminaLocked!==undefined&&typeof value.staminaLocked!=='boolean')
      ||!Number.isFinite(value.hungerProgress)||value.hungerProgress<0
      ||value.hungerProgress>=HUNGER_INTERVAL_SECONDS
      ||(value.starvationProgress!==undefined&&(!Number.isFinite(value.starvationProgress)||value.starvationProgress<0||value.starvationProgress>=STARVATION_DAMAGE_INTERVAL)))return false;
    const restoredEffects=sanitizeEffects(value.effects,epoch());
    if(restoredEffects===null)return false;
    health=value.health;hunger=value.hunger;stamina=value.stamina??MAX_VITALS;progress=value.hungerProgress;starvationProgress=value.starvationProgress??0;effects=restoredEffects;
    sprintLocked=stamina<=0||(value.staminaLocked===true&&stamina<STAMINA_SPRINT_RECOVER);
    lastTick=now();return true;
  }
  function reset(){health=MAX_VITALS;hunger=MAX_VITALS;stamina=MAX_VITALS;progress=0;starvationProgress=0;lastTick=now();sprintLocked=false;effects=[];}
  function tick({sprinting=false}={}){
    const time=now();
    const elapsed=Math.max(0,time-lastTick);lastTick=time;
    const delta=Math.min(elapsed,1);
    const beforeStamina=stamina;
    effects=effects.filter(e=>e.expires_at>epoch());
    if(sprinting&&canSprint()){
      stamina=clamp(stamina-STAMINA_SPRINT_DRAIN*sprintDrainMultiplier(effects,epoch())*delta);
      if(stamina<=0)sprintLocked=true;
    }else{
      stamina=clamp(stamina+STAMINA_REGEN*staminaRegenMultiplier(effects,epoch())*delta);
      if(stamina>=STAMINA_SPRINT_RECOVER)sprintLocked=false;
    }
    if(hunger===0){
      starvationProgress+=Math.min(elapsed,3600);
      const damage=Math.floor(starvationProgress/STARVATION_DAMAGE_INTERVAL);
      if(damage){
        starvationProgress%=STARVATION_DAMAGE_INTERVAL;
        health=clamp(health-damage);
        return true;
      }
      return stamina!==beforeStamina;
    }
    progress+=Math.min(elapsed,3600);
    const steps=Math.floor(progress/HUNGER_INTERVAL_SECONDS);
    if(!steps)return stamina!==beforeStamina;
    progress%=HUNGER_INTERVAL_SECONDS;hunger=clamp(hunger-steps);
    if(hunger===0){progress=0;starvationProgress=0;}
    return true;
  }
  function damage(amount){
    if(!Number.isFinite(amount)||amount<=0||health===0)return 0;
    const actual=Math.min(health,Math.ceil(amount));
    health=clamp(health-actual);
    return actual;
  }
  function canSprint(){
    return stamina>0&&!sprintLocked;
  }
  function hit(){
    if(stamina<=STAMINA_MIN_ACTION+1e-6)return false;
    stamina=clamp(stamina-STAMINA_HIT_COST);
    if(stamina<=0)sprintLocked=true;
    return true;
  }
  function jump(){
    if(stamina<STAMINA_JUMP_COST)return false;
    stamina=clamp(stamina-STAMINA_JUMP_COST);
    if(stamina<=0)sprintLocked=true;
    return true;
  }
  function chopWarning(){return chopBlockedReason({health,hunger,stamina});}
  function eat(id){
    const result=eatEffect(health,hunger,id);
    if(!result)return false;
    health=result.health;hunger=result.hunger;if(hunger>0)starvationProgress=0;
    const status={
      'potion:stamina':'stamina_regen',
      'potion:lumberjack':'lumberjack',
      'potion:light_feet':'light_feet',
      'potion:night_vision':'night_vision',
    }[id];
    if(status)applyTimedEffect(effects,status,epoch());
    return true;
  }
  return {tick,eat,hit,jump,damage,chopWarning,canSprint,reset,restore,snapshot,
    get health(){return health},get hunger(){return hunger},get stamina(){return stamina},
    get hasNightVision(){return hasStatusEffect(effects,'night_vision',epoch())},
    get damageMultiplier(){return lumberjackDamageMultiplier(effects,epoch())},
    get sprintDrainMultiplier(){return sprintDrainMultiplier(effects,epoch())},
    get canChop(){return canChop({health,hunger,stamina})}};
}
