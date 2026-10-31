// Lightweight visual-only forest beyond the fully interactive 24m tree chunks.
// Tree positions, species and water exclusions match createWorld exactly.
// Distant instances never enter ctx.trees, collision detection, or shadow passes.
import {treeCanSpawn,treeCandidate,TREES_PER_CHUNK} from './tree-spacing.js';
export const DISTANT_FOREST_BASE_METERS=165;
export const DISTANT_FOREST_LAKE_METERS=410;
export const DISTANT_FOREST_CHUNKS_PER_TICK=48;

export function distantForestRange(terrain){
  // Prefetch against the target fog visibility, not its delayed animation.
  return DISTANT_FOREST_BASE_METERS+
    Math.max(terrain?.visibility??0,terrain?.visibilityTarget??0)*
      (DISTANT_FOREST_LAKE_METERS-DISTANT_FOREST_BASE_METERS);
}

function silhouetteGeometry(THREE,kind){
  const positions=[],normals=[],colors=[];
  const addTriangle=(a,b,c,color)=>{
    const ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);
    const nx=ab[1]*ac[2]-ab[2]*ac[1];
    const ny=ab[2]*ac[0]-ab[0]*ac[2];
    const nz=ab[0]*ac[1]-ab[1]*ac[0];
    const inv=1/(Math.hypot(nx,ny,nz)||1);
    for(const p of [a,b,c]){
      positions.push(...p);
      normals.push(nx*inv,ny*inv,nz*inv);
      colors.push(...color);
    }
  };
  const tier=(cx,cz,bottom,top,r1,r2,color,n=7)=>{
    for(let i=0;i<n;i++){
      const a=i/n*Math.PI*2,b=(i+1)/n*Math.PI*2;
      const p1=[cx+Math.cos(a)*r1,bottom,cz+Math.sin(a)*r1];
      const p2=[cx+Math.cos(b)*r1,bottom,cz+Math.sin(b)*r1];
      const q1=[cx+Math.cos(a)*r2,top,cz+Math.sin(a)*r2];
      const q2=[cx+Math.cos(b)*r2,top,cz+Math.sin(b)*r2];
      addTriangle(p1,p2,q1,color);
      if(r2>0)addTriangle(p2,q2,q1,color);
    }
  };
  if(kind==='birch'){
    tier(0,0,0,.84,.019,.013,[.76,.72,.61],6);
    tier(0,0,.49,.69,.13,.25,[.25,.41,.19],7);
    tier(0,0,.69,.99,.25,0,[.33,.52,.24],7);
    tier(-.11,0,.56,.72,.09,.14,[.30,.47,.21],6);
    tier(-.11,0,.72,.90,.14,0,[.36,.56,.26],6);
    tier(.12,.03,.53,.70,.10,.15,[.26,.44,.19],6);
    tier(.12,.03,.70,.87,.15,0,[.32,.51,.24],6);
  }else{
    tier(0,0,0,.76,.031,.021,[.30,.22,.13],6);
    for(let i=0;i<4;i++){
      const bottom=.20+i*.16,top=.57+i*.14;
      tier(0,0,bottom,top,.26-i*.036,0,
        i%2?[.19,.35,.24]:[.23,.40,.25],7);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createDistantForest(ctx){
  const THREE=ctx.THREE;
  if(!THREE.InstancedMesh||!THREE.BufferGeometry||
      !THREE.Float32BufferAttribute||!THREE.Object3D){
    return {update(){},invalidate(){},clear(){},dispose(){},get count(){return 0;}};
  }
  const CAPACITY=18000;
  const geometry={
    conifer:silhouetteGeometry(THREE,'conifer'),
    birch:silhouetteGeometry(THREE,'birch'),
  };
  const material=new THREE.MeshLambertMaterial({
    vertexColors:true,side:THREE.DoubleSide,
  });
  const meshes={};
  for(const kind of ['conifer','birch']){
    const mesh=new THREE.InstancedMesh(geometry[kind],material,CAPACITY);
    mesh.name='Distant '+kind+' silhouettes';
    mesh.count=0;
    mesh.frustumCulled=false;
    mesh.castShadow=false;
    mesh.receiveShadow=false;
    mesh.renderOrder=0;
    ctx.scene.add(mesh);
    meshes[kind]=mesh;
  }
  const dummy=new THREE.Object3D();
  const cache=new Map(); // keyed 24m chunk; bounded to current visibility
  let queue=[],lastCx=null,lastCz=null,lastRange=null,lastSeed=null,lastNear=null;
  let dirty=true;
  const rand=(x,z,n=0)=>{
    const value=Math.sin(x*127.1+z*311.7+n*78.233+ctx.seed)*43758.5453;
    return value-Math.floor(value);
  };
  const key=(cx,cz)=>cx+','+cz;

  function makeChunk(cx,cz){
    const trees=[];
    for(let i=0;i<TREES_PER_CHUNK;i++){
      if(!treeCanSpawn(cx,cz,i,rand,ctx.chunkSize))continue;
      const point=treeCandidate(cx,cz,i,rand,ctx.chunkSize);
      if(!point||ctx.felled.has(key(cx,cz)+':'+i))continue;
      if(ctx.terrain.waterDepthAt(point.x,point.z)>.12)continue;
      const {x,z}=point;
      trees.push({
        id:key(cx,cz)+':'+i,
        kind:rand(x,z,703)<.2?'birch':'conifer',x,z,
        y:ctx.terrain.heightAt(x,z),
        height:7.5+rand(x,z,4)*6.5,
        scale:.9+rand(x,z,5)*.65,
      });
    }
    return trees;
  }

  function rebuild(){
    const counts={conifer:0,birch:0};
    for(const trees of cache.values())for(const tree of trees){
      const i=counts[tree.kind]++;
      if(i>=CAPACITY){counts[tree.kind]=CAPACITY;continue;}
      dummy.position.set(tree.x,tree.y,tree.z);
      dummy.rotation.set(0,0,0);
      dummy.scale.set(tree.height*tree.scale,tree.height,tree.height*tree.scale);
      dummy.updateMatrix();
      meshes[tree.kind].setMatrixAt(i,dummy.matrix);
    }
    for(const kind of ['conifer','birch']){
      meshes[kind].count=counts[kind];
      meshes[kind].instanceMatrix.needsUpdate=true;
    }
    dirty=false;
  }

  function update(){
    const size=ctx.chunkSize;
    const cx=Math.floor(ctx.px/size),cz=Math.floor(ctx.pz/size);
    const near=ctx.radius??3; // detailed forest; retained chunks are excluded below
    const range=Math.ceil(distantForestRange(ctx.terrain)/size);
    if(cx!==lastCx||cz!==lastCz||near!==lastNear||
        range!==lastRange||ctx.seed!==lastSeed){
      if(ctx.seed!==lastSeed)cache.clear();
      lastCx=cx;lastCz=cz;lastRange=range;lastNear=near;lastSeed=ctx.seed;
      const desired=new Set();
      const radius=(range+.5)*size;
      const radiusSq=radius*radius;
      for(let ix=cx-range;ix<=cx+range;ix++)for(let iz=cz-range;iz<=cz+range;iz++){
        if(Math.abs(ix-cx)<=near&&Math.abs(iz-cz)<=near)continue;
        if(ctx.chunks?.has(key(ix,iz)))continue;
        const dx=(ix+.5)*size-ctx.px,dz=(iz+.5)*size-ctx.pz;
        if(dx*dx+dz*dz>radiusSq)continue;
        desired.add(key(ix,iz));
      }
      for(const k of cache.keys())if(!desired.has(k)){cache.delete(k);dirty=true;}
      // Nearest missing chunks first. Work is divided over world ticks to avoid
      // generating thousands of tree candidates in a single frame.
      queue=[...desired].filter(k=>!cache.has(k)).map(k=>{
        const [x,z]=k.split(',').map(Number);
        return {k,x,z,d:(x+.5-cx)**2+(z+.5-cz)**2};
      }).sort((a,b)=>a.d-b.d);
    }
    for(let i=0;i<DISTANT_FOREST_CHUNKS_PER_TICK&&queue.length;i++){
      const next=queue.shift();
      cache.set(next.k,makeChunk(next.x,next.z));
      dirty=true;
    }
    if(dirty)rebuild();
  }
  function invalidate(){
    // E.g. a remote player fells a distant tree or the world is restored.
    cache.clear();queue=[];lastCx=null;lastCz=null;dirty=true;
    rebuild();
  }
  function invalidateTree(id){
    const chunkKey=String(id).split(':')[0];
    const trees=cache.get(chunkKey);
    if(!trees)return;
    const kept=trees.filter(tree=>tree.id!==id);
    if(kept.length===trees.length)return;
    cache.set(chunkKey,kept);
    dirty=true;
    rebuild();
  }
  function clear(){
    invalidate();
    lastSeed=null;
  }
  function dispose(){
    for(const mesh of Object.values(meshes)){
      ctx.scene.remove(mesh);
      mesh.dispose();
    }
    for(const geo of Object.values(geometry))geo.dispose();
    material.dispose();
    cache.clear();queue=[];
  }
  return {update,invalidate,invalidateTree,clear,dispose,meshes,
    get count(){return meshes.conifer.count+meshes.birch.count;},
    get pending(){return queue.length;},
    get chunkCount(){return cache.size;},
  };
}
