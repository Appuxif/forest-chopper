// Visual-only state: the server/physics still decide if an action succeeds.
export function aimState(buildMode, tree, placementError='', pickup=null, mob=null,{pursuing=false,ui=null}={}) {
  if(ui?.inside)return {kind:'ui',text:ui.actionable?'⌑':'+',label:ui.label};
  if (buildMode) return {kind:placementError?'blocked':'build',
    text:placementError?'×':'◇',
    label:placementError?'Нельзя установить бревно':'Место установки бревна'};
  if(mob?.hp>0) return {kind:'mob',text:'⌑',
    label:'Можно атаковать: '+(mob.displayName??mob.name??'Существо')};
  if(pursuing)return {kind:'idle',text:'+',label:'Прицел'};
  if(pickup?.empty)return {kind:'empty',text:'⌑',label:pickup.label+' · Пусто'};
  if (tree?.userData?.hp>0) return {kind:'tree',text:'✳',
    label:tree.userData.species==='birch'?'Прицел на берёзе':'Прицел на дереве'};
  if(pickup) return {kind:'pickup',text:'⌑',
    label:'Можно поднять: '+pickup.label};
  return {kind:'idle',text:'+',label:'Прицел'};
}
export function updateCrosshair(el, state) {
  if (!el || (el.dataset.kind===state.kind&&el.dataset.label===state.label)) return;
  el.dataset.kind=state.kind;
  el.dataset.label=state.label;
  el.textContent=state.text;
  el.setAttribute('aria-label',state.label);
  // The mob indication travels with the JS update, including pages that still
  // have the older HTML stylesheet. Clear overrides when leaving the target.
  if(el.style){
    const attacking=state.kind==='mob';
    const overPanel=state.kind==='ui';
    el.style.zIndex=overPanel?'1003':'';
    el.style.pointerEvents='none';
    el.style.color=attacking?'#ff7979':'';
    el.style.textShadow=attacking?'0 0 8px #ff4545,0 1px 3px #000':'';
    el.style.scale=attacking?'1.35':'';
    el.style.transition=attacking?'none':'';
  }
}
