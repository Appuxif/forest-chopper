import {createInventoryModel,AXE_STATS,QUICK_SLOTS} from './inventory.js';
export function createInventory(ctx,doc=document){
 const state=createInventoryModel();
 const style=doc.createElement('style');
 style.textContent=[
 '.fc-hotbar{position:fixed;z-index:8;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:5px;background:#12241ddd;border:1px solid #9cba9b88;border-radius:12px;padding:6px}',
 '.fc-slot{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:58px;height:58px;background:#1e382ce8;border:1px solid #789b83;border-radius:8px;color:#fff;cursor:pointer;font-size:25px}',
 '.fc-slot small{position:absolute;bottom:3px;right:5px;font-size:11px;font-weight:bold;color:#fff;text-shadow:0 1px 2px #000}',
 '.fc-slot[data-selected=true]{outline:3px solid #e8c56a;outline-offset:-3px;background:#40553b}',
 '.fc-slot[data-moving=true]{outline:2px dashed #e9f4a4;outline-offset:-4px}',
 '.fc-slot .fc-key{position:absolute;top:2px;left:5px;font:10px system-ui;color:#d8e2d3}',
 '.fc-bag-toggle{position:fixed;z-index:8;left:calc(50% + 155px);bottom:25px;border-radius:10px;background:#1c3b2d;padding:11px;font-size:15px}',
 '.fc-bag{position:fixed;z-index:29;top:50%;left:50%;transform:translate(-50%,-50%);width:min(420px,calc(100vw - 20px));max-height:min(85dvh,650px);overflow:auto;background:#10251ff7;border:1px solid #a4c19c;border-radius:14px;padding:14px;box-shadow:0 20px 80px #000c;color:white}',
 '.fc-bag[hidden]{display:none}.fc-bag header{display:flex;align-items:center;justify-content:space-between;gap:10px}.fc-bag h2{font-size:20px;margin:0}',
 '.fc-bag .fc-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:15px 0}',
 '.fc-bag .fc-grid .fc-slot{width:100%;height:65px}.fc-bag button{border-radius:8px;padding:7px 10px}',
 '.fc-bag .fc-trash-slot{margin:8px 0;width:65px;height:55px;background:#532c2c;border:1px dashed #e5a3a3;font-size:24px}',
 '.fc-bag .fc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.fc-bag p,.fc-bag small{font-size:12px;line-height:1.5;color:#c7d7cd}',
 '@media(max-width:650px){.fc-hotbar{bottom:144px;padding:4px;gap:3px}.fc-hotbar .fc-slot{width:49px;height:49px;font-size:22px}.fc-bag-toggle{left:calc(50% + 113px);bottom:151px;padding:9px;font-size:13px}.fc-bag .fc-grid .fc-slot{height:58px}}'
 ].join('');
 doc.head.append(style);
 const bar=doc.createElement('div');bar.className='fc-hotbar';bar.setAttribute('aria-label','Быстрые слоты предметов');
 const toggle=doc.createElement('button');toggle.className='fc-bag-toggle';toggle.textContent='🎒 Сумка (I)';toggle.type='button';
 const bag=doc.createElement('section');bag.className='fc-bag';bag.hidden=true;bag.setAttribute('aria-label','Инвентарь');
 bag.innerHTML='<header><h2>🎒 Сумка</h2><button type="button" data-action="close" aria-label="Закрыть инвентарь">✕</button></header><p class="fc-bag-hint"></p><div class="fc-grid"></div><div class="fc-actions"><button type="button" data-action="craft">🔨 Скамейка: 3 🪵</button><button type="button" data-action="craft-axe">🪓 Топор: 3 🌿 + 2 🪨</button><button type="button" data-action="drop">📦 Выбросить выбранный стак</button><button type="button" data-action="pickup">⬆ Поднять топор (старые сохранения)</button></div><button type="button" class="fc-trash-slot fc-slot" data-action="trash" title="Удалить предмет без коробки">🗑️</button><p>Корзина: выбери предмет в сумке и нажми 🗑️, чтобы уничтожить его без коробки.</p><p>Нажми предмет, затем другой слот, чтобы переложить. Первые 4 ячейки — быстрые (1–4). Не более 5 брёвен в стопке. Чтобы рубить — выбери топор.</p><small>Предусмотрены уровни сумки и улучшения топора.</small>';
 doc.body.append(bar,toggle,bag);
 let moving=-1,groundMesh=null,lastSelected=null;
 const itemLabel=item=>!item?'':({axe:'🪓',bench:'🪑',log:'🪵',branch:'🌿',stone:'🪨'}[item.id]??'?');
 const itemTitle=item=>!item?'Пустой слот':item.id==='axe'?AXE_STATS[item.tier].name:item.id==='bench'?'Скамейка':({log:'Бревно',branch:'Ветки',stone:'Камни'}[item.id]??item.id)+' ×'+item.count;
 function slot(i,hot=false){
   const item=state.slots[i],b=doc.createElement('button');b.type='button';b.className='fc-slot';
   b.dataset.slot=String(i);b.title=itemTitle(item);
   b.setAttribute('aria-label',(hot?'Быстрый слот ':'Слот ')+(i+1)+': '+itemTitle(item));
   b.dataset.selected=String(hot&&i===state.selectedQuick);
   b.dataset.moving=String(i===moving);
   const icon=doc.createElement('span');icon.textContent=itemLabel(item);b.append(icon);
   if(hot){const key=doc.createElement('span');key.className='fc-key';key.textContent=i+1;b.append(key);}
   if(item&&item.id!=='axe'){const count=doc.createElement('small');count.textContent=hot&&item.id==='log'?state.wood():item.count;b.append(count);}
   b.onclick=()=>{if(hot){select(i);return;}if(moving<0)moving=i;else{if(moving!==i){if(ctx.isOnline?.())ctx.sendNet?.({type:'move_slot',from:moving,to:i});else state.move(moving,i);}moving=-1;changed({equip:false});}render();};
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
   bag.querySelector('.fc-grid').replaceChildren(...state.slots.map((_,i)=>slot(i)));
   bag.querySelector('.fc-bag-hint').textContent=state.slots.filter(Boolean).length+'/'+state.capacity()+
     ' слотов занято · '+state.wood()+' 🪵 · сумка '+state.bagTier+' ур. · '+(state.equipped()?state.axe().name:'Руки свободны');
   bag.querySelector('[data-action="craft"]').disabled=state.wood()<3||!state.hasSpace();
   bag.querySelector('[data-action="craft-axe"]').disabled=state.count('branch')<3||state.count('stone')<2;
   bag.querySelector('[data-action="drop"]').disabled=!state.slots[moving<0?state.selectedQuick:moving];
   bag.querySelector('[data-action="trash"]').disabled=!state.slots[moving<0?state.selectedQuick:moving];
   bag.querySelector('[data-action="pickup"]').disabled=!state.dropped||!nearDrop()||!!ctx.isOnline?.();
   ctx.axe.visible=!ctx.thirdPerson&&state.equipped();
   ctx.ownAvatar?.visual?.traverse?.(node=>{if(/^Axe (blade|handle)$/.test(node.name))node.visible=state.equipped();});
   if(ctx.$('wood'))ctx.$('wood').textContent=state.wood();
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
 function nearDrop(){const a=state.dropped;return !!a&&Math.hypot(ctx.px-a.x,ctx.pz-a.z)<=2.8;}
 function updateDropMesh(){
   if(groundMesh){ctx.scene.remove(groundMesh);groundMesh=null;}
   const a=state.dropped;if(!a)return;
   groundMesh=ctx.axe.clone(true);groundMesh.scale.setScalar(.55);
   groundMesh.position.set(a.x,.32,a.z);groundMesh.rotation.set(0,0,Math.PI/2);
   groundMesh.visible=true;ctx.scene.add(groundMesh);
 }
 function drop(){
   if(ctx.isOnline?.()||ctx.offlineSave?.suspended)return false;
   const x=ctx.px-Math.sin(ctx.yaw)*1.5,z=ctx.pz-Math.cos(ctx.yaw)*1.5;
   if(!state.dropAxe({x,z}))return false;
   updateDropMesh();changed();ctx.notify?.('Топор на земле. Подойди и нажми E.','info','axe-drop');return true;
 }
 function usedSlot(){return moving>=0?moving:state.selectedQuick;}
 function dropStack(){
   const slot=usedSlot();
   if(!state.slots[slot])return false;
   const ok=ctx.groundBoxes?.dropSlot?.(slot)??false;
   if(ok){moving=-1;render();ctx.notify?.('📦 Предмет выброшен. Коробка исчезнет через 60 минут.','info','box-drop');}
   return ok;
 }
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
   if(!state.craft('axe')){ctx.notify?.('Нет места для топора','warning','axe-craft-full');return false;}
   changed();ctx.notify?.('🪓 Топор скрафчен','success','axe-craft');return true;
 }
 function craftBench(){
   if(state.wood()<3)return false;
   if(ctx.isOnline?.()){
     ctx.sendNet?.({type:'craft_item',recipe:'bench'});return true;
   }
   if(!state.craftBench()){ctx.notify?.('Нет места для скамейки','warning','bench-full');return false;}
   ctx.wood=state.wood();changed();
   ctx.notify?.('🪑 Скамейка скрафчена — выбери её в быстром слоте','success','bench-craft');
   return true;
 }
 function pickup(){
   if(ctx.isOnline?.()||!nearDrop()||!state.pickupAxe())return false;
   updateDropMesh();changed();ctx.notify?.('Топор поднят в сумку','success','axe-pickup');return true;
 }
 let lastNear=false;
 function renderDropHint(){
   const near=nearDrop();
   if(near!==lastNear){lastNear=near;render();}
 }
 function restore(snapshot,wood=0){
   if(!state.restore(snapshot,wood))return false;
   moving=-1;updateDropMesh();changed({equip:false});ctx.buildMode=state.selected()==='log'||state.selected()==='bench';return true;
 }
 toggle.onclick=()=>{bag.hidden=!bag.hidden;if(!bag.hidden)render();};
 bag.addEventListener('click',event=>{
   const action=event.target?.dataset?.action;
   if(action==='close')bag.hidden=true;
   if(action==='craft')craftBench();
   if(action==='craft-axe')craftAxe();
   if(action==='drop')dropStack();
   if(action==='trash')trashStack();
   if(action==='pickup')pickup();
 });
 render();
 function acceptServer(snapshot,wood){
   if(!state.restore(snapshot,wood))return false;
   moving=-1;updateDropMesh();render();
   ctx.buildMode=state.selected()==='log'||state.selected()==='bench';
   ctx.disposePreview?.();return true;
 }
 return {state,render,select,syncWood,drop,dropStack,trashStack,pickup,restore,acceptServer,craftBench,craftAxe,nearDrop,renderDropHint,
   get isOpen(){return !bag.hidden;},toggle(){toggle.click();},close(){bag.hidden=true;},
   clearWorld(){if(groundMesh){ctx.scene.remove(groundMesh);groundMesh=null;}},
   serialize:()=>state.serialize(),get equipped(){return state.equipped();},
   get axe(){return state.axe();},get selected(){return state.selected();}};
}
