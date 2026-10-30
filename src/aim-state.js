// Visual-only state: the server/physics still decide if an action succeeds.
export function aimState(buildMode, tree, placementError='') {
  if (buildMode) return {kind:placementError?'blocked':'build',
    text:placementError?'×':'◇',
    label:placementError?'Нельзя установить бревно':'Место установки бревна'};
  if (tree?.userData?.hp>0) return {kind:'tree',text:'✳',
    label:tree.userData.species==='birch'?'Прицел на берёзе':'Прицел на дереве'};
  return {kind:'idle',text:'+',label:'Прицел'};
}
export function updateCrosshair(el, state) {
  if (!el || el.dataset.kind===state.kind) return;
  el.dataset.kind=state.kind;
  el.textContent=state.text;
  el.setAttribute('aria-label',state.label);
}
