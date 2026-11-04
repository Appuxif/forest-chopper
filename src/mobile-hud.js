// Secondary mobile actions reuse the existing controls and their validation.
export function createMobileHud(doc=document,settings){
 const toggle=doc.createElement('button');toggle.id='mobile-menu-toggle';toggle.type='button';
 toggle.textContent='⋮';toggle.setAttribute('aria-label','Меню игры');toggle.setAttribute('aria-expanded','false');
 const panel=doc.createElement('nav');panel.id='mobile-menu';panel.hidden=true;panel.setAttribute('aria-label','Действия игры');
 toggle.setAttribute('aria-controls',panel.id);
 const close=()=>{panel.hidden=true;toggle.setAttribute('aria-expanded','false');};
 for(const [label,selector] of [['🎒 Инвентарь','.fc-bag-toggle'],['⚙ Настройки','.fc-settings-toggle'],['👤 Камера','#viewtoggle'],['🏆 Прогресс','.fc-progress-toggle'],['💬 Чат','#chattoggle'],['🦴 Ragdoll','#fc-ragdoll-btn'],['🎮 Читы','#fc-cheats-toggle'],['📊 Профиль рендера','#fc-profiler-toggle'],['🌐 Онлайн','#nettoggle'],['☰ Главное меню','#menu-backgame'],['↻ Новый лес','#reset']]){
  if(selector.startsWith('#fc-')&&selector!=='#fc-ragdoll-btn'&&!doc.location?.pathname.includes('debug'))continue;
  const button=doc.createElement('button');button.type='button';button.textContent=label;
  button.onclick=()=>{close();const target=doc.querySelector(selector);if(!target||target.disabled||target.hidden)return;if(selector==='#reset'&&!confirm('Создать новый лес в текущем слоте?'))return;target.click();};panel.append(button);
 }
 const diagnostics=doc.createElement('button');diagnostics.type='button';diagnostics.textContent='FPS / диагностика';diagnostics.onclick=()=>{settings.setShowFps(!settings.showFps);diagnostics.setAttribute('aria-pressed',String(settings.showFps));close();};panel.append(diagnostics);
 toggle.onclick=()=>{diagnostics.setAttribute('aria-pressed',String(settings.showFps));panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));};
 doc.addEventListener('pointerdown',e=>{if(!panel.hidden&&!panel.contains(e.target)&&e.target!==toggle)close();});
 doc.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){close();toggle.focus();}});
 doc.body.append(toggle,panel);
}
