// Ephemeral map markers. Local timestamps only; nothing is saved or sent automatically.
export function createMapPings({now=()=>performance.now(),ttlMs=8000,max=32}={}) {
  const items=new Map();
  function receive(data) {
    if(!data || !Number.isInteger(data.by) || data.by<1 ||
        !Number.isFinite(data.x) || !Number.isFinite(data.z) ||
        Math.abs(data.x)>240000 || Math.abs(data.z)>240000)return false;
    const by=data.by;
    if(items.has(by))items.delete(by);
    items.set(by,{by,x:data.x,z:data.z,name:String(data.name||'Игрок').slice(0,22),
      expires:now()+ttlMs});
    if(items.size>max)items.delete(items.keys().next().value);
    return true;
  }
  function active() {
    const time=now();
    for(const [id,item] of items)if(item.expires<=time)items.delete(id);
    return [...items.values()];
  }
  function clear(){items.clear()}
  return {receive,active,clear};
}

export function mapPointToWorld(clientX,clientY,rect,px,pz,size=256,range=55){
  if(!rect || !Number.isFinite(clientX) || !Number.isFinite(clientY) ||
      !Number.isFinite(px) || !Number.isFinite(pz) ||
      !Number.isFinite(rect.width)||!Number.isFinite(rect.height)||
      rect.width<=0 || rect.height<=0)return null;
  const center=size/2,radius=center-12;
  const x=(clientX-rect.left)/rect.width*size,y=(clientY-rect.top)/rect.height*size;
  if(Math.hypot(x-center,y-center)>radius)return null;
  const k=range/radius;
  return {x:Math.round((px+(x-center)*k)*10)/10,
    z:Math.round((pz+(y-center)*k)*10)/10};
}
