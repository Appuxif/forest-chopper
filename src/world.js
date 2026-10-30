// Extracted from the original single-file game. Shared game state is passed explicitly.
export function createWorld(ctx) {
function rand(x,z,n=0){let v=Math.sin(x*127.1+z*311.7+n*78.233+ctx.seed)*43758.5453;return v-Math.floor(v)}
function makeTree(x,z,id){const group=new ctx.THREE.Group(),h=7.5+rand(x,z,4)*6.5,scale=.9+rand(x,z,5)*.65,maxHp=7+Math.floor(rand(x,z,8)*5);const trunk=new ctx.THREE.Mesh(ctx.trunkGeo,ctx.trunkMats[Math.floor(rand(x,z,6)*3)]);trunk.scale.set(scale,h,scale);trunk.position.y=h/2;group.add(trunk);
// Cosmetic silhouette only: keep four shared foliage meshes and the same trunk/HP/position.
// Use an unused deterministic random index, never the indices used by tree_info.
const variant=Math.floor(rand(x,z,701)*3);
const rare=rand(x,z,702)>.985; // About 1.5% of trees: a visual discovery, no extra wood/HP.
for(let i=0;i<4;i++){
 const palette=ctx.leafMats[Math.floor(rand(x,z,15+i)*4)];
 const foliage=new ctx.THREE.Mesh(ctx.leafGeo,rare?ctx.rareLeafMat:palette);
 let w=scale*(2.9-i*.45),height=h*(.48-i*.035),y=h*(.68+i*.105);
 if(variant===1){ // Slender fir: long, narrow tiers.
  w*=.72+i*.035;height*=1.12;y+=h*.014;
 }else if(variant===2){ // Broad pine: wider, flatter lower canopy.
  w*=1.17-i*.055;height*=.83;y-=h*.036;
 }
 foliage.scale.set(w,height,w);foliage.position.y=y;group.add(foliage);
}
// Damage stays in HP (and the damage bar). No flat rectangle on the trunk.
group.position.set(x,0,z);group.userData={id,x,z,h,scale,hp:ctx.treeDamage.get(id)??maxHp,maxHp,alive:true,variant,rare};ctx.scene.add(group);ctx.trees.set(id,group)}
function build(cx,cz){const key=cx+','+cz;if(ctx.chunks.has(key))return;const decor=new ctx.THREE.Group();ctx.scene.add(decor);ctx.chunks.set(key,decor);
for(let i=0;i<8;i++){const x=cx*ctx.chunkSize+rand(cx,cz,i*3)*ctx.chunkSize,z=cz*ctx.chunkSize+rand(cx,cz,i*3+1)*ctx.chunkSize;if(Math.hypot(x,z)<8)continue;const id=key+':'+i;if(!ctx.felled.has(id))makeTree(x,z,id)}
for(let i=0;i<25;i++){
 const x=cx*ctx.chunkSize+rand(cx,cz,100+i*2)*ctx.chunkSize;
 const z=cz*ctx.chunkSize+rand(cx,cz,101+i*2)*ctx.chunkSize;
 const isRock=rand(cx,cz,300+i)>.86;
 // Only swap a few existing grass meshes, with separate deterministic indices.
 const type=isRock?'rock':rand(cx,cz,800+i)>.94?'mushroom':rand(cx,cz,900+i)>.79?'flower':'grass';
 const geometry=type==='rock'?ctx.rockGeo:type==='mushroom'?ctx.mushroomGeo:type==='flower'?ctx.flowerGeo:ctx.grassGeo;
 const material=type==='rock'?ctx.rockMat:type==='mushroom'?ctx.mushroomMat:type==='flower'?ctx.flowerMat:ctx.grassMat;
 const obj=new ctx.THREE.Mesh(geometry,material);
 const height=type==='rock'?.19:type==='mushroom'?.22:type==='flower'?.31:.3;
 const scale=type==='rock'?.35+rand(cx,cz,i)*.5:type==='grass'?.7+rand(cx,cz,i)*.9:.8+rand(cx,cz,i)*.65;
 obj.position.set(x,height,z);obj.scale.setScalar(scale);
 obj.rotation.y=rand(cx,cz,i+500)*6.28;
 obj.userData.decorType=type;
 decor.add(obj);
}}
function updateChunks(){const cx=Math.floor(ctx.px/ctx.chunkSize),cz=Math.floor(ctx.pz/ctx.chunkSize);for(let x=cx-ctx.radius;x<=cx+ctx.radius;x++)for(let z=cz-ctx.radius;z<=cz+ctx.radius;z++)build(x,z);for(const [key,group] of ctx.chunks){const [x,z]=key.split(',').map(Number);if(Math.abs(x-cx)>ctx.radius+1||Math.abs(z-cz)>ctx.radius+1){ctx.scene.remove(group);ctx.chunks.delete(key)}}for(const [key,t] of ctx.trees){if(Math.abs(t.position.x-ctx.px)>ctx.chunkSize*(ctx.radius+1.5)||Math.abs(t.position.z-ctx.pz)>ctx.chunkSize*(ctx.radius+1.5)){ctx.scene.remove(t);ctx.trees.delete(key)}}}

return {rand, makeTree, build, updateChunks};
}
