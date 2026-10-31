import {createVitals,MAX_VITALS,isFood,FOOD_EFFECTS} from './vitals.js';

export function createVitalsUI(ctx,doc=document){
 const state=createVitals();
 const style=doc.createElement('style');
 style.textContent=[
  '.fc-vitals{position:fixed;z-index:7;top:130px;left:16px;display:flex;flex-direction:column;gap:4px;background:#11281dc9;border:1px solid #62856a;border-radius:9px;padding:7px 10px;color:#e9f5e7;font:13px system-ui;pointer-events:none;min-width:152px}',
  '.fc-vitals-row{display:flex;align-items:center;gap:7px;justify-content:space-between}',
  '.fc-vitals-symbols{letter-spacing:1px;white-space:nowrap;font-size:17px}',
  '.fc-vitals-symbols .empty{opacity:.23;filter:grayscale(1)}',
  '.fc-vitals[data-exhausted=true]{border-color:#d47969}',
  '@media(max-width:650px){.fc-vitals{top:118px;left:8px;font-size:11px;padding:4px 7px;min-width:136px}.fc-vitals-symbols{font-size:15px}}',
 ].join('');
 doc.head.append(style);
 const panel=doc.createElement('section');
 panel.className='fc-vitals';panel.setAttribute('aria-label','Здоровье и голод');
 panel.innerHTML='<div class="fc-vitals-row"><span>❤️ Жизни</span><span class="fc-vitals-symbols" data-vital="health"></span></div><div class="fc-vitals-row"><span>🍗 Голод</span><span class="fc-vitals-symbols" data-vital="hunger"></span></div>';
 doc.body.append(panel);
 function render(){
  for(const [key,symbol] of [['health','♥'],['hunger','◆']]){
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
  panel.dataset.exhausted=String(!state.canChop);
  panel.title=state.canChop?'':'Рубка недоступна: нужно минимум 2 жизни и 2 сытости';
 }
 function tick(){
  if(ctx.isOnline?.())return false;
  if(!state.tick())return false;
  render();ctx.offlineSave?.markDirty?.();
  if(!state.canChop)ctx.notify?.('Недостаточно здоровья или сытости для рубки','warning','vitals-low');
  return true;
 }
 function consume(index){
  const item=ctx.inventory?.state.slots[index];
  if(!item||!isFood(item.id))return false;
  if(ctx.isOnline?.()){ctx.sendNet?.({type:'consume_food',slot:index});return true;}
  if(!ctx.inventory.state.consumeAt(index,item.id))return false;
  state.eat(item.id);
  ctx.inventory.render();render();ctx.offlineSave?.markDirty?.();
  const {health,hunger}=FOOD_EFFECTS[item.id];
  const message=health<0?'Отравление: −1 жизнь':health>0?'Восстановлена жизнь':hunger>0?'Сытость +1':'Предмет съеден';
  ctx.notify?.(message,health<0?'warning':'success','food-consumed');
  return true;
 }
 function restore(snapshot){
  if(snapshot==null)state.reset();
  else if(!state.restore(snapshot))return false;
  render();return true;
 }
 function acceptServer(snapshot){
  if(!state.restore(snapshot))return false;
  render();return true;
 }
 render();
 return {state,tick,consume,restore,acceptServer,render,serialize:()=>state.snapshot(),
  get health(){return state.health},get hunger(){return state.hunger},get canChop(){return state.canChop}};
}
