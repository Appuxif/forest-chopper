// A full-screen input shield during the five-second fall, then a fading
// death overlay. Deliberately separate from the game's HUD and DEBUG tools.
export const DEATH_SCREEN_DELAY_MS=5000;
export function createDeathScreen(doc=document){
 const style=doc.createElement('style');
 style.textContent=`
 .fc-death-screen{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,0);
   display:flex;align-items:center;justify-content:center;pointer-events:auto;
   transition:background-color 1.1s ease;}
 .fc-death-screen[hidden]{display:none!important}
 .fc-death-screen.visible{background:rgba(6,9,8,.94)}
 .fc-death-content{opacity:0;transform:translateY(12px);text-align:center;
   transition:opacity .8s ease,transform .8s ease;font-family:system-ui,sans-serif;
   display:flex;align-items:center;flex-direction:column;gap:22px;color:#fff}
 .fc-death-screen.visible .fc-death-content{opacity:1;transform:translateY(0)}
 .fc-death-title{font-size:clamp(44px,10vw,86px);font-weight:800;letter-spacing:.09em;
   color:#e9c2b8;text-shadow:0 4px 24px #000c}
 .fc-death-respawn{padding:13px 35px;background:#315b43;color:white;
   border:1px solid #a5d2ad;border-radius:12px;font:600 19px system-ui;
   cursor:pointer;touch-action:manipulation}
 .fc-death-respawn:hover:not(:disabled){background:#477958}
 .fc-death-respawn:disabled{opacity:.6;cursor:default}
 @media(prefers-reduced-motion:reduce){
 .fc-death-screen,.fc-death-content{transition:none}
 }`;
 doc.head.append(style);
 const overlay=doc.createElement('section');
 overlay.className='fc-death-screen';
 overlay.hidden=true;
 overlay.setAttribute('role','dialog');
 overlay.setAttribute('aria-modal','true');
 overlay.setAttribute('aria-label','Вы умерли');
 const content=doc.createElement('div');
 content.className='fc-death-content';
 const title=doc.createElement('div');
 title.className='fc-death-title';title.textContent='УМЕР';
 const button=doc.createElement('button');
 button.type='button';button.className='fc-death-respawn';
 button.textContent='Возродиться';
 content.append(title,button);
 overlay.append(content);doc.body.append(overlay);
 let callback=null;
 button.addEventListener('click',()=>{if(!button.disabled)callback?.();});
 function begin(onRespawn){
   callback=onRespawn;
   // The invisible button must not be keyboard-activatable before 5 seconds.
   button.disabled=true;
   overlay.classList.remove('visible');
   overlay.hidden=false;
 }
 function show(canRespawn=true){
   button.disabled=!canRespawn;
   overlay.classList.add('visible');
 }
 function enable(enabled){button.disabled=!enabled;}
 function end(){overlay.hidden=true;overlay.classList.remove('visible');callback=null;}
 function dispose(){end();overlay.remove();style.remove();}
 return {begin,show,enable,end,dispose,get visible(){return overlay.classList.contains('visible')}};
}
