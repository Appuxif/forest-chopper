// A corpse dialog uses a real cursor. Restore only a lock that this dialog
// released, and never fight Escape, another modal, death or a background tab.
export function createCorpseLootPointer(ctx,{doc=document}={}){
 let active=false,restore=false;
 const canvas=()=>ctx.renderer?.domElement;
 const hint=()=>ctx.notify?.('Нажмите по игре, чтобы продолжить','info');
 function open(){
  if(active)return;
  active=true;restore=!!canvas()&&doc.pointerLockElement===canvas();
  if(restore)doc.exitPointerLock?.();
  ctx.drag=null;
  for(const key in ctx.keys??{})ctx.keys[key]=false;
 }
 function close(returnPointer=false){
  const wanted=active&&restore&&returnPointer;active=false;restore=false;
  if(!wanted||doc.hasFocus?.()===false||ctx.deathSystem?.active||ctx.inventory?.isOpen||ctx.inventory?.isBookOpen||ctx.storages?.opened!=null)return;
  if(doc.pointerLockElement===canvas())return;
  try{
   const result=canvas()?.requestPointerLock?.();
   result?.catch?.(hint);
  }catch{hint();}
 }
 function handlePointer(event){
  if(!active)return false;
  event.preventDefault?.();event.stopImmediatePropagation?.();return true;
 }
 return {open,close,handlePointer};
}
