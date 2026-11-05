export function createCorpseLootPanel({doc,onTake,onClose,onTakeAllDone,itemLabel}){
 const panel=doc.createElement('section');panel.className='hen-loot corpse-loot';panel.hidden=true;
 panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Добыча');
 let record=null,selected=null,signature=null,rows=[];
 const items=value=>Object.entries(value?.loot??{}).filter(([,count])=>Number.isFinite(count)&&count>0);
 const label=(id)=>itemLabel?.(id)??id;
 function highlight(){for(const row of rows){const active=row.dataset.item===selected;row.classList.toggle('selected',active);row.setAttribute('aria-selected',String(active));}}
 function render(value){
  record=value;const available=items(value);
  if(!available.some(([id])=>id===selected))selected=available[0]?.[0]??null;
  const next=JSON.stringify([value?.id,value?.displayName,value?.name,available]);
  if(next===signature){highlight();return;}
  signature=next;rows=[];panel.replaceChildren();
  const title=doc.createElement('h3');title.textContent=value?.displayName||value?.name||'Добыча';panel.append(title);
  for(const [id,count] of available){
   const text=label(id),b=doc.createElement('button');b.className='hen-loot-row corpse-loot-row';b.dataset.item=id;
   b.textContent=`${text} ×${count} · E`;b.setAttribute('aria-label',`${text} ×${count} — забрать`);
   b.onpointerenter=()=>{selected=id;highlight();};b.onfocus=()=>{selected=id;highlight();};b.onclick=()=>{selected=id;activate(id);};rows.push(b);panel.append(b);
  }
  if(!available.length){const p=doc.createElement('p');p.textContent='Пусто';panel.append(p);}
  else{const all=doc.createElement('button');all.textContent='Забрать всё · R';all.onclick=takeAll;panel.append(all);}
  const close=doc.createElement('button');close.textContent='Закрыть';close.onclick=onClose;panel.append(close);highlight();
 }
 function cycle(delta){if(!rows.length||!delta)return;const index=rows.findIndex(r=>r.dataset.item===selected);selected=rows[(index+(delta>0?1:-1)+rows.length)%rows.length].dataset.item;highlight();}
 function activate(id){if(record&&id&&record.loot?.[id]>0)return onTake(record.id,id);}
 function takeSelected(){return activate(selected);}
 function takeAll(){if(!record)return;for(const [id] of items(record))activate(id);onTakeAllDone?.();}
 return {panel,render,cycle,takeSelected,takeAll,get selected(){return selected;}};
}
