// Pointer-locked events are sent to the canvas. Resolve the UI under the
// screen centre explicitly and consume even clicks on the panel background.
export function createCorpseLootPointer(ctx,ui,{doc=document,viewport=()=>({width:innerWidth,height:innerHeight}),positionPanel=()=>{}}={}){
 let aim=null;
 function clear(){aim=null;ui.clearAim();}
 function update(){
  if(ui.panel.hidden){clear();return null;}
  positionPanel();
  const canvas=ctx.renderer?.domElement;
  if(!canvas||doc.pointerLockElement!==canvas){clear();return null;}
  const {width,height}=viewport();
  aim=ui.aimAt(width/2,height/2);return aim;
 }
 function handlePointer(event){
  if(event.pointerType!=='mouse'||!update())return false;
  event.preventDefault();event.stopImmediatePropagation();
  if(event.button===0)ui.clickAimed();
  return true;
 }
 return {update,handlePointer,clear,get aimed(){return !!aim?.inside;}};
}
