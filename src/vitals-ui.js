import {createVitals,MAX_VITALS,isFood,FOOD_EFFECTS} from './vitals.js';
import {recipeById} from './recipe-book.js';
import {canCraftAtStation} from './crafting-stations.js';

export function createVitalsUI(ctx,doc=document){
 const state=createVitals();
 const style=doc.createElement('style');
 style.textContent=[
  '.fc-vitals{position:fixed;z-index:9;bottom:92px;left:50%;transform:translateX(-50%);display:flex;flex-direction:row;align-items:center;justify-content:center;gap:15px;background:#11281de0;border:1px solid #62856a;border-radius:9px;padding:5px 9px;color:#e9f5e7;font:12px system-ui;pointer-events:none;white-space:nowrap}',
  '.fc-vitals-row{display:flex;align-items:center;gap:5px;white-space:nowrap}',
  '.fc-vitals-symbols{display:inline-flex;gap:2px;white-space:nowrap;font-size:15px}',
  '.fc-vitals-symbols .empty{opacity:.23;filter:grayscale(1)}',
  '.fc-stamina{position:absolute;bottom:calc(100% + 5px);left:0;width:100%;height:5px;border:1px solid #6cbccc;border-radius:10px;background:#122c32e6;overflow:hidden;opacity:0;visibility:hidden;transition:opacity .65s ease,visibility 0s linear .65s}',
  '.fc-stamina[data-visible="true"]{opacity:1;visibility:visible;transition:opacity .2s ease,visibility 0s}',
  '.fc-stamina-fill{height:100%;background:#65d5e7;border-radius:10px;transition:width .12s linear}',
  '.fc-vitals[data-exhausted=true]{border-color:#d47969}',
  '.fc-starvation{position:absolute;bottom:calc(100% + 11px);left:50%;transform:translateX(-50%);padding:5px 9px;color:#fff;border-radius:7px;border:1px solid #ef7770;background:#9d201de8;font:bold 13px system-ui;white-space:nowrap;text-shadow:0 1px 2px #400;pointer-events:none}',
  '.fc-starvation[hidden]{display:none!important}',
  '@media(max-width:650px){.fc-vitals{bottom:221px;gap:9px;padding:3px 6px;font-size:10px}.fc-vitals-symbols{gap:1px;font-size:13px}.fc-stamina{height:4px}}',
 ].join('');
 doc.head.append(style);
 const panel=doc.createElement('section');
 panel.className='fc-vitals';panel.setAttribute('aria-label','Здоровье, голод и выносливость');
 panel.innerHTML='<div class="fc-starvation" role="alert" hidden>⚠️ Сильный Голод!</div><div class="fc-stamina" title="Выносливость"><div class="fc-stamina-fill"></div></div><div class="fc-vitals-row"><span class="fc-vitals-symbols" data-vital="health" aria-label="Жизни"></span></div><div class="fc-vitals-row"><span class="fc-vitals-symbols" data-vital="hunger" aria-label="Голод"></span></div>';
 doc.body.append(panel);
 function render(){
  for(const [key,symbol] of [['health','♥'],['hunger','🍗']]){
   const element=panel.querySelector('[data-vital="'+key+'"]');
   const count=state[key];element.replaceChildren();
   for(let i=0;i<MAX_VITALS;i++){
    const part=doc.createElement('span');part.textContent=symbol;
    if(i>=count)part.className='empty';
    part.style.color=key==='health'?'#fa777b':'#eabf68';
    element.append(part);
   }
   element.title=key==='health'?'Жизни: '+count+'/5':'Голод: '+count+'/5';
  }
  const staminaBar=panel.querySelector('.fc-stamina');
  staminaBar.dataset.visible=String(state.stamina<MAX_VITALS/2);
  staminaBar.querySelector('.fc-stamina-fill').style.width=(state.stamina/MAX_VITALS*100)+'%';
  staminaBar.title='Выносливость: '+state.stamina.toFixed(1)+'/5';
  panel.querySelector('.fc-starvation').hidden=state.hunger!==0;
  panel.dataset.exhausted=String(!state.canChop);
  panel.title=state.chopWarning();
 }
 let lastVisualStamina=MAX_VITALS,lastVisualHunger=MAX_VITALS;
 function tick(sprinting=false){
  const beforeHunger=state.hunger;
  const beforeHealth=state.health;
  const cheats=!ctx.isOnline?.()?ctx.debugCheats:null;
  if(cheats?.immortal||cheats?.hunger||cheats?.stamina){
   const v=state.snapshot();
   state.restore({...v,
    health:cheats.immortal?5:v.health,hunger:cheats.hunger?5:v.hunger,
    stamina:cheats.stamina?5:v.stamina,staminaLocked:cheats.stamina?false:v.staminaLocked,
    hungerProgress:cheats.hunger?0:v.hungerProgress,
    starvationProgress:cheats.hunger?0:v.starvationProgress});
  }
  const changed=state.tick({sprinting:!!sprinting&&!cheats?.stamina});
  if(cheats?.hunger||cheats?.immortal||cheats?.stamina){
   const v=state.snapshot();
   state.restore({...v,health:cheats.immortal?5:v.health,hunger:cheats.hunger?5:v.hunger,
    stamina:cheats.stamina?5:v.stamina,staminaLocked:cheats.stamina?false:v.staminaLocked,
    hungerProgress:cheats.hunger?0:v.hungerProgress,
    starvationProgress:cheats.hunger?0:v.starvationProgress});
  }
  if(state.health>0&&state.health<beforeHealth)ctx.audio?.hurt?.();
  // Online stamina is predicted locally for responsive movement; server
  // confirmations correct it via acceptServer without awarding client authority.
  // (The player loop invokes this each frame.)
  const stamina=state.stamina;
  if(changed&&(Math.abs(stamina-lastVisualStamina)>.055||state.hunger!==lastVisualHunger||state.health!==beforeHealth)){
    lastVisualStamina=stamina;lastVisualHunger=state.hunger;render();
  }
  if(!ctx.isOnline?.()&&changed)ctx.offlineSave?.markDirty?.();
  if(state.hunger===0&&beforeHunger!==0)ctx.notify?.('⚠️ Сильный Голод! Здоровье падает каждые 10 секунд.','warning','starving');
  if(state.health===0)ctx.deathSystem?.onDeath?.();
  if(beforeHunger>state.hunger&&!state.canChop)ctx.notify?.(state.chopWarning(),'warning','vitals-low');
  return changed;
 }
 function damage(amount){
  if(ctx.debugCheats?.immortal&&!ctx.isOnline?.())return 0;
  const dealt=state.damage(amount);
  if(!dealt)return 0;
  if(state.health>0)ctx.audio?.hurt?.();
  render();
  if(!ctx.isOnline?.())ctx.offlineSave?.markDirty?.();
  if(state.health===0)ctx.deathSystem?.onDeath?.();
  return dealt;
 }
 function canSprint(){return state.canSprint();}
 function hit(){
  if(!state.hit())return false;
  render();
  if(!ctx.isOnline?.())ctx.offlineSave?.markDirty?.();
  return true;
 }
 function jump(){
  if(!state.jump()){
    ctx.notify?.('Нет сил','warning','vitals-jump');
    return false;
  }
  render();
  if(!ctx.isOnline?.())ctx.offlineSave?.markDirty?.();
  return true;
 }
 function craftConsumable(id){
  const entry=recipeById(id),cost=entry?.ingredients,inventory=ctx.inventory?.state;
  if(!cost||!['alchemy','food'].includes(entry.tab)||!inventory||!canCraftAtStation(ctx,entry)||

    !Object.entries(cost).every(([kind,amount])=>inventory.count(kind)>=amount))return false;
  if(ctx.isOnline?.()){ctx.sendNet?.({type:'craft_potion',recipe:id});return true;}
  const snapshot=inventory.serialize();
  for(const [kind,amount] of Object.entries(cost))inventory.spend(kind,amount);
  if(!inventory.addItem({id,count:1})){
    inventory.restore(snapshot,inventory.wood());return false;
  }
  ctx.inventory.render();ctx.offlineSave?.markDirty?.();return true;
 }
 function consume(index){
  const item=ctx.inventory?.state.slots[index];
  if(!item||!isFood(item.id))return false;
  if(ctx.isOnline?.()){ctx.sendNet?.({type:'consume_food',slot:index});return true;}
  if(!ctx.inventory.state.consumeAt(index,item.id))return false;
  const oldHealth=state.health;
  state.eat(item.id);
  if(state.health>0&&state.health<oldHealth)ctx.audio?.hurt?.();
  ctx.inventory.render();render();ctx.offlineSave?.markDirty?.();
  if(state.health===0)ctx.deathSystem?.onDeath?.();
  const {health,hunger}=FOOD_EFFECTS[item.id];
  const timedMessages={
    'potion:lumberjack':'Урон деревьям ×2 на 45 секунд · −1 жизнь',
    'potion:light_feet':'Расход сил при беге −50% на 45 секунд · −1 голод',
    'potion:night_vision':'Ночное зрение на 5 минут · −1 жизнь',
  };
  const message=timedMessages[item.id]??(item.id==='potion:stamina'?'Регенерация выносливости ×2 на 30 секунд':health<0?'Отравление: −1 жизнь':item.id==='potion:health'?'Зелье здоровья: +3 жизни, +1 сытость':health>0?'Восстановлена жизнь':hunger>0?'Сытость +'+hunger:'Предмет съеден');
  ctx.notify?.(message,health<0?'warning':'success','food-consumed');
  return true;
 }
 function restore(snapshot){
  if(snapshot==null)state.reset();
  else if(!state.restore(snapshot))return false;
  lastVisualStamina=state.stamina;lastVisualHunger=state.hunger;render();return true;
 }
 function acceptServer(snapshot){
  const wasHungry=state.hunger,oldHealth=state.health;
  if(!state.restore(snapshot))return false;
  if(state.health>0&&state.health<oldHealth)ctx.audio?.hurt?.();
  if(wasHungry>0&&state.hunger===0)ctx.notify?.('⚠️ Сильный Голод! Здоровье падает каждые 10 секунд.','warning','starving');
  lastVisualStamina=state.stamina;lastVisualHunger=state.hunger;render();
  if(state.health===0)ctx.deathSystem?.onDeath?.();
  return true;
 }
 render();
 return {state,tick,consume,craftConsumable,craftPotion:craftConsumable,hit,jump,damage,chopWarning:()=>state.chopWarning(),canSprint,restore,acceptServer,render,serialize:()=>state.snapshot(),
  get health(){return state.health},get hunger(){return state.hunger},get stamina(){return state.stamina},
  get canChop(){return state.canChop},
  get hasNightVision(){return state.hasNightVision},
  get damageMultiplier(){return state.damageMultiplier}};
}
