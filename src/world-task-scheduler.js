// Fixed-rate world streamer. Computation runs in module workers; THREE and GPU
// buffers remain exclusively on the main thread. No adaptive frame-time policy.
export const WORLD_PRIORITY=Object.freeze({
  collision:0,near:1,visible:2,background:3,prefetch:4,
});

export class WorldLRU {
  constructor(limitBytes=24*1024*1024){this.limitBytes=limitBytes;this.bytes=0;this.entries=new Map();}
  get(key){
    if(!this.entries.has(key))return null;
    const entry=this.entries.get(key);
    this.entries.delete(key);this.entries.set(key,entry);
    return entry.value;
  }
  put(key,value,bytes=0){
    if(bytes>this.limitBytes)return;
    this.delete(key);
    this.entries.set(key,{value,bytes});this.bytes+=bytes;
    while(this.bytes>this.limitBytes&&this.entries.size)
      this.delete(this.entries.keys().next().value);
  }
  delete(key){const prev=this.entries.get(key);if(!prev)return;
    this.entries.delete(key);this.bytes-=prev.bytes;}
  clear(){this.entries.clear();this.bytes=0;}
  get size(){return this.entries.size;}
}

export class WorldTaskScheduler {
  constructor({workerUrl=null,workers=2,applyPerTick=2,applyMs=2}={}){
    this.queue=new Map();this.inflight=new Map();this.completed=[];
    this.revisions=new Map();this.generation=0;this.serial=0;
    this.applyPerTick=applyPerTick;this.applyMs=applyMs;
    this.workerSlots=[];this.closed=false;
    if(typeof Worker!=='undefined'&&workerUrl){
      try{
        for(let i=0;i<workers;i++){
          const worker=new Worker(workerUrl,{type:'module'});
          const slot={worker,busy:false,task:null};
          worker.onmessage=e=>this.receive(slot,e.data);
          worker.onerror=()=>this.failSlot(slot);
          this.workerSlots.push(slot);
        }
      }catch{
        for(const slot of this.workerSlots)slot.worker.terminate();
        this.workerSlots=[];
      }
    }
  }
  get enabled(){return this.workerSlots.length>0;}
  schedule({key,kind,priority=WORLD_PRIORITY.background,payload,apply,fallback}){
    if(this.closed)return;
    const revision=(this.revisions.get(key)||0)+1;
    this.revisions.set(key,revision);
    const job={key,kind,priority,payload,apply,fallback,revision,
      generation:this.generation,serial:++this.serial};
    this.queue.set(key,job);
    if(this.enabled)this.dispatch();
    return revision;
  }
  cancel(key){
    this.revisions.set(key,(this.revisions.get(key)||0)+1);
    this.queue.delete(key);
  }
  cancelPrefix(prefix){
    for(const key of [...this.queue.keys(),...this.inflight.keys()])
      if(key.startsWith(prefix))this.cancel(key);
  }
  reset(){
    this.generation++;this.queue.clear();this.completed.length=0;
    this.revisions.clear();
    // Already busy workers finish, but their generations are discarded.
  }
  valid(job){
    return !this.closed&&job.generation===this.generation&&
      this.revisions.get(job.key)===job.revision;
  }
  dispatch(){
    for(const slot of this.workerSlots){
      if(slot.busy||!this.queue.size)continue;
      let best=null;
      for(const job of this.queue.values()){
        if(!best||job.priority<best.priority||
          (job.priority===best.priority&&job.serial<best.serial))best=job;
      }
      this.queue.delete(best.key);
      if(!this.valid(best))continue;
      slot.busy=true;slot.task=best;
      this.inflight.set(best.key,best);
      try{
        slot.worker.postMessage({kind:best.kind,payload:best.payload,
          generation:best.generation,revision:best.revision});
      }catch{this.failSlot(slot);}
    }
  }
  receive(slot,message){
    const job=slot.task;
    if(!job)return;
    slot.busy=false;slot.task=null;
    if(this.inflight.get(job.key)===job)this.inflight.delete(job.key);
    if(this.valid(job)){
      if(message?.error){
        if(job.fallback)this.completed.push({job,fallback:true});
      }else this.completed.push({job,result:message.result});
    }
    this.dispatch();
  }
  failSlot(slot){
    const job=slot.task;
    slot.busy=false;slot.task=null;
    if(job){
      if(this.inflight.get(job.key)===job)this.inflight.delete(job.key);
      if(this.valid(job)&&job.fallback)this.completed.push({job,fallback:true});
    }
    // Stop using a failed worker; avoid retry storms.
    slot.worker.terminate();this.workerSlots=this.workerSlots.filter(s=>s!==slot);
    this.dispatch();
  }
  tick(){
    if(this.closed)return;
    this.dispatch();
    const start=typeof performance!=='undefined'?performance.now():0;
    let applied=0;
    while(this.completed.length&&applied<this.applyPerTick){
      const {job,result,fallback}=this.completed.shift();
      if(!this.valid(job))continue;
      try{job.apply(fallback?job.fallback():result); }catch(error){
        console.error('World streamer apply:',job.kind,job.key,error);
      }
      applied++;
      if(applied && this.applyMs>0 &&
        typeof performance!=='undefined'&&performance.now()-start>=this.applyMs)break;
    }
    if(!this.enabled&&this.queue.size){
      // Browsers without Worker: only one task per tick, never a whole ring.
      let best=null;
      for(const job of this.queue.values())
        if(!best||job.priority<best.priority||
          (job.priority===best.priority&&job.serial<best.serial))best=job;
      this.queue.delete(best.key);
      if(best.fallback&&this.valid(best)){
        try{best.apply(best.fallback());}catch(e){console.error('World fallback:',e);}
      }
    }
  }
  dispose(){this.closed=true;this.reset();
    for(const slot of this.workerSlots)slot.worker.terminate();
    this.workerSlots.length=0;
  }
  get pending(){return this.queue.size+this.inflight.size+this.completed.length;}
}
