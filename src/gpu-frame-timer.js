// Asynchronous GPU timing for the WebGL render path. Never calls gl.finish(),
// readPixels(), or reads a query result before QUERY_RESULT_AVAILABLE.
// At most one query is outstanding, sampled periodically to minimize overhead.
export function createGpuFrameTimer(renderer,{sampleIntervalMs=250,pollIntervalMs=50}={}) {
  let gl=null,ext=null,api=null,attempted=false,supported=null;
  let active=null,pending=null,lastStart=-Infinity,lastPoll=-Infinity;

  function initialize(){
    if(attempted)return supported;
    attempted=true;
    try{
      gl=renderer?.getContext?.();
      if(!gl||gl.isContextLost?.())return (supported=false);
      ext=gl.getExtension?.('EXT_disjoint_timer_query_webgl2');
      if(ext&&typeof gl.createQuery==='function'&&typeof gl.getQueryParameter==='function'){
        api={
          create:()=>gl.createQuery(),
          begin:q=>gl.beginQuery(ext.TIME_ELAPSED_EXT,q),
          end:()=>gl.endQuery(ext.TIME_ELAPSED_EXT),
          available:q=>gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE),
          result:q=>gl.getQueryParameter(q,gl.QUERY_RESULT),
          delete:q=>gl.deleteQuery(q),
        };
      }else{
        ext=gl.getExtension?.('EXT_disjoint_timer_query');
        if(ext){
          api={
            create:()=>ext.createQueryEXT(),
            begin:q=>ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,q),
            end:()=>ext.endQueryEXT(ext.TIME_ELAPSED_EXT),
            available:q=>ext.getQueryObjectEXT(q,ext.QUERY_RESULT_AVAILABLE_EXT),
            result:q=>ext.getQueryObjectEXT(q,ext.QUERY_RESULT_EXT),
            delete:q=>ext.deleteQueryEXT(q),
          };
        }
      }
      supported=!!api;
    }catch{supported=false;}
    return supported;
  }

  function discard(query){
    if(!query)return;
    try{api?.delete(query);}catch{/* Context may already be lost. */}
  }

  function begin(now){
    if(!Number.isFinite(now)||!initialize()||active||pending||
      now-lastStart<sampleIntervalMs)return false;
    let query=null;
    try{
      query=api.create();
      if(!query)return false;
      api.begin(query);
      active=query;
      lastStart=now;
      return true;
    }catch{
      discard(query);
      supported=false;
      return false;
    }
  }

  function end(){
    if(!active)return;
    const query=active;
    active=null;
    try{
      api.end();
      pending=query;
      lastPoll=-Infinity;
    }catch{
      discard(query);
      supported=false;
    }
  }

  function poll(now){
    if(!pending||!Number.isFinite(now)||now-lastPoll<pollIntervalMs)return null;
    lastPoll=now;
    try{
      // A GPU disjoint (e.g. clock reset) makes ALL current samples invalid.
      if(gl.isContextLost?.()||gl.getParameter(ext.GPU_DISJOINT_EXT)){
        discard(pending);
        pending=null;
        return {status:'invalid'};
      }
      if(!api.available(pending))return null; // Do NOT block on result.
      const nanoseconds=api.result(pending);
      discard(pending);
      pending=null;
      return Number.isFinite(nanoseconds)&&nanoseconds>=0
        ?{status:'ready',ms:nanoseconds/1e6}:{status:'invalid'};
    }catch{
      discard(pending);
      pending=null;
      supported=false;
      return {status:'unsupported'};
    }
  }

  function reset(){
    if(active){
      // Active time elapsed queries must be closed before deletion.
      try{api?.end();}catch{/* Already lost. */}
      discard(active);
      active=null;
    }
    discard(pending);
    pending=null;
    lastStart=-Infinity;
    lastPoll=-Infinity;
  }
  return {begin,end,poll,reset,get supported(){return supported;}};
}
