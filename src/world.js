// Extracted from the original single-file game. Shared game state is passed explicitly.
export function createWorld(ctx) {
function rand(x,z,n=0){let v=Math.sin(x*127.1+z*311.7+n*78.233+ctx.seed)*43758.5453;return v-Math.floor(v)}
const birchLobes=[[-.35,.82,.1,1.55,1.35,1.35],[1.05,.81,-.25,1.32,1.1,1.25],
 [-1.2,.87,-.15,1.34,1.12,1.28],[.2,1.04,.45,1.44,1.25,1.35]];
function makeTree(x,z,id){const group=new ctx.THREE.Group(),h=7.5+rand(x,z,4)*6.5,scale=.9+rand(x,z,5)*.65,maxHp=7+Math.floor(rand(x,z,8)*5);
// Species is visual-only: existing seed indices, tree HP, positions and network IDs stay identical.
const birch=rand(x,z,703)<.2;
const trunkPalette=ctx.trunkMats[Math.floor(rand(x,z,6)*3)];
const trunk=new ctx.THREE.Mesh(ctx.trunkGeo,birch?ctx.birchTrunkMat:trunkPalette);
trunk.scale.set(birch?scale*.78:scale,h,birch?scale*.78:scale);trunk.position.y=h/2;group.add(trunk);
// Cosmetic silhouette only: keep four shared foliage meshes and the same trunk/HP/position.
// Use an unused deterministic random index, never the indices used by tree_info.
const variant=Math.floor(rand(x,z,701)*3);
const rare=rand(x,z,702)>.985; // About 1.5% of trees: a visual discovery, no extra wood/HP.
// Four foliage meshes for both species. Birches form clustered round low-poly crowns.
for(let i=0;i<4;i++){
 const palette=ctx.leafMats[Math.floor(rand(x,z,15+i)*4)];
 const birchPalette=birch?ctx.birchLeafMats[Math.floor(rand(x,z,731+i)*ctx.birchLeafMats.length)]:null;
 const foliage=new ctx.THREE.Mesh(birch?ctx.birchLeafGeo:ctx.leafGeo,rare?ctx.rareLeafMat:birch?birchPalette:palette);
 if(birch){
  const [lx,ly,lz,sx,sy,sz]=birchLobes[i];
  const variation=.92+rand(x,z,744+i)*.16;
  foliage.scale.set(sx*scale*variation,sy*scale*variation,sz*scale*variation);
  foliage.position.set(lx*scale,h*ly,lz*scale);
  foliage.rotation.y=rand(x,z,759+i)*Math.PI*2;
 }else{
  let w=scale*(2.9-i*.45),height=h*(.48-i*.035),y=h*(.68+i*.105);
  if(variant===1){ // Slender fir: long, narrow tiers.
   w*=.72+i*.035;height*=1.12;y+=h*.014;
  }else if(variant===2){ // Broad pine: wider, flatter lower canopy.
   w*=1.17-i*.055;height*=.83;y-=h*.036;
  }
  foliage.scale.set(w,height,w);foliage.position.y=y;
 }
 group.add(foliage);
}
// Damage stays in HP (and the damage bar). No flat rectangle on the trunk.
group.position.set(x,0,z);group.userData={id,x,z,h,scale,hp:ctx.treeDamage.get(id)??maxHp,maxHp,alive:true,variant,rare,species:birch?'birch':'conifer'};ctx.scene.add(group);ctx.trees.set(id,group)}
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
}
ctx.landmarks?.decorate(decor,cx,cz);
}
function updateChunks(){const cx=Math.floor(ctx.px/ctx.chunkSize),cz=Math.floor(ctx.pz/ctx.chunkSize);for(let x=cx-ctx.radius;x<=cx+ctx.radius;x++)for(let z=cz-ctx.radius;z<=cz+ctx.radius;z++)build(x,z);for(const [key,group] of ctx.chunks){const [x,z]=key.split(',').map(Number);if(Math.abs(x-cx)>ctx.radius+1||Math.abs(z-cz)>ctx.radius+1){ctx.scene.remove(group);ctx.chunks.delete(key)}}for(const [key,t] of ctx.trees){if(Math.abs(t.position.x-ctx.px)>ctx.chunkSize*(ctx.radius+1.5)||Math.abs(t.position.z-ctx.pz)>ctx.chunkSize*(ctx.radius+1.5)){ctx.scene.remove(t);ctx.trees.delete(key)}}}

return {rand, makeTree, build, updateChunks};
}
