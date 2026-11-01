import {renderItemIcons,itemIconKey} from './item-icons.js?v=20261031-icon-zoom1';
import {DECOR_ITEM_NAMES} from './collectible-decor.js';
import {isFood} from './vitals.js';
import {RECIPE_TABS,RECIPE_PAGES,recipeAvailable} from './recipe-book.js';
import {createInventoryModel,AXE_STATS,QUICK_SLOTS,MAX_CARRY_WEIGHT,itemWeight} from './inventory.js';
export function createInventory(ctx,doc=document){
 const state=createInventoryModel();
 const icons=new Map();
 const style=doc.createElement('style');
 style.textContent=[
 '.fc-hotbar{position:fixed;z-index:8;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:5px;background:#12241ddd;border:1px solid #9cba9b88;border-radius:12px;padding:6px}',
 '.fc-slot{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:58px;height:58px;background:#1e382ce8;border:1px solid #789b83;border-radius:8px;color:#fff;cursor:pointer;font-size:25px}',
 '.fc-slot small{position:absolute;bottom:3px;right:5px;font-size:11px;font-weight:bold;color:#fff;text-shadow:0 1px 2px #000}',
 '.fc-slot[data-selected=true]{outline:3px solid #e8c56a;outline-offset:-3px;background:#40553b}',
 '.fc-slot[data-moving=true]{outline:2px dashed #e9f4a4;outline-offset:-4px}',
 '.fc-slot .fc-key{position:absolute;top:2px;left:5px;font:10px system-ui;color:#d8e2d3}',
 '.fc-bag-toggle{position:fixed;z-index:8;left:calc(50% + 145px);bottom:25px;border-radius:10px;background:#1c3b2d;padding:8px;font-size:12px}',
 '.fc-bag{position:fixed;z-index:29;top:50%;left:50%;transform:translate(-50%,-50%);width:min(420px,calc(100vw - 20px));max-height:min(85dvh,650px);overflow:auto;background:#10251ff7;border:1px solid #a4c19c;border-radius:14px;padding:14px;box-shadow:0 20px 80px #000c;color:white}',
 '.fc-bag[hidden]{display:none}.fc-bag header{display:flex;align-items:center;justify-content:space-between;gap:10px}.fc-bag h2{font-size:20px;margin:0}',
 '.fc-bag .fc-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:12px 0}',
 '.fc-slot{touch-action:none;user-select:none;-webkit-user-select:none}',
 '.fc-quick-assign{display:flex;gap:6px;justify-content:space-around;padding:6px;background:#19332a;border-radius:10px}',
 '.fc-quick-assign .fc-slot{width:48px;height:48px;font-size:21px}',
 '.fc-drag-ghost{position:fixed;z-index:10020;pointer-events:none;opacity:.87;transform:translate(-50%,-50%);width:56px;height:56px;background:#365c42f2;border:2px solid #d6f1b7;border-radius:10px;color:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;box-shadow:0 8px 25px #0009}',
 '.fc-slot.fc-drop-hover{outline:3px solid #8af5b0;outline-offset:-2px}',
 '.fc-bag .fc-grid .fc-slot{width:100%;height:65px}.fc-bag button{border-radius:8px;padding:7px 10px}',
 '.fc-bag .fc-trash-slot{margin:8px 0;width:65px;height:55px;background:#532c2c;border:1px dashed #e5a3a3;font-size:24px}',
 '.fc-slot .fc-item-tag{position:absolute;bottom:4px;left:3px;max-width:66%;font:9px system-ui;color:#e2e8e1;text-shadow:0 1px 2px #000;overflow:hidden;white-space:nowrap}',
 '.fc-slot .fc-item-icon{display:block;width:72%;height:72%;object-fit:contain;pointer-events:none;filter:drop-shadow(0 2px 2px #0007)}',
 '.fc-bag .fc-weight{margin:10px 0 4px;font:13px system-ui;color:#dcebd6}.fc-bag .fc-weight-bar{height:9px;background:#34453b;border-radius:7px;overflow:hidden}.fc-bag .fc-weight-fill{height:100%;background:#80c78d;transition:width .15s}.fc-bag .fc-weight-fill[data-over=true]{background:#ef916c}',
 '.fc-bag .fc-recipe-toggle{width:100%;margin:8px 0;background:#63503c;color:#fff3d1;border:1px solid #caa979;font-size:14px;font-weight:bold}',
 '.fc-book{background:#e9d9b5;color:#42321d;border:4px double #8e6944;border-radius:12px;padding:10px;margin:10px 0;box-shadow:inset 0 0 20px #a0784838}',
 '.fc-book[hidden]{display:none}.fc-book button{color:#3a3020;background:#f5e8cd;border:1px solid #aa8b5d}',
 '.fc-book .fc-book-tabs{display:flex;gap:4px;flex-wrap:wrap}.fc-book .fc-book-tabs button[aria-selected=true]{background:#c99b5a;font-weight:bold}',
 '.fc-book .fc-book-leaves{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}',
 '.fc-book .fc-book-leaf{padding:10px;background:#f6e9c9;min-height:145px;border:1px solid #d1b887;box-shadow:inset 0 0 15px #bf99542c}',
 '.fc-book .fc-book-leaf p{color:#59492d;font-size:12px}.fc-book h3{font-size:17px;margin:4px 0}.fc-book .fc-book-icon{font-size:36px}',
 '.fc-book .fc-book-nav{display:flex;justify-content:space-between;gap:8px}.fc-book .fc-book-cost{padding:4px 0;font-size:12px}',
 '.fc-book .fc-book-cost[data-missing=true]{color:#ad3425;font-weight:bold}.fc-book .fc-book-cost[data-missing=false]{color:#38633f}',
 '.fc-bag .fc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.fc-bag p,.fc-bag small{font-size:12px;line-height:1.5;color:#c7d7cd}',
 '@media(max-width:650px){.fc-hotbar{bottom:166px;padding:3px;gap:3px}.fc-hotbar .fc-slot{width:43px;height:43px;font-size:19px}.fc-bag-toggle{left:calc(50% + 101px);bottom:172px;padding:6px;font-size:11px}.fc-bag .fc-grid .fc-slot{height:52px}.fc-bag{padding:10px;width:calc(100vw - 14px);max-height:83dvh}.fc-bag h2{font-size:16px}.fc-bag p{font-size:11px!important}.fc-quick-assign .fc-slot{width:44px;height:44px}}'
 ].join('');
 doc.head.append(style);
 const bar=doc.createElement('div');bar.className='fc-hotbar';bar.setAttribute('aria-label','Быстрые слоты предметов');
 const toggle=doc.createElement('button');toggle.className='fc-bag-toggle';toggle.textContent='🎒 Сумка (I)';toggle.type='button';
 const bag=doc.createElement('section');bag.className='fc-bag';bag.hidden=true;bag.setAttribute('aria-label','Инвентарь');
 bag.innerHTML='<header><h2>🎒 Сумка</h2><button type="button" data-action="close" aria-label="Закрыть инвентарь">✕</button></header><p class="fc-bag-hint"></p><div class="fc-weight" role="status"></div><div class="fc-weight-bar" role="progressbar" aria-label="Вес рюкзака" aria-valuemin="0" aria-valuemax="100"><div class="fc-weight-fill"></div></div><div style="font-size:11px;opacity:.8;margin-top:8px">Быстрый доступ — перетащи предмет сюда:</div><div class="fc-quick-assign"></div><div class="fc-grid"></div><button class="fc-recipe-toggle" type="button" data-action="book">📖 Книга рецептов</button><section class="fc-book" hidden aria-label="Книга крафта"><div class="fc-book-tabs" role="tablist"></div><div class="fc-book-leaves"></div><div class="fc-book-nav"><button type="button" data-action="previous">← Назад</button><span class="fc-book-position"></span><button type="button" data-action="next">Вперёд →</button></div></section><div class="fc-actions"><button type="button" data-action="split">✂ Разделить стак</button><button type="button" data-action="drop">📦 Выбросить выбранный стак</button></div><button type="button" class="fc-trash-slot fc-slot" data-action="trash" title="Удалить предмет без коробки">🗑️</button><p>Корзина: выбери предмет в сумке и нажми 🗑️, чтобы уничтожить его без коробки.</p><p>Перетаскивай предметы между слотами; Shift+перетаскивание — половина стака. На телефоне — кнопка «Разделить». Перетащи предмет на быстрый слот для ярлыка, за пределы сумки — выбросить. Двойной клик по еде — съесть. Быстрые слоты — 1–4. Не более 5 брёвен в стопке. Чтобы рубить — выбери топор.</p><small>Предусмотрены уровни сумки и улучшения топора.</small>';
 doc.body.append(bar,toggle,bag);
 let bookTab='tools',bookPage=0;
 let moving=-1,lastSelected=null,lastFoodClick=-1,lastFoodTime=-Infinity,suppressClickUntil=0;
 const speciesTag={
   'mushroom:fly_agaric':'Мух.','mushroom:boletus':'Боров.','mushroom:death_cap':'Пог.','mushroom:milkcap':'Груздь',
   'flower:daisy':'Ром.','flower:buttercup':'Лют.','flower:pink_wildflower':'Роз.','flower:blue_wildflower':'Син.',
 };
 const itemLabel=item=>!item?'':({
   'mushroom:death_cap':'🍄','mushroom:fly_agaric':'🍄','mushroom:boletus':'🍄','mushroom:milkcap':'🍄',
   'flower:daisy':'🌼','flower:buttercup':'🌻','flower:pink_wildflower':'🌸','flower:blue_wildflower':'🪻',
   axe:'🪓',bench:'🪑',log:'🪵',branch:'🌿',stone:'🪨',
 }[item.id]??'?');
 const itemTitle=item=>!item?'Пустой слот':(item.id==='axe'?AXE_STATS[item.tier].name:item.id==='bench'?'Скамейка':({log:'Бревно',branch:'Ветки',stone:'Камни'}[item.id]??DECOR_ITEM_NAMES[item.id]??item.id)+' ×'+item.count)+' · '+itemWeight(item).toLocaleString('ru-RU',{maximumFractionDigits:2})+' кг';
 function slot(i,hot=false){
   const item=hot?state.quickItem(i):state.slots[i],b=doc.createElement('button');b.type='button';b.className='fc-slot';
   b.dataset.slot=String(i);b.dataset.kind=hot?'quick':'bag';b.title=hot&&item?itemTitle(item)+' · Всего: '+state.count(item.id):itemTitle(item);
   b.setAttribute('aria-label',(hot?'Быстрый слот ':'Слот ')+(i+1)+': '+itemTitle(item));
   b.dataset.selected=String(hot&&i===state.selectedQuick);
   b.dataset.moving=String(i===moving);
   const image=icons.get(itemIconKey(item));
   if(image){
     const icon=doc.createElement('img');
     icon.className='fc-item-icon';icon.src=image;icon.alt='';
     icon.draggable=false;b.append(icon);
   }else{
     const icon=doc.createElement('span');icon.textContent=itemLabel(item);b.append(icon);
   }
   if(speciesTag[item?.id]){const tag=doc.createElement('span');tag.className='fc-item-tag';tag.textContent=speciesTag[item.id];b.append(tag);}
   if(hot){const key=doc.createElement('span');key.className='fc-key';key.textContent=i+1;b.append(key);}
   if(item&&item.id!=='axe'){const count=doc.createElement('small');count.textContent=hot?state.count(item.id):item.count;b.append(count);}
   b.onclick=()=>{
     if(performance.now()<suppressClickUntil)return;
     if(hot){select(i);return;}
     const now=performance.now();
     if(item&&isFood(item.id)&&lastFoodClick===i&&now-lastFoodTime<450){
       lastFoodClick=-1;lastFoodTime=-Infinity;moving=-1;
       ctx.vitals?.consume(i);render();return;
     }
     lastFoodClick=item&&isFood(item.id)?i:-1;lastFoodTime=now;
     if(moving<0)moving=i;
     else {if(moving!==i){if(ctx.isOnline?.())ctx.sendNet?.({type:'transfer_slot',from:moving,to:i});else state.transfer(moving,i);}moving=-1;changed({equip:false});}
     render();
   };
   return b;
 }
 function render(){
   const selection=state.selected();
   if(lastSelected!==selection){
     lastSelected=selection;
     ctx.buildMode=selection==='log'||selection==='bench';
     ctx.disposePreview?.();
   }
   bar.replaceChildren(...Array.from({length:QUICK_SLOTS},(_,i)=>slot(i,true)));
   bag.querySelector('.fc-quick-assign').replaceChildren(...Array.from({length:QUICK_SLOTS},(_,i)=>slot(i,true)));
   bag.querySelector('.fc-grid').replaceChildren(...state.slots.map((_,i)=>slot(i)));
   bag.querySelector('.fc-bag-hint').textContent=state.slots.filter(Boolean).length+'/'+state.capacity()+
     ' слотов занято · '+state.wood()+' 🪵 · сумка '+state.bagTier+' ур. · '+(state.equipped()?state.axe().name:'Руки свободны');
   const mass=state.weight();
   const label=mass.toLocaleString('ru-RU',{maximumFractionDigits:2})+' / '+MAX_CARRY_WEIGHT+' кг';
   bag.querySelector('.fc-weight').textContent='⚖ Вес: '+label+(mass>MAX_CARRY_WEIGHT?' · перегруз!':'');
   const progress=bag.querySelector('.fc-weight-bar');
   progress.setAttribute('aria-valuenow',String(Math.min(MAX_CARRY_WEIGHT,mass)));
   const fill=progress.querySelector('.fc-weight-fill');
   fill.style.width=(Math.min(mass/MAX_CARRY_WEIGHT,1)*100)+'%';
   fill.dataset.over=String(mass>MAX_CARRY_WEIGHT);
   renderBook();
   bag.querySelector('[data-action="drop"]').disabled=!state.slots[moving<0?state.selectedSlot():moving];
   bag.querySelector('[data-action="trash"]').disabled=!state.slots[moving<0?state.selectedSlot():moving];
   const splitting=state.slots[usedSlot()];
   bag.querySelector('[data-action="split"]').disabled=!splitting||splitting.id==='axe'||splitting.count<2||!state.hasSpace();
   ctx.axe.visible=!ctx.thirdPerson&&state.equipped();
   ctx.ownAvatar?.visual?.traverse?.(node=>{if(/^Axe (blade|handle)$/.test(node.name))node.visible=state.equipped();});
   if(ctx.$('wood'))ctx.$('wood').textContent=state.wood();
 }
 const book=bag.querySelector('.fc-book');
 const pageItems=()=>RECIPE_PAGES.filter(entry=>entry.tab===bookTab);
 const names={log:'🪵 Бревно',branch:'🌿 Ветка',stone:'🪨 Камень',dry_grass:'🌾 Сухая трава'};
 function renderBook(){
   if(book.hidden)return;
   const tabs=book.querySelector('.fc-book-tabs');
   tabs.replaceChildren(...RECIPE_TABS.map(t=>{
     const button=doc.createElement('button');button.type='button';button.dataset.tab=t.id;
     button.textContent=t.icon+' '+t.name;button.setAttribute('role','tab');
     button.setAttribute('aria-selected',String(bookTab===t.id));
     return button;
   }));
   const entries=pageItems();
   bookPage=Math.min(bookPage,Math.max(0,entries.length-1));
   const entry=entries[bookPage],leaves=book.querySelector('.fc-book-leaves');
   const left=doc.createElement('article');left.className='fc-book-leaf';
   const icon=doc.createElement('div');icon.className='fc-book-icon';icon.textContent=entry?.icon??'📖';
   const heading=doc.createElement('h3');heading.textContent=entry?.name??'Пустая страница';
   const description=doc.createElement('p');description.textContent=entry?.description??'';
   left.append(icon,heading,description);
   const right=doc.createElement('article');right.className='fc-book-leaf';
   if(entry?.ingredients){
     const h=doc.createElement('h3');h.textContent='Материалы';right.append(h);
     for(const [id,n] of Object.entries(entry.ingredients)){
       const row=doc.createElement('div');row.className='fc-book-cost';
       row.dataset.missing=String(state.count(id)<n);
       row.textContent=(names[id]??id)+': '+state.count(id)+' / '+n;right.append(row);
     }
   }
   for(const effect of entry?.effects??[]){
     const row=doc.createElement('p');row.textContent='✦ '+effect;right.append(row);
   }
   if(entry?.craftable){
     const button=doc.createElement('button');button.type='button';button.dataset.action='book-craft';button.dataset.recipe=entry.id;
     button.textContent='Создать '+entry.icon;
     button.disabled=!recipeAvailable(entry,state) || !canCraftAfterWeight(entry);
     right.append(button);
   }else{
     const note=doc.createElement('p');
     note.textContent=entry?.planned?'🔒 Рецепт появится в следующем обновлении':'📜 Схема: укладывай брёвна вручную';
     right.append(note);
   }
   leaves.replaceChildren(left,right);
   book.querySelector('.fc-book-position').textContent=(bookPage+1)+' / '+entries.length;
   book.querySelector('[data-action="previous"]').disabled=bookPage===0;
   book.querySelector('[data-action="next"]').disabled=bookPage>=entries.length-1;
 }
 function canCraftAfterWeight(entry){
   const spent=Object.entries(entry.ingredients??{}).reduce((n,[id,count])=>n+count*({log:25,stone:2,branch:.5}[id]??0),0);
   return state.weight()-spent+(entry.id==='axe'?3:entry.id==='bench'?15:0)<=MAX_CARRY_WEIGHT;
 }
 function changed({equip=true}={}){
   render();if(!ctx.isOnline?.())ctx.offlineSave?.markDirty?.();
   if(equip&&ctx.isOnline?.())ctx.sendNet?.({type:'select_slot',slot:state.selectedQuick});
 }
 function select(i){if(!state.select(i))return false;moving=-1;changed();ctx.buildMode=state.selected()==='log'||state.selected()==='bench';ctx.disposePreview?.();ctx.updatePreview?.();return true;}
 function syncWood(n,{migrate=false}={}){
   if(!state.setWood(n,{migrate})){ctx.notify?.('Сумка заполнена','warning','bag-full');return false;}
   render();return true;
 }
 function usedSlot(){return moving>=0?moving:state.selectedSlot();}
 function splitStack(){
   const source=usedSlot();
   if(ctx.isOnline?.())ctx.sendNet?.({type:'split_slot',slot:source});
   else if(state.split(source))changed({equip:false});
   moving=-1;render();
 }
 function dropItem(slot){
   if(!state.slots[slot])return false;
   const ok=ctx.groundBoxes?.dropSlot?.(slot)??false;
   if(ok){moving=-1;render();ctx.notify?.('📦 Предмет выброшен. Коробка исчезнет через 60 минут.','info','box-drop');}
   return ok;
 }
 function dropStack(){return dropItem(usedSlot());}
 function trashStack(){
   const slot=usedSlot();
   if(!state.slots[slot])return false;
   if(ctx.isOnline?.()){
     ctx.sendNet?.({type:'trash_item',slot});
   }else{
     const removed=state.removeSlot(slot);if(!removed)return false;
     ctx.wood=state.wood();changed();
   }
   moving=-1;render();return true;
 }
 function craftAxe(){
   if(state.count('branch')<3||state.count('stone')<2)return false;
   if(ctx.isOnline?.()){ctx.sendNet?.({type:'craft_axe'});return true;}
   if(!state.craft('axe')){ctx.notify?.('Нет места или превышен лимит 100 кг для топора','warning','axe-craft-full');return false;}
   changed();ctx.notify?.('🪓 Топор скрафчен','success','axe-craft');return true;
 }
 function craftBench(){
   if(state.wood()<3)return false;
   if(ctx.isOnline?.()){
     ctx.sendNet?.({type:'craft_item',recipe:'bench'});return true;
   }
   if(!state.craftBench()){ctx.notify?.('Нет места или превышен лимит 100 кг для скамейки','warning','bench-full');return false;}
   ctx.wood=state.wood();changed();
   ctx.notify?.('🪑 Скамейка скрафчена — выбери её в быстром слоте','success','bench-craft');
   return true;
 }
 function restore(snapshot,wood=0){
   if(!state.restore(snapshot,wood))return false;
   moving=-1;changed({equip:false});ctx.buildMode=state.selected()==='log'||state.selected()==='bench';return true;
 }
 // One Pointer Events implementation for desktop mouse and touch devices.
 // Dragging onto quick access assigns a reference, not an inventory copy.
 let drag=null;
 function pointerStart(e){
   if(e.button!==0||drag)return;
   const el=e.target.closest?.('.fc-slot[data-slot][data-kind]');
   if(!el)return;
   const source=Number(el.dataset.slot),kind=el.dataset.kind;
   const index=kind==='quick'?state.quickSlot(source):source;
   if(!state.slots[index])return;
   drag={id:e.pointerId,source,kind,index,x:e.clientX,y:e.clientY,
     start:performance.now(),half:e.shiftKey,started:false,ghost:null};
 }
 function pointerMove(e){
   if(!drag||e.pointerId!==drag.id)return;
   const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
   if(!drag.started&&Math.hypot(dx,dy)<8)return;
   if(!drag.started){
     drag.started=true;
     const ghost=doc.createElement('div');
     ghost.className='fc-drag-ghost';
     const dragged=state.slots[drag.index];
     if(icons.has(itemIconKey(dragged))){
       const image=doc.createElement('img');image.src=icons.get(itemIconKey(dragged));
       image.alt='';image.draggable=false;image.style.cssText='width:90%;height:90%;object-fit:contain';
       ghost.append(image);
     }else ghost.textContent=itemLabel(dragged);
     doc.body.append(ghost);drag.ghost=ghost;
   }
   e.preventDefault();
   drag.ghost.style.left=e.clientX+'px';
   drag.ghost.style.top=e.clientY+'px';
   doc.querySelectorAll('.fc-slot.fc-drop-hover').forEach(el=>el.classList.remove('fc-drop-hover'));
   doc.elementFromPoint(e.clientX,e.clientY)?.closest?.('.fc-slot')?.classList.add('fc-drop-hover');
 }
 function pointerEnd(e){
   if(!drag||e.pointerId!==drag.id)return;
   const current=drag;drag=null;
   current.ghost?.remove();
   doc.querySelectorAll('.fc-slot.fc-drop-hover').forEach(el=>el.classList.remove('fc-drop-hover'));
   if(!current.started||e.type==='pointercancel')return;
   suppressClickUntil=performance.now()+320;
   const target=doc.elementFromPoint(e.clientX,e.clientY);
   const cell=target?.closest?.('.fc-slot[data-slot][data-kind]');
   const trash=target?.closest?.('[data-action="trash"]');
   const split=target?.closest?.('[data-action="split"]');
   const from=current.index;
   if(cell){
     const to=Number(cell.dataset.slot);
     const targetKind=cell.dataset.kind;
     if(targetKind==='quick'){
       if(current.kind==='quick'){
         if(ctx.isOnline?.())ctx.sendNet?.({type:'swap_quick',from:current.source,to});
         else {state.swapQuick(current.source,to);changed();}
       }else{
         if(ctx.isOnline?.())ctx.sendNet?.({type:'assign_quick',quick:to,source:from});
         else {state.assignQuick(to,from);changed();}
       }
     }else{
       const partial=current.half||(e.pointerType==='touch'&&performance.now()-current.start>650);
       if(ctx.isOnline?.())ctx.sendNet?.({type:'transfer_slot',from,to,half:partial});
       else if(state.transfer(from,to,{half:partial})){ctx.wood=state.wood();changed({equip:false});}
     }
   }else if(trash){
     if(ctx.isOnline?.())ctx.sendNet?.({type:'trash_item',slot:from});
     else {state.removeSlot(from);ctx.wood=state.wood();changed();}
   }else if(split){
     moving=from;splitStack();
   }else if(current.kind==='bag'&&!bag.contains(target)&&!bar.contains(target)){
     dropItem(from);
   }
   moving=-1;
   render();
 }
 bag.addEventListener('pointerdown',pointerStart);
 bar.addEventListener('pointerdown',pointerStart);
 doc.addEventListener('pointermove',pointerMove,{passive:false});
 doc.addEventListener('pointerup',pointerEnd);
 doc.addEventListener('pointercancel',pointerEnd);
 toggle.onclick=()=>{bag.hidden=!bag.hidden;if(!bag.hidden)render();};
 bag.addEventListener('click',event=>{
   const action=event.target?.dataset?.action;
   if(action==='close')bag.hidden=true;
   if(action==='book'){book.hidden=!book.hidden;renderBook();}
   if(action==='previous'){bookPage=Math.max(0,bookPage-1);renderBook();}
   if(action==='next'){bookPage=Math.min(pageItems().length-1,bookPage+1);renderBook();}
   if(action==='book-craft'){if(event.target.dataset.recipe==='bench')craftBench();else if(event.target.dataset.recipe==='axe')craftAxe();}
   const tab=event.target?.dataset?.tab;
   if(tab&&RECIPE_TABS.some(t=>t.id===tab)){bookTab=tab;bookPage=0;renderBook();}
   if(action==='split')splitStack();
   if(action==='drop')dropStack();
   if(action==='trash')trashStack();
 });
 render();
 // Render all item types and axe tiers once, without blocking the game
 // renderer. Until ready, slots keep their existing emoji placeholders.
 const schedule=typeof requestIdleCallback==='function'
   ?fn=>requestIdleCallback(fn,{timeout:2500})
   :fn=>setTimeout(fn,0);
 schedule(()=>{
   const generated=renderItemIcons(ctx,doc);
   for(const [id,url] of generated)icons.set(id,url);
   render();
 });
 function acceptServer(snapshot,wood){
   if(!state.restore(snapshot,wood))return false;
   moving=-1;render();
   ctx.buildMode=state.selected()==='log'||state.selected()==='bench';
   ctx.disposePreview?.();return true;
 }
 return {state,render,select,syncWood,dropStack,trashStack,splitStack,restore,acceptServer,craftBench,craftAxe,
   get isOpen(){return !bag.hidden;},toggle(){toggle.click();},close(){bag.hidden=true;},
   serialize:()=>state.serialize(),get equipped(){return state.equipped();},
   get axe(){return state.axe();},get selected(){return state.selected();}};
}
