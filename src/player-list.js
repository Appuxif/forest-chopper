// Lightweight view of server-confirmed connected users, no independent polling.
export function createPlayerList(ctx,doc=document) {
  const section=doc.createElement('section');
  section.className='fc-players';
  section.style.cssText='margin:9px 0';
  const toggle=doc.createElement('button');
  toggle.type='button';toggle.textContent='👥 Участники';
  toggle.setAttribute('aria-expanded','false');
  const list=doc.createElement('ul');
  list.hidden=true;
  list.setAttribute('aria-label','Участники комнаты');
  list.style.cssText='list-style:none;padding:6px 0;margin:4px 0;max-height:175px;overflow-y:auto';
  section.append(toggle,list);
  ctx.$('network').append(section);

  const members=()=>{
    if(!ctx.isOnline())return [];
    return [
      {id:ctx.myId,name:String(ctx.$('netname').value||'Вы').slice(0,22),self:true},
      ...[...ctx.avatars].map(([id,a])=>({id,name:a.name||'Игрок',self:false})),
    ].sort((a,b)=>a.id-b.id);
  };
  function render(){
    const current=members();
    toggle.textContent=`👥 Участники (${current.length})`;
    if(list.hidden)return current;
    list.replaceChildren(...current.map(p=>{
      const item=doc.createElement('li');
      item.style.cssText='padding:5px 3px;border-bottom:1px solid #ffffff20';
      item.textContent=`${p.self?'🟢':'👤'} ${p.name}${p.self?' (вы)':''}`;
      return item;
    }));
    if(!current.length){
      const item=doc.createElement('li');
      item.textContent='Сначала подключитесь к комнате';list.append(item);
    }
    return current;
  }
  function close(){list.hidden=true;toggle.setAttribute('aria-expanded','false');}
  toggle.onclick=()=>{
    list.hidden=!list.hidden;toggle.setAttribute('aria-expanded',String(!list.hidden));
    render();
  };
  render();
  return {render,close,members,get expanded(){return !list.hidden;}};
}
