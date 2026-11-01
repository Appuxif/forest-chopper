import {isStructureItem} from './structure-items.js';
import {RECIPE_TABS,RECIPE_PAGES,recipeAvailable} from './recipe-book.js';
import {MAX_CARRY_WEIGHT,ITEM_WEIGHT} from './inventory.js';
import {itemDisplayName,itemDisplayIcon} from './item-display.js';

export const RECIPES_PER_SPREAD=5;
export const recipeSpread=(entries,pageIndex)=>
 entries.slice(pageIndex*RECIPES_PER_SPREAD,(pageIndex+1)*RECIPES_PER_SPREAD);

// Compact master-detail recipe book: up to five selectable recipes on the
// left, full details and the single crafting action on the right.
export function createRecipeBook({ctx,state,craftAxe,craftBench,onOpen},doc=document){
 const style=doc.createElement('style');
 style.textContent=[
  '.fc-book-backdrop{position:fixed;inset:0;z-index:39;background:#080e0bc2}',
  '.fc-book-window{position:fixed;z-index:40;top:50%;left:50%;transform:translate(-50%,-50%);width:min(690px,calc(100vw - 20px));max-height:86dvh;overflow:auto;background:#e9d9b5;color:#42321d;border:4px double #8e6944;border-radius:13px;padding:12px;box-sizing:border-box;box-shadow:0 20px 65px #000c,inset 0 0 22px #a0784828;font:13px system-ui}',
  '.fc-book-window[hidden],.fc-book-backdrop[hidden]{display:none}',
  '.fc-book-window header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}',
  '.fc-book-window h2{font:700 21px Georgia,serif;margin:0}.fc-book-window h3{font:700 17px Georgia,serif;margin:0 0 8px}',
  '.fc-book-window button{color:#3a3020;background:#f5e8cd;border:1px solid #aa8b5d;border-radius:7px;padding:7px 10px;cursor:pointer}',
  '.fc-book-window button:disabled{opacity:.4;cursor:default}',
  '.fc-book-window button:focus-visible{outline:2px solid #7a552c;outline-offset:2px}',
  '.fc-book-window .fc-book-tabs{display:flex;gap:5px;flex-wrap:wrap}',
  '.fc-book-window .fc-book-tabs button{font-size:12px;padding:6px 9px}',
  '.fc-book-window .fc-book-tabs button[aria-selected=true]{background:#c99b5a;font-weight:700;border-color:#76502d}',
  '.fc-book-window .fc-book-leaves{display:grid;grid-template-columns:minmax(0,0.95fr) minmax(0,1.15fr);gap:10px;margin:9px 0}',
  '.fc-book-window .fc-book-leaf{padding:11px;background:#f6e9c9;border:1px solid #d1b887;box-shadow:inset 0 0 12px #bf99542c;min-width:0}',
  '.fc-book-window .fc-book-index{display:flex;flex-direction:column;gap:5px}',
  '.fc-book-window .fc-book-index h3{margin-bottom:4px}',
  '.fc-book-window .fc-book-recipe{display:flex;align-items:center;gap:9px;width:100%;min-height:49px;text-align:left;padding:6px 8px;border-color:#d5ba8c;background:#fcf3de}',
  '.fc-book-window .fc-book-recipe[aria-pressed=true]{background:#dfbd82;border-color:#9a713b;box-shadow:inset 3px 0 #875b2c}',
  '.fc-book-window .fc-book-recipe-icon{font-size:25px;flex:none;width:33px;height:33px;display:inline-flex;align-items:center;justify-content:center}',
  '.fc-book-window .fc-book-recipe-copy{min-width:0;display:flex;flex-direction:column;gap:2px}',
  '.fc-book-window .fc-book-recipe-name{font-weight:700;line-height:1.2;overflow-wrap:anywhere}',
  '.fc-book-window .fc-book-recipe-status{font-size:11px;color:#675943}',
  '.fc-book-window .fc-book-recipe-status[data-ready=true]{color:#346638}',
  '.fc-book-window .fc-book-detail-head{display:flex;align-items:center;gap:9px;margin-bottom:6px}',
  '.fc-book-window .fc-book-icon{font-size:33px;line-height:1;width:45px;height:45px;display:inline-flex;align-items:center;justify-content:center}',
  '.fc-book-window .fc-book-detail-head h3{margin:0}',
  '.fc-book-window .fc-book-description{margin:6px 0 10px;line-height:1.4;color:#59492d}',
  '.fc-book-window .fc-book-cost{padding:3px 0;font-size:12px;display:flex;align-items:center;gap:3px}.fc-book-material-icon{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;font-size:16px;flex:none}',
  '.fc-book-window .fc-book-cost[data-missing=true]{color:#ad3425;font-weight:700}',
  '.fc-book-window .fc-book-cost[data-missing=false]{color:#38633f}',
  '.fc-book-window .fc-book-effects{display:flex;flex-wrap:wrap;gap:4px;margin:9px 0}',
  '.fc-book-window .fc-book-effect{font-size:11px;padding:3px 6px;border:1px solid #ddc396;border-radius:5px;color:#59492d;background:#f9eccd}',
  '.fc-book-window [data-action="book-craft"]{margin-top:10px;background:#795b38;color:#fff6db;font-weight:700;min-width:120px}',
  '.fc-book-window .fc-book-note{font-size:12px;color:#765a3b;margin:10px 0 0}',
  '.fc-book-window .fc-book-nav{display:flex;align-items:center;justify-content:space-between;gap:10px}',
  '.fc-book-window .fc-book-position{font-size:12px;color:#765a3b}',
  '@media(max-width:560px){.fc-book-window{width:calc(100vw - 12px);max-height:88dvh;padding:9px}.fc-book-window h2{font-size:18px}.fc-book-window .fc-book-tabs button{font-size:11px;padding:5px 7px}.fc-book-window .fc-book-leaves{grid-template-columns:1fr;gap:7px;margin:7px 0}.fc-book-window .fc-book-leaf{padding:8px}.fc-book-window .fc-book-index{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}.fc-book-window .fc-book-index h3{grid-column:1/-1;margin-bottom:2px}.fc-book-window .fc-book-recipe{min-height:40px;gap:5px;padding:5px}.fc-book-window .fc-book-recipe-icon{font-size:19px}.fc-book-window .fc-book-recipe-name{font-size:11px}.fc-book-window .fc-book-recipe-status{font-size:10px}.fc-book-window .fc-book-icon{font-size:25px}.fc-book-window .fc-book-description{margin:4px 0 6px}.fc-book-window .fc-book-effects{margin:6px 0}.fc-book-window [data-action="book-craft"]{margin-top:5px}}'
 ].join('');
 doc.head.append(style);
 const backdrop=doc.createElement('div');backdrop.className='fc-book-backdrop';backdrop.hidden=true;
 const book=doc.createElement('section');
 book.className='fc-book-window';book.hidden=true;book.setAttribute('role','dialog');
 book.setAttribute('aria-modal','true');book.setAttribute('aria-label','Книга рецептов');
 book.innerHTML='<header><h2>📖 Книга рецептов</h2><button type="button" data-action="close" aria-label="Закрыть книгу">✕</button></header><div class="fc-book-tabs" role="tablist"></div><div class="fc-book-leaves"></div><div class="fc-book-nav"><button type="button" data-action="previous">← Назад</button><span class="fc-book-position"></span><button type="button" data-action="next">Вперёд →</button></div>';
 doc.body.append(backdrop,book);
 let bookTab='tools',pageIndex=0,selectedRecipeId=null;
 const tabEntries=()=>RECIPE_PAGES.filter(entry=>entry.tab===bookTab);
 const pageCount=entries=>Math.max(1,Math.ceil(entries.length/RECIPES_PER_SPREAD));
 function canCraftAfterWeight(entry){
  const spent=Object.entries(entry.ingredients??{}).reduce((sum,[id,count])=>sum+count*(ITEM_WEIGHT[id]??0),0);
  const output=entry.id==='axe'?ITEM_WEIGHT.axe:entry.id==='bench'?ITEM_WEIGHT.bench:ITEM_WEIGHT[entry.id]??0;
  return state.weight()-spent+output<=MAX_CARRY_WEIGHT;
 }
 const canCraft=entry=>recipeAvailable(entry,state)&&(isStructureItem(entry.id)?state.canCraftStructure(entry.id):canCraftAfterWeight(entry));
 function recipeStatus(entry){
  if(entry.planned)return 'Скоро';
  if(entry.guide)return 'Схема';
  if(!recipeAvailable(entry,state))return 'Не хватает материалов';
  if(!canCraft(entry))return 'Нет места или превышен вес';
  return 'Можно создать';
 }
 function iconNode(id,fallback,cls){
  const el=doc.createElement('span');el.className=cls;
  const src=ctx.inventory?.getIcon?.(id==='axe'?'axe:0':id);
  if(src){
   const img=doc.createElement('img');img.src=src;img.alt='';img.draggable=false;
   img.style.cssText='display:block;width:100%;height:100%;object-fit:contain';
   el.append(img);
  }else el.textContent=fallback;
  return el;
 }
 function render(){
  if(book.hidden)return;
  const tabs=book.querySelector('.fc-book-tabs');
  tabs.replaceChildren(...RECIPE_TABS.map(t=>{
   const button=doc.createElement('button');button.type='button';button.dataset.tab=t.id;
   button.textContent=t.icon+' '+t.name;button.setAttribute('role','tab');
   button.setAttribute('aria-selected',String(bookTab===t.id));
   return button;
  }));
  const entries=tabEntries(),totalPages=pageCount(entries);
  pageIndex=Math.max(0,Math.min(pageIndex,totalPages-1));
  const visible=recipeSpread(entries,pageIndex);
  if(!visible.some(entry=>entry.id===selectedRecipeId))
   selectedRecipeId=visible[0]?.id??null;
  const entry=visible.find(e=>e.id===selectedRecipeId);
  const left=doc.createElement('article');left.className='fc-book-leaf fc-book-index';
  const leftHeading=doc.createElement('h3');leftHeading.textContent='Рецепты';left.append(leftHeading);
  for(const candidate of visible){
   const button=doc.createElement('button');button.type='button';
   button.className='fc-book-recipe';button.dataset.recipeId=candidate.id;
   button.setAttribute('aria-pressed',String(candidate.id===selectedRecipeId));
   const icon=iconNode(candidate.id,candidate.icon,'fc-book-recipe-icon');
   const copy=doc.createElement('span');copy.className='fc-book-recipe-copy';
   const name=doc.createElement('span');name.className='fc-book-recipe-name';name.textContent=candidate.name;
   const status=doc.createElement('span');status.className='fc-book-recipe-status';
   status.dataset.ready=String(canCraft(candidate));status.textContent=recipeStatus(candidate);
   copy.append(name,status);button.append(icon,copy);left.append(button);
  }
  const right=doc.createElement('article');right.className='fc-book-leaf fc-book-details';
  if(entry){
   const head=doc.createElement('div');head.className='fc-book-detail-head';
   const icon=iconNode(entry.id,entry.icon,'fc-book-icon');
   const heading=doc.createElement('h3');heading.textContent=entry.name;
   head.append(icon,heading);right.append(head);
   const description=doc.createElement('p');description.className='fc-book-description';description.textContent=entry.description;
   right.append(description);
   if(entry.ingredients){
    const h=doc.createElement('h3');h.textContent='Материалы';right.append(h);
    for(const [id,n] of Object.entries(entry.ingredients)){
     const row=doc.createElement('div');row.className='fc-book-cost';
     row.dataset.missing=String(state.count(id)<n);
     row.append(iconNode(id,itemDisplayIcon(id),'fc-book-material-icon'),
       doc.createTextNode(' '+itemDisplayName(id)+': '+state.count(id)+' / '+n));
     right.append(row);
    }
   }
   if(entry.effects?.length){
    const effects=doc.createElement('div');effects.className='fc-book-effects';
    for(const effect of entry.effects){
     const row=doc.createElement('span');row.className='fc-book-effect';row.textContent='✦ '+effect;effects.append(row);
    }
    right.append(effects);
   }
   if(entry.craftable){
    const button=doc.createElement('button');button.type='button';button.dataset.action='book-craft';button.dataset.recipe=entry.id;
    button.textContent='Создать';
    button.disabled=!canCraft(entry);
    right.append(button);
   }else{
    const note=doc.createElement('p');note.className='fc-book-note';
    note.textContent=entry.planned?'🔒 Рецепт появится в следующем обновлении':'📜 Схема: укладывай брёвна вручную';
    right.append(note);
   }
  }
  book.querySelector('.fc-book-leaves').replaceChildren(left,right);
  book.querySelector('.fc-book-position').textContent='Страница '+(pageIndex+1)+' / '+totalPages;
  book.querySelector('[data-action="previous"]').disabled=pageIndex===0;
  book.querySelector('[data-action="next"]').disabled=pageIndex>=totalPages-1;
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
  const recipeButton=event.target?.closest?.('[data-recipe-id]');
  if(recipeButton){
   const visible=recipeSpread(tabEntries(),pageIndex);
   if(!visible.some(e=>e.id===recipeButton.dataset.recipeId))return;
   selectedRecipeId=recipeButton.dataset.recipeId;render();
   [...book.querySelectorAll('[data-recipe-id]')].find(b=>b.dataset.recipeId===selectedRecipeId)?.focus();
   return;
  }
  const action=event.target?.dataset?.action,tab=event.target?.dataset?.tab;
  if(action==='close'){close();return;}
  if(action==='previous'&&pageIndex>0){pageIndex--;selectedRecipeId=null;render();return;}
  if(action==='next'&&pageIndex<pageCount(tabEntries())-1){pageIndex++;selectedRecipeId=null;render();return;}
  if(tab&&RECIPE_TABS.some(t=>t.id===tab)){
   bookTab=tab;pageIndex=0;selectedRecipeId=null;render();return;
  }
  if(action==='book-craft'){
   const id=event.target.dataset.recipe;
   const entry=tabEntries().find(candidate=>candidate.id===id);
   // Prevent actions for a hidden/outdated selection after switching pages.
   if(!entry||entry.id!==selectedRecipeId||!canCraft(entry))return;
   if(id==='bench')craftBench();
   else if(id==='axe')craftAxe();
   else if(id==='potion:health'||id==='potion:stamina')ctx.vitals?.craftPotion?.(id);
   else if(isStructureItem(id))ctx.inventory?.craftStructure?.(id);
   render();
  }
 });
 return {render,open,close,toggle:toggleBook,get isOpen(){return !book.hidden;}};
}
