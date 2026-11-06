// Browser-only exercise for the real player controller, animated root motion,
// ragdoll physics and standing back up. This module deliberately never steps
// Rapier directly: requestAnimationFrame in player.js is the simulation owner.
const DIRECTIONS=[
 {name:'forward',keys:['KeyW']},
 {name:'forward-right',keys:['KeyW','KeyD']},
 {name:'right',keys:['KeyD']},
 {name:'back-right',keys:['KeyS','KeyD']},
 {name:'back',keys:['KeyS']},
 {name:'back-left',keys:['KeyS','KeyA']},
 {name:'left',keys:['KeyA']},
 {name:'forward-left',keys:['KeyW','KeyA']},
];
const TIME_DEFAULTS={walkMs:650,runMs:950,ragdollMs:2800,recoverMs:700};
const rounded=n=>Math.round(n*100)/100;

export function createRagdollStress(ctx,{press,releaseAll,wait,now=()=>performance.now(),
 log=console}={}){
 let controller=null,report={status:'not_started'};
 const state=()=>({...report,
  ...(report.cycles?{cycles:report.cycles.map(c=>({...c}))}:{})});
 function ensureCanStart(count,options){
  if(controller)throw Error('Ragdoll stress test is already running');
  if(!Number.isSafeInteger(count)||count<1||count>1000)throw Error('N must be an integer from 1 to 1000');
  if(!options||typeof options!=='object'||Array.isArray(options))throw Error('Options must be an object');
  for(const [name,value] of Object.entries({...TIME_DEFAULTS,...options})){
   if(!Object.hasOwn(TIME_DEFAULTS,name))throw Error('Unknown ragdoll stress option: '+name);
   if(!Number.isInteger(value)||value<0||value>30000)
    throw Error(name+' must be an integer from 0 to 30000 ms');
  }
  if(ctx.isOnline?.())throw Error('Run this stress test offline to avoid modifying a multiplayer world');
  if(!ctx.ownAvatar)throw Error('Player avatar is not loaded');
  if(ctx.deathSystem?.active)throw Error('Respawn before starting stress test');
  if(ctx.debugCheats?.flying)throw Error('Disable debug flight before running stress test');
  if(ctx.ragdoll?.active||ctx.ragdollControls?.mode!=='none'||ctx.ragdollControls?.busy)
   throw Error('Get up from the current ragdoll before running the test');
  const failed=ctx.ragdoll?.state?.().physicsError;
  if(failed)throw Error('Rapier is already unavailable until reload: '+failed);
 }
 const pos=()=>({x:rounded(ctx.px),y:rounded(ctx.feetY),z:rounded(ctx.pz)});
 const physicsError=()=>ctx.ragdoll?.state?.().physicsError;
 const check=()=>{
  if(physicsError())throw Error('Rapier world.step failed: '+physicsError());
  if(ctx.deathSystem?.active)throw Error('Character died during stress test');
 };
 async function holdDirection(direction,duration,sprint,signal){
  releaseAll();
  for(const key of direction.keys)press(key);
  if(sprint)press('ShiftLeft');
  try{await wait(duration,signal);check();}
  finally{releaseAll();}
 }
 async function observeFall(milliseconds,signal){
  // Poll even while the character is falling. On a WASM panic the game
  // deactivates ragdoll, and the next iteration must never hide that failure.
  let left=milliseconds;
  do{
   check();
   if(!ctx.ragdoll?.active)throw Error('Ragdoll unexpectedly deactivated');
   const slice=Math.min(100,left);
   if(slice<=0)break;
   await wait(slice,signal);
   left-=slice;
  }while(left>0);
  check();
  if(!ctx.ragdoll?.active)throw Error('Ragdoll unexpectedly deactivated');
 }
 async function run(count=10,options={}){
  ensureCanStart(count,options);
  const timings={...TIME_DEFAULTS,...options};
  const signalController=new AbortController();
  controller=signalController;
  const signal=signalController.signal;
  const startYaw=ctx.yaw;
  const start=now();
  report={status:'running',requested:count,completed:0,cycle:0,phase:'starting',
   startedAt:Date.now(),elapsedMs:0,position:pos(),error:null,cycles:[]};
  try{
   for(let i=0;i<count;i++){
    if(signal.aborted)throw Error('Cancelled');
    report.cycle=i+1;
    const walk=DIRECTIONS[i%8],run=DIRECTIONS[(i+3)%8];
    const begin=pos(),cycleStarted=now();
    const sample={cycle:i+1,walk:walk.name,run:run.name,start:begin,
     walkAnimation:null,runAnimation:null};
    try{
     // Rotate between cycles as well as moving in different local directions.
     ctx.yaw=startYaw+((i*3)%8)*Math.PI/4;
     report.phase='walking';
     await holdDirection(walk,timings.walkMs,false,signal);
     sample.walkAnimation=ctx.ownAvatar?.lowerState??null;

     ctx.yaw+=i%2===0?.45:-.45;
     report.phase='running';
     await holdDirection(run,timings.runMs,true,signal);
     sample.runAnimation=ctx.ownAvatar?.lowerState??null;
     sample.beforeFall=pos();

     report.phase='falling';
     const activated=await ctx.ragdollControls.ragdoll();
     if(!activated)throw Error('Ragdoll activation failed: '+(physicsError()??'unknown reason'));
     await observeFall(timings.ragdollMs,signal);

     report.phase='getting_up';
     if(!ctx.ragdollControls.getUp()||ctx.ragdoll?.active)
      throw Error('Unable to get up from ragdoll');
     await wait(timings.recoverMs,signal);
     check();
     if(ctx.ragdoll?.active||ctx.ragdollControls.mode!=='none')
      throw Error('Ragdoll did not return to normal movement');
     sample.status='passed';
     sample.end=pos();
     sample.distance=rounded(Math.hypot(sample.end.x-begin.x,sample.end.z-begin.z));
     sample.elapsedMs=Math.round(now()-cycleStarted);
     report.completed++;
     if((i+1)%5===0||i+1===count)
      log.info?.('[Forest Chopper] Ragdoll stress:',report.completed+'/'+count,'cycles passed');
    }catch(error){
     sample.status=signal.aborted?'cancelled':'failed';
     sample.error=String(error?.message??error);
     sample.phase=report.phase;
     sample.physicsError=physicsError()??null;
     sample.end=pos();
     sample.elapsedMs=Math.round(now()-cycleStarted);
     throw Object.assign(error,{stressSample:sample});
    }finally{
     if(report.cycles.length<100)report.cycles.push(sample);
     else if(sample.status!=='passed')report.cycles.push(sample);
     report.position=pos();
    }
   }
   report.status='completed';
  }catch(error){
   report.status=signal.aborted?'cancelled':'failed';
   report.error=String(error?.message??error);
   if(report.status==='failed')log.error?.('[Forest Chopper] Ragdoll stress failed',state());
  }finally{
   releaseAll();
   if((ctx.ragdoll?.active||ctx.ragdollControls?.mode!=='none')
     &&!ctx.deathSystem?.active){
    try{ctx.ragdollControls.getUp();}catch(error){
     report.cleanupError=String(error?.message??error);
    }
   }
   ctx.yaw=startYaw;
   report.phase='done';
   report.elapsedMs=Math.round(now()-start);
   report.finishedAt=Date.now();
   controller=null;
  }
  return state();
 }
 function cancel(){
  if(controller){controller.abort();releaseAll();}
  return state();
 }
 return {run,cancel,status:state};
}
