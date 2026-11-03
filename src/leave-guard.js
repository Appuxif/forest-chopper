// Warn when a running game is being closed/reloaded (Ctrl+W, Ctrl+R, etc.).
// Browsers show their own wording and require prior user interaction.
export function installGameLeaveGuard(target=window){
  let intentionalExit=false;
  const onBeforeUnload=event=>{
    if(intentionalExit)return;
    event.preventDefault();
    event.returnValue=true; // Legacy fallback for browsers requiring a value.
  };
  target.addEventListener('beforeunload',onBeforeUnload);
  return {
    allowIntentionalExit(){intentionalExit=true;},
    dispose(){target.removeEventListener('beforeunload',onBeforeUnload);},
  };
}
