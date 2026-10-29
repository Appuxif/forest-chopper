// Extracted from the original single-file game. Shared game state is passed explicitly.
export function createBuilding(ctx) {
function makeLog(){const m=new ctx.THREE.Mesh(ctx.logGeo,[ctx.logMat,ctx.endMat,ctx.endMat]);m.rotation.z=Math.PI/2;return m}
function overlaps(a,b){return Math.abs(a.x-b.x)<(a.orientation===0&&b.orientation===0?3.2:1.65)&&Math.abs(a.z-b.z)<(a.orientation===1&&b.orientation===1?3.2:1.65)}
function candidate(){const distance=3.7,dirX=-Math.sin(ctx.yaw),dirZ=-Math.cos(ctx.yaw);const x=Math.round((ctx.px+dirX*distance)*2)/2,z=Math.round((ctx.pz+dirZ*distance)*2)/2;let level=0;
for(const p of ctx.placed)if(overlaps({x,z,orientation:ctx.orientation},p))level=Math.max(level,p.level+1);
return {x,z,orientation:ctx.orientation,level,y:ctx.logRadius+level*ctx.logRadius*1.8}}
function updatePreview(){if(!ctx.buildMode)return;ctx.placement=candidate();if(!ctx.preview){ctx.preview=makeLog();ctx.preview.material=new ctx.THREE.MeshLambertMaterial({color:0x83efb5,transparent:true,opacity:.48,depthWrite:false});ctx.scene.add(ctx.preview)}ctx.preview.position.set(ctx.placement.x,ctx.placement.y,ctx.placement.z);ctx.preview.rotation.set(0,0,Math.PI/2);if(ctx.orientation===1)ctx.preview.rotation.y=Math.PI/2;
const valid=ctx.wood>0&&ctx.placement.level<16;ctx.preview.material.color.setHex(valid?0x83efb5:0xff6666);ctx.$('buildhint').textContent=valid?`Высота: ${ctx.placement.level+1} · Цена: 1 🪵`:'Нужна древесина или слишком высокая стена';}
function placeLog(){if(ctx.isOnline()){if(ctx.placement&&ctx.wood>0)ctx.sendNet({type:"place",x:ctx.placement.x,z:ctx.placement.z,orientation:ctx.placement.orientation});return;}if(!ctx.buildMode||!ctx.placement||ctx.wood<1||ctx.placement.level>=16)return;const p={...ctx.placement},m=makeLog();m.position.set(p.x,p.y,p.z);if(p.orientation===1)m.rotation.y=Math.PI/2;ctx.scene.add(m);ctx.placed.push({...p,mesh:m});ctx.wood--;ctx.$('wood').textContent=ctx.wood;updatePreview()}
function removeLog(){if(ctx.isOnline()){const p=candidate();let best=null;for(let i=ctx.placed.length-1;i>=0;i--){const a=ctx.placed[i];if(Math.hypot(a.x-p.x,a.z-p.z)<2.4){best=a;break}}if(best)ctx.sendNet({type:"remove",id:best.id});return;}if(!ctx.buildMode)return;const p=candidate();let idx=-1;for(let i=ctx.placed.length-1;i>=0;i--){const a=ctx.placed[i];if(Math.hypot(a.x-p.x,a.z-p.z)<2.4){idx=i;break}}if(idx<0)return;ctx.scene.remove(ctx.placed[idx].mesh);ctx.placed.splice(idx,1);ctx.wood++;ctx.$('wood').textContent=ctx.wood;updatePreview()}
function setMode(on){ctx.buildMode=on;ctx.$('mode').textContent=on?'🪓 Рубить':'🏗️ Строить';ctx.$('mode').classList.toggle('active',on);for(const id of ['rotate','place','undo'])ctx.$(id).style.display=on?'block':'none';ctx.$('hit').style.display=on?'none':'block';ctx.$('buildhint').textContent='';if(!on&&ctx.preview){ctx.scene.remove(ctx.preview);ctx.preview=null}}
ctx.$('mode').onclick=()=>setMode(!ctx.buildMode);ctx.$('rotate').onclick=()=>ctx.orientation=1-ctx.orientation;ctx.$('place').onclick=placeLog;ctx.$('undo').onclick=removeLog;

return {makeLog, overlaps, candidate, updatePreview, placeLog, removeLog, setMode};
}
