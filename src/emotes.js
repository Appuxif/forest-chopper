// Two shared emoji sprites: no per-message texture/material allocation and no model skeleton changes.
export const EMOTE_LABELS=Object.freeze({wave:'👋',thumbs_up:'👍'});
export function createEmotes(ctx,doc=document,{lifetimeMs=2500}={}) {
  const THREE=ctx.THREE;
  const shared=new Map();
  for(const [key,symbol] of Object.entries(EMOTE_LABELS)){
    const canvas=doc.createElement('canvas');canvas.width=128;canvas.height=128;
    const g=canvas.getContext('2d');
    g.font='90px sans-serif';g.textAlign='center';g.textBaseline='middle';
    g.fillText(symbol,64,65);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    shared.set(key,new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));
  }
  const active=new Map();
  function clearPlayer(id){
    const old=active.get(id);
    if(old){old.parent.remove(old.sprite);active.delete(id);}
  }
  function receive(data,now=performance.now()){
    if(!data || !Number.isInteger(data.by) || !shared.has(data.kind))return false;
    const parent=data.by===ctx.myId?ctx.ownAvatar?.group:ctx.avatars.get(data.by)?.group;
    if(!parent)return false;
    clearPlayer(data.by);
    const sprite=new THREE.Sprite(shared.get(data.kind));
    sprite.position.set(0,3.6,0);sprite.scale.set(.95,.95,1);
    parent.add(sprite);
    active.set(data.by,{parent,sprite,until:now+lifetimeMs});
    return true;
  }
  function tick(now){
    for(const [id,item] of active){
      if(now>=item.until || (id!==ctx.myId && !ctx.avatars.has(id)))clearPlayer(id);
    }
  }
  function clear(){for(const id of [...active.keys()])clearPlayer(id);}
  const row=doc.createElement('div');
  row.className='fc-emotes';
  row.style.cssText='display:flex;gap:8px;margin:8px 0';
  const title=doc.createElement('span');title.textContent='Эмоции:';row.append(title);
  for(const [kind,label] of Object.entries(EMOTE_LABELS)){
    const button=doc.createElement('button');
    button.type='button';button.textContent=label;button.title=kind==='wave'?'Помахать':'Показать одобрение';
    button.setAttribute('aria-label',button.title);
    button.onclick=()=>{
      if(!ctx.isOnline()){ctx.notify('Эмоции доступны в сетевой игре','info','emote-offline');return;}
      ctx.sendEmote(kind);
    };
    row.append(button);
  }
  ctx.$('network').append(row);
  return {receive,tick,clear,get count(){return active.size;}};
}
