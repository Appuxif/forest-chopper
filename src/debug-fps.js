// Debug-only sampler: counts actual WebGL renders, not uncapped physics ticks.
// One wall-clock window per sample; bounded to the last 120 complete seconds.
export const FPS_HISTORY_LIMIT=120;
export function createDebugFps({limit=FPS_HISTORY_LIMIT,clock=()=>Date.now()}={}){
 const history=[];
 let start=null,frames=0,phase='idle',enabled=true;
 let lastFrame=null;
 let frameTimes=[],drawTotal=0,triTotal=0,cpuTotal=0,heapTotal=0,heapCount=0;
 const rounded=n=>Math.round(n*100)/100;
 function clearWindow(){
   start=null;frames=0;lastFrame=null;frameTimes=[];
   drawTotal=0;triTotal=0;cpuTotal=0;heapTotal=0;heapCount=0;
 }
 function reset(){history.length=0;clearWindow();phase='idle';enabled=true;}
 function frame(now,metrics={}){
   if(!enabled||!Number.isFinite(now))return;
   if(start===null){start=now;lastFrame=now;frames=1;return;}
   const delta=now-lastFrame;
   lastFrame=now;
   if(delta>0&&Number.isFinite(delta))frameTimes.push(delta);
   drawTotal+=metrics.drawCalls??0;
   triTotal+=metrics.triangles??0;
   cpuTotal+=metrics.cpuMs??0;
   if(Number.isFinite(metrics.heapBytes)){heapTotal+=metrics.heapBytes;heapCount++;}
   frames++;
   const elapsed=now-start;
   if(elapsed<1000)return;
   const times=[...frameTimes].sort((a,b)=>a-b);
   const percentile=p=>times.length?rounded(times[Math.floor((times.length-1)*p)]):null;
   history.push({time:clock(),phase,fps:rounded(frames*1000/elapsed),
     frames,elapsedMs:rounded(elapsed),
     frametimeP95Ms:percentile(.95),frametimeP99Ms:percentile(.99),
     drawCalls:rounded(drawTotal/Math.max(1,frames-1)),
     triangles:Math.round(triTotal/Math.max(1,frames-1)),
     ...(heapCount?{heapMiB:rounded(heapTotal/heapCount/(1024*1024))}:{})});
   if(history.length>limit)history.splice(0,history.length-limit);
   clearWindow();
 }
 function setPhase(value){
   if(typeof value!=='string'||!value||value.length>48)throw Error('Invalid phase');
   phase=value;
   // Avoid mixed windows spanning different workload phases.
   clearWindow();
 }
 function stats({phase:filter=null}={}){
   const data=filter?history.filter(sample=>sample.phase===filter):history;
   const ordered=data.map(s=>s.fps).sort((a,b)=>a-b);
   const pct=p=>ordered.length?ordered[Math.floor((ordered.length-1)*p)]:null;
   const avg=ordered.length?rounded(ordered.reduce((a,b)=>a+b,0)/ordered.length):null;
   const mean=key=>{
     const values=data.map(s=>s[key]).filter(Number.isFinite);
     return values.length?rounded(values.reduce((a,b)=>a+b,0)/values.length):null;
   };
   return {samples:ordered.length,phase:filter??'all',avg,min:pct(0),max:pct(1),
     p5:pct(.05),p50:pct(.5),p95:pct(.95),last:data.at(-1)?.fps??null,
     meanDrawCalls:mean('drawCalls'),meanTriangles:mean('triangles'),
     meanFrameP95Ms:mean('frametimeP95Ms'),worstFrameP99Ms:data.length?
       Math.max(...data.map(s=>s.frametimeP99Ms??0)):null,
     meanHeapMiB:mean('heapMiB')};
 }
 return {frame,setPhase,stats,reset,stop(){enabled=false;},start(){enabled=true;clearWindow();},
   get samples(){return history.map(s=>({...s}));},get phase(){return phase;},
   get running(){return enabled;}};
}
