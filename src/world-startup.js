// First entry into a world: keep the existing loading overlay until the
// spawn area has been generated and painted at least once. Never block the
// renderer or workers; a deadline ensures slow machines cannot get stuck.
export const WORLD_STARTUP_MIN_MS=3000;
export const WORLD_STARTUP_MAX_MS=5000;
export const WORLD_STARTUP_SETTLE_MS=350;

function countSquare(chunks,cx,cz,radius){
  let ready=0;
  for(let x=cx-radius;x<=cx+radius;x++)
    for(let z=cz-radius;z<=cz+radius;z++)
      if(chunks?.has(x+','+z))ready++;
  return ready;
}

export function sampleWorldStartup(ctx,{online=false}={}){
  const detailSize=ctx.chunkSize??24;
  const dx=Math.floor(ctx.px/detailSize),dz=Math.floor(ctx.pz/detailSize);
  const detailedRadius=Math.min(2,Math.max(0,ctx.radius??3));
  const detailedTotal=(detailedRadius*2+1)**2;
  const detailedReady=countSquare(ctx.chunks,dx,dz,detailedRadius);
  const terrain=ctx.terrain;
  const terrainSize=terrain?.chunkSize??96;
  const tx=Math.floor(ctx.px/terrainSize),tz=Math.floor(ctx.pz/terrainSize);
  const terrainTotal=9,terrainReady=countSquare(terrain?.chunks,tx,tz,1);
  const grass=ctx.microGrass;
  const grassPending=grass?.nearPending??1;
  const grassDesired=grass?.nearDesired??0;
  const farForest=ctx.distantForest;
  const farDesired=farForest?.desiredChunkCount??0;
  const farTotal=Math.min(24,farDesired);
  const farReady=Math.min(farForest?.chunkCount??0,farTotal);
  const connected=!online||ctx.isOnline?.()===true;
  const ready=connected&&detailedReady===detailedTotal&&
    terrainReady===terrainTotal&&grassDesired>0&&grassPending===0&&
    farReady===farTotal;
  const stage=!connected?'Подключаемся к серверу…':
    terrainReady<terrainTotal?'Генерируем рельеф…':
    detailedReady<detailedTotal?'Расставляем деревья…':
    grassPending>0||!grassDesired?'Выращиваем траву…':
    farReady<farTotal?'Загружаем дальний лес…':'Завершаем подготовку…';
  return {ready,stage,detailedReady,detailedTotal,terrainReady,terrainTotal,
    grassPending,grassDesired,farReady,farTotal,connected};
}

export function createWorldStartupGate({
  loading,online=false,minMs=WORLD_STARTUP_MIN_MS,
  maxMs=WORLD_STARTUP_MAX_MS,settleMs=WORLD_STARTUP_SETTLE_MS,
}={}){
  let startedAt=null,readySince=null,lastLabel='',complete=false,reason=null;
  const status=loading?.querySelector?.('span');
  function tick(now,ctx){
    if(complete)return true;
    if(!Number.isFinite(now))return false;
    if(startedAt===null)startedAt=now;
    const snapshot=sampleWorldStartup(ctx,{online});
    if(snapshot.ready){
      if(readySince===null)readySince=now;
    }else readySince=null;
    const elapsed=now-startedAt;
    const settled=readySince!==null&&now-readySince>=settleMs;
    const timedOut=elapsed>=maxMs;
    if((settled&&elapsed>=minMs)||timedOut){
      reason=timedOut&&!settled?'timeout':'ready';
      loading?.remove?.();
      complete=true;
      // On a failed online launch, reveal connection controls so the player
      // can retry without returning to the main menu.
      if(online&&!snapshot.connected){
        const network=ctx.$?.('network');
        if(network)network.style.display='block';
      }
      return true;
    }
    const label=snapshot.stage;
    if(status&&label!==lastLabel){
      lastLabel=label;
      status.textContent=label;
    }
    return false;
  }
  return {tick,get complete(){return complete;},get reason(){return reason;}};
}
