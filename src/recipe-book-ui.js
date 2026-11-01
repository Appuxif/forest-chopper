import {RECIPE_TABS,RECIPE_PAGES,recipeAvailable} from './recipe-book.js';
import {MAX_CARRY_WEIGHT,ITEM_WEIGHT} from './inventory.js';

// Standalone crafting window. Inventory is only a data source, never its DOM parent.
export function createRecipeBook({ctx,state,craftAxe,craftBench,onOpen},doc=document){
 const style=doc.createElement('style');
 style.textContent=[
  '.fc-book-backdrop{position:fixed;inset:0;z-index:39;background:#080e0bc2}',
  '.fc-book-window{position:fixed;z-index:40;top:50%;left:50%;transform:translate(-50%,-50%);width:min(740px,calc(100vw - 24px));max-height:88dvh;overflow:auto;background:#e9d9b5;color:#42321d;border:5px double #8e6944;border-radius:15px;padding:18px;box-sizing:border-box;box-shadow:0 24px 80px #000c,inset 0 0 25px #a0784838;font:14px system-ui}',
  '.fc-book-window[hidden],.fc-book-backdrop[hidden]{display:none}',
  '.fc-book-window header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}',
  '.fc-book-window h2{font:700 24px Georgia,serif;margin:0}.fc-book-window h3{font:700 19px Georgia,serif;margin:6px 0}',
  '.fc-book-window button{color:#3a3020;background:#f5e8cd;border:1px solid #aa8b5d;border-radius:7px;padding:9px 11px;cursor:pointer}',
  '.fc-book-window button:disabled{opacity:.4;cursor:default}',
  '.fc-book-window .fc-book-tabs{display:flex;gap:6px;flex-wrap:wrap}',
  '.fc-book-window .fc-book-tabs button[aria-selected=true]{background:#c99b5a;font-weight:700;border-color:#76502d}',
  '.fc-book-window .fc-book-leaves{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}',
  '.fc-book-window .fc-book-leaf{padding:16px;background:#f6e9c9;min-height:205px;border:1px solid #d1b887;box-shadow:inset 0 0 15px #bf99542c}',
  '.fc-book-window .fc-book-leaf p{color:#59492d;line-height:1.5}.fc-book-window .fc-book-icon{font-size:46px}',
  '.fc-book-window .fc-book-nav{display:flex;align-items:center;justify-content:space-between;gap:8px}',
  '.fc-book-window .fc-book-cost{padding:4px 0;font-size:13px}.fc-book-window .fc-book-cost[data-missing=true]{color:#ad3425;font-weight:bold}.fc-book-window .fc-book-cost[data-missing=false]{color:#38633f}',
  '.fc-book-window [data-action="book-craft"]{margin-top:12px;background:#795b38;color:#fff6db;font-weight:bold}',
  '@media(max-width:650px){.fc-book-window{max-height:88dvh;padding:12px}.fc-book-window header{margin-bottom:9px}.fc-book-window h2{font-size:20px}.fc-book-window .fc-book-leaves{grid-template-columns:1fr;gap:8px;margin:8px 0}.fc-book-window .fc-book-leaf{min-height:0;padding:10px}.fc-book-window .fc-book-icon{font-size:28px}.fc-book-window .fc-book-tabs button{font-size:12px;padding:7px}}'
 ].join('');
 doc.head.append(style);
 const backdrop=doc.createElement('div');backdrop.className='fc-book-backdrop';backdrop.hidden=true;
 const book=doc.createElement('section');
 book.className='fc-book-window';book.hidden=true;book.setAttribute('role','dialog');
 book.setAttribute('aria-modal','true');book.setAttribute('aria-label','Книга рецептов');
 book.innerHTML='<header><h2>📖 Книга рецептов</h2><button type="button" data-action="close" aria-label="Закрыть книгу">✕</button></header><div class="fc-book-tabs" role="tablist"></div><div class="fc-book-leaves"></div><div class="fc-book-nav"><button type="button" data-action="previous">← Назад</button><span class="fc-book-position"></span><button type="button" data-action="next">Вперёд →</button></div>';
 doc.body.append(backdrop,book);
 let bookTab='tools',bookPage=0;
 const pageItems=()=>RECIPE_PAGES.filter(entry=>entry.tab===bookTab);
 const names={log:'🪵 Бревно',branch:'🌿 Ветка',stone:'🪨 Камень',dry_grass:'🌾 Сухая трава'};
 function canCraftAfterWeight(entry){
  const spent=Object.entries(entry.ingredients??{}).reduce((sum,[id,count])=>sum+count*(ITEM_WEIGHT[id]??0),0);
  const output=entry.id==='axe'?ITEM_WEIGHT.axe:entry.id==='bench'?ITEM_WEIGHT.bench:ITEM_WEIGHT[entry.id]??0;
  return state.weight()-spent+output<=MAX_CARRY_WEIGHT;
 }
 function render(){
  if(book.hidden)return;
  book.querySelector('.fc-book-tabs').replaceChildren(...RECIPE_TABS.map(t=>{
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
   button.textContent=(entry.placement?'Поставить ':'Создать ')+entry.icon;
   button.disabled=!recipeAvailable(entry,state)||!canCraftAfterWeight(entry);
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
 function open(){
  if(!book.hidden)return;
  onOpen?.();
  ctx.storages?.close?.();
  book.hidden=false;backdrop.hidden=false;
  render();
  book.querySelector('[data-action="close"]').focus();
 }
 function close(){if(book.hidden)return;book.hidden=true;backdrop.hidden=true;doc.querySelector('.fc-bag-toggle')?.focus();}
 function toggleBook(){book.hidden?open():close();}
 backdrop.onclick=close;
 book.addEventListener('click',event=>{
  const action=event.target?.dataset?.action,tab=event.target?.dataset?.tab;
  if(action==='close'){close();return;}
  if(action==='previous'){bookPage=Math.max(0,bookPage-1);render();}
  if(action==='next'){bookPage=Math.min(pageItems().length-1,bookPage+1);render();}
  if(tab&&RECIPE_TABS.some(t=>t.id===tab)){bookTab=tab;bookPage=0;render();}
  if(action==='book-craft'){
   const id=event.target.dataset.recipe;
   if(id==='bench')craftBench();
   else if(id==='axe')craftAxe();
   else if(id==='potion:health'||id==='potion:stamina')ctx.vitals?.craftPotion?.(id);
   else if(['chest','rack'].includes(id)){
    if(!ctx.storages?.place(id))ctx.notify?.('Не хватает ресурсов или место занято','warning');
   }else if(['campfire','torch','table','fence','workbench'].includes(id)){
    if(!ctx.campStructures?.place(id))ctx.notify?.('Не хватает ресурсов или место занято','warning');
   }
   render();
  }
 });
 return {render,open,close,toggle:toggleBook,get isOpen(){return !book.hidden;}};
}
