// Extracted from the original single-file game. Shared game state is passed explicitly.
export function createWorld(ctx) {
function rand(x,z,n=0){let v=Math.sin(x*127.1+z*311.7+n*78.233+ctx.seed)*43758.5453;return v-Math.floor(v)}
function makeTree(x,z,id){const group=new ctx.THREE.Group(),h=7.5+rand(x,z,4)*6.5,scale=.9+rand(x,z,5)*.65,maxHp=7+Math.floor(rand(x,z,8)*5);const trunk=new ctx.THREE.Mesh(ctx.trunkGeo,ctx.trunkMats[Math.floor(rand(x,z,6)*3)]);trunk.scale.set(scale,h,scale);trunk.position.y=h/2;group.add(trunk);
for(let i=0;i<4;i++){const foliage=new ctx.THREE.Mesh(ctx.leafGeo,ctx.leafMats[Math.floor(rand(x,z,15+i)*4)]);const w=scale*(2.9-i*.45),height=h*(.48-i*.035);foliage.scale.set(w,height,w);foliage.position.y=h*(.68+i*.105);group.add(foliage)}
const scarMat=new ctx.THREE.MeshLambertMaterial({color:0xe0ad70,side:ctx.THREE.DoubleSide});const scar=new ctx.THREE.Mesh(new ctx.THREE.PlaneGeometry(.75*scale,.22),scarMat);scar.position.set(0,1.12,.52*scale);scar.visible=false;group.add(scar);
group.position.set(x,0,z);group.userData={id,x,z,h,scale,hp:ctx.treeDamage.get(id)??maxHp,maxHp,scar,alive:true};if(group.userData.hp<maxHp){scar.visible=true;scar.scale.y=1+(1-group.userData.hp/maxHp)*2.2;}ctx.scene.add(group);ctx.trees.set(id,group)}
function build(cx,cz){const key=cx+','+cz;if(ctx.chunks.has(key))return;const decor=new ctx.THREE.Group();ctx.scene.add(decor);ctx.chunks.set(key,decor);
for(let i=0;i<8;i++){const x=cx*ctx.chunkSize+rand(cx,cz,i*3)*ctx.chunkSize,z=cz*ctx.chunkSize+rand(cx,cz,i*3+1)*ctx.chunkSize;if(Math.hypot(x,z)<8)continue;const id=key+':'+i;if(!ctx.felled.has(id))makeTree(x,z,id)}
for(let i=0;i<25;i++){const x=cx*ctx.chunkSize+rand(cx,cz,100+i*2)*ctx.chunkSize,z=cz*ctx.chunkSize+rand(cx,cz,101+i*2)*ctx.chunkSize,isRock=rand(cx,cz,300+i)>.86;const obj=new ctx.THREE.Mesh(isRock?ctx.rockGeo:ctx.grassGeo,isRock?ctx.rockMat:ctx.grassMat);obj.position.set(x,isRock?.19:.3,z);obj.scale.setScalar(isRock?.35+rand(cx,cz,i)*.5:.7+rand(cx,cz,i)*.9);obj.rotation.y=rand(cx,cz,i+500)*6.28;decor.add(obj)}}
function updateChunks(){const cx=Math.floor(ctx.px/ctx.chunkSize),cz=Math.floor(ctx.pz/ctx.chunkSize);for(let x=cx-ctx.radius;x<=cx+ctx.radius;x++)for(let z=cz-ctx.radius;z<=cz+ctx.radius;z++)build(x,z);for(const [key,group] of ctx.chunks){const [x,z]=key.split(',').map(Number);if(Math.abs(x-cx)>ctx.radius+1||Math.abs(z-cz)>ctx.radius+1){ctx.scene.remove(group);ctx.chunks.delete(key)}}for(const [key,t] of ctx.trees){if(Math.abs(t.position.x-ctx.px)>ctx.chunkSize*(ctx.radius+1.5)||Math.abs(t.position.z-ctx.pz)>ctx.chunkSize*(ctx.radius+1.5)){ctx.scene.remove(t);ctx.trees.delete(key)}}}

return {rand, makeTree, build, updateChunks};
}
