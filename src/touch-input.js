// Joystick is bound to exactly one active pointer. Additional fingers can use camera/buttons.
export function createTouchJoystick(ctx,stick,knob) {
  let pointerId=null;
  const reset=()=>{
    pointerId=null;
    stick.setAttribute?.('data-active','false');
    ctx.joyX=ctx.joyY=0;
    knob.style.transform='translate(0,0)';
  };
  function move(e){
    if(e.pointerId!==pointerId)return;
    const rect=stick.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const dx=e.clientX-rect.left-rect.width/2;
    const dy=e.clientY-rect.top-rect.height/2;
    const length=Math.hypot(dx,dy);
    const factor=Math.min(1,48/Math.max(1,length));
    ctx.joyX=dx*factor/48;ctx.joyY=dy*factor/48;
    knob.style.transform=`translate(${ctx.joyX*40}px,${ctx.joyY*40}px)`;
  }
  stick.addEventListener('pointerdown',e=>{
    if(pointerId!==null)return;
    e.preventDefault();
    pointerId=e.pointerId;
    stick.setAttribute?.('data-active','true');
    stick.setPointerCapture?.(e.pointerId);
    move(e);
  });
  stick.addEventListener('pointermove',move);
  const finish=e=>{if(e.pointerId===pointerId)reset();};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(type,finish);
  return {reset,get pointerId(){return pointerId;}};
}
