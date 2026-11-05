// Warn when a running game is being closed/reloaded (Ctrl+W, Ctrl+R, etc.).
// Browsers show their own wording and require prior user interaction.
export function installGameLeaveGuard(target=window,{doc=target.document,keyboard=target.navigator?.keyboard}={}){
  let intentionalExit=false,disposed=false,locked=false;
  const onBeforeUnload=event=>{
    if(intentionalExit)return;
    event.preventDefault();
    event.returnValue=true; // Legacy fallback for browsers requiring a value.
  };
  const onKeydown=event=>{
    if(intentionalExit||!(event.ctrlKey||event.metaKey)||event.altKey)return;
    if(['KeyR','KeyW'].includes(event.code)||['r','w'].includes(event.key?.toLowerCase()))event.preventDefault();
    // Keep ordinary game handling: Ctrl+W can still mean forward movement.
  };
  const releaseKeyboard=()=>{if(locked){keyboard?.unlock?.();locked=false;}};
  const syncKeyboard=async()=>{
    if(!doc?.fullscreenElement||intentionalExit||disposed){releaseKeyboard();return;}
    if(!keyboard?.lock)return;
    try{
      await keyboard.lock(['KeyR','KeyW']);
      if(disposed||intentionalExit||!doc.fullscreenElement){keyboard.unlock();return;}
      locked=true;
    }catch{/* Permission denied or unsupported: beforeunload remains active. */}
  };
  target.addEventListener('beforeunload',onBeforeUnload);
  target.addEventListener('keydown',onKeydown,{capture:true});
  doc?.addEventListener('fullscreenchange',syncKeyboard);
  syncKeyboard();
  return {
    allowIntentionalExit(){intentionalExit=true;releaseKeyboard();},
    dispose(){disposed=true;releaseKeyboard();target.removeEventListener('beforeunload',onBeforeUnload);target.removeEventListener('keydown',onKeydown,{capture:true});doc?.removeEventListener('fullscreenchange',syncKeyboard);},
  };
}
