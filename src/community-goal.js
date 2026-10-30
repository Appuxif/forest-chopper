// Display server-confirmed, shared progress only. No client-side kill counters.
export const COMMUNITY_TARGET=20;
export function createCommunityGoal(ctx,doc=document) {
  const panel=doc.createElement('div');
  panel.className='fc-community-goal';
  panel.style.cssText='display:none;margin-top:5px;text-align:center;font:10px/1.45 system-ui,sans-serif;color:#ffdf9e;pointer-events:none';
  panel.style.display='none';
  panel.setAttribute('aria-label','Общая цель команды');
  const text=doc.createElement('div');
  const track=doc.createElement('div');
  track.style.cssText='height:4px;background:#ffffff33;border-radius:5px;overflow:hidden;margin-top:4px';
  const fill=doc.createElement('div');
  fill.style.cssText='height:100%;width:0%;background:#8ddd9c;border-radius:5px';
  fill.style.width='0%';
  track.append(fill);panel.append(text,track);
  ctx.$('minimappanel').append(panel);
  let count=null;
  function set(value,{initial=false}={}) {
    if(!Number.isSafeInteger(value) || value<0 || value>1_000_000_000)return false;
    if(!initial && count!==null && value<count)return false;
    const prior=count;
    count=value;panel.style.display='block';
    const capped=Math.min(COMMUNITY_TARGET,count);
    text.textContent=count>=COMMUNITY_TARGET?
      `✅ Вместе: ${COMMUNITY_TARGET}/${COMMUNITY_TARGET}`:
      `🤝 Вместе: ${capped}/${COMMUNITY_TARGET} деревьев`;
    fill.style.width=`${100*capped/COMMUNITY_TARGET}%`;
    if(!initial && prior!==null && prior<COMMUNITY_TARGET && count>=COMMUNITY_TARGET)
      ctx.notify('🤝 Общая цель выполнена: 20 деревьев!','success','community-goal');
    return true;
  }
  function clear(){count=null;panel.style.display='none';fill.style.width='0%';}
  return {set,clear,get value(){return count;},panel};
}
