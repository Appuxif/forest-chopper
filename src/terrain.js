// Chunked heightfield and local water geometry.
import {baseTerrainHeight} from './terrain-noise.js';
import {pondHeightAt,pondDepthAt,pondsNearTile,pondSandAt,pondPoint} from './ponds.js';
import {lakesNearTile,lakePoint} from './lakes.js';

export function terrainHeight(seed,x,z){
  const base=baseTerrainHeight(seed,x,z);
  return pondHeightAt(seed,x,z,base);
}

export class TerrainSystem {
  constructor(THREE, {scene, camera=null, material, chunkSize=96, segments=48, radius=3}) {
    this.THREE = THREE;
    this.chunkSize = chunkSize;
    this.segments = segments;
    this.radius = radius;
    this.baseRadius = radius;
    this.camera = camera;
    this.baseCameraFar = camera?.far ?? 280;
    this.baseFogDensity = scene.fog?.density ?? .012;
    this.fog = scene.fog;
    this.visibility = 0;
    this.visibilityTarget = 0;
    this.lastVisibilityTick = null;
    this.lastRadius = null;
    this.seed = null;
    this.chunks = new Map();
    this.lakeMeshes = new Map();
    this.centerX = null;
    this.centerZ = null;

    this.group = new THREE.Group();
    this.group.name = 'Terrain';
    // Preserve ground.material for the existing grass-density shader controls.
    this.group.material = material;
    this.group.receiveShadow = true;
    // Clear, depth-tinted pond water. The bottom remains visible, especially
    // around the shore; a gentle Fresnel term keeps grazing angles reflective.
    // One shared material and one draw call per pond, no reflection render pass.
    this.waterTime={value:0};
    this.waterMaterial=new THREE.MeshPhongMaterial({
      color:0xa2dfdf,emissive:0x000000,specular:0xe2ffff,
      shininess:125,transparent:true,opacity:.58,depthWrite:false,
      side:THREE.DoubleSide,
    });
    this.waterMaterial.onBeforeCompile=shader=>{
      shader.uniforms.fcWaterTime=this.waterTime;
      shader.vertexShader=shader.vertexShader
        .replace('#include <common>',`#include <common>
          attribute float fcWaterDepth;
          varying float vFcWaterDepth;
          varying vec3 vFcWaterWorld;`)
        .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
          vFcWaterDepth=fcWaterDepth;
          vFcWaterWorld=(modelMatrix*vec4(transformed,1.0)).xyz;`);
      shader.fragmentShader=shader.fragmentShader
        .replace('#include <common>',`#include <common>
          varying float vFcWaterDepth;
          varying vec3 vFcWaterWorld;
          uniform float fcWaterTime;`)
        .replace('#include <map_fragment>',`#include <map_fragment>
          // Transparent shallows, slightly deeper blue-green toward the center.
          float fcDepth=smoothstep(0.0,2.5,max(0.0,vFcWaterDepth));
          float fcGrazing=pow(1.0-clamp(abs(normalize(
            cameraPosition-vFcWaterWorld).y),0.0,1.0),2.0);
          float fcRipples=sin(vFcWaterWorld.x*1.8+vFcWaterWorld.z*.55+
            fcWaterTime*.65)*sin(vFcWaterWorld.z*1.6-
            vFcWaterWorld.x*.42-fcWaterTime*.48);
          diffuseColor.rgb*=mix(vec3(1.0),vec3(.67,.90,.96),fcDepth*.56);
          diffuseColor.rgb+=vec3(.018,.030,.030)*fcRipples;
          diffuseColor.a*=mix(.24,.78,fcDepth);
          diffuseColor.a*=1.0+fcGrazing*.38;
          diffuseColor.a=clamp(diffuseColor.a,0.0,.72);`);
    };
    scene.add(this.group);
  }

  heightAt(x,z){return terrainHeight(this.seed??0,x,z);}
  normalAt(x,z){
    const step=.75;
    const dx=(this.heightAt(x+step,z)-this.heightAt(x-step,z))/(2*step);
    const dz=(this.heightAt(x,z+step)-this.heightAt(x,z-step))/(2*step);
    const length=Math.hypot(dx,1,dz);
    return {x:-dx/length,y:1/length,z:-dz/length};
  }
  surfaceAt(x,z){return pondDepthAt(this.seed??0,x,z)>.05?'pond':'ground';}
  waterDepthAt(x,z){return pondDepthAt(this.seed??0,x,z);}

  createWaterSurface(body){
    const {THREE}=this;
    const lake=body.kind==='lake';
    const sections=lake?128:72;
    const rings=lake?7:3;
    const point=lake?lakePoint:pondPoint;
    const radii=new Float32Array(sections);
    for(let i=0;i<sections;i++){
      const angle=i*Math.PI*2/sections;
      let low=0,high=1.15;
      for(let n=0;n<11;n++){
        const middle=(low+high)*.5;
        const [x,z]=point(body,middle,angle);
        if(this.heightAt(x,z)<body.level)low=middle;
        else high=middle;
      }
      radii[i]=Math.min(1.15,(low+high)*.5+.006);
    }
    const positions=[],depths=[],indices=[];
    for(let ring=0;ring<=rings;ring++){
      for(let i=0;i<sections;i++){
        const angle=i*Math.PI*2/sections;
        const [x,z]=point(body,radii[i]*ring/rings,angle);
        positions.push(x,body.level+.025,z);
        depths.push(Math.max(0,body.level-this.heightAt(x,z)));
      }
    }
    for(let ring=0;ring<rings;ring++){
      const inner=ring*sections,outer=(ring+1)*sections;
      for(let i=0;i<sections;i++){
        const next=(i+1)%sections;
        indices.push(inner+i,outer+next,outer+i,
          inner+i,inner+next,outer+next);
      }
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geo.setAttribute('fcWaterDepth',new THREE.Float32BufferAttribute(depths,1));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,this.waterMaterial);
    mesh.name=(lake?'Lake ':'Pond ')+body.gx+','+body.gz;
    mesh.renderOrder=1;
    mesh.receiveShadow=false;
    this.group.add(mesh);
    return mesh;
  }

  syncLakes(){
    const needed=new Map();
    for(const key of this.chunks.keys()){
      const [cx,cz]=key.split(',').map(Number);
      const x0=cx*this.chunkSize,z0=cz*this.chunkSize;
      for(const lake of lakesNearTile(this.seed,x0,z0,this.chunkSize))
        needed.set(lake.id,lake);
    }
    for(const [id,entry] of this.lakeMeshes){
      if(needed.has(id))continue;
      this.group.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      this.lakeMeshes.delete(id);
    }
    for(const [id,body] of needed){
      if(this.lakeMeshes.has(id))continue;
      this.lakeMeshes.set(id,{body,mesh:this.createWaterSurface(body)});
    }
  }

  createChunk(cx, cz) {
    const {THREE, chunkSize: size, segments} = this;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const uvs = geometry.getAttribute('uv');
    const centerX = (cx + 0.5) * size;
    const centerZ = (cz + 0.5) * size;
    const step=size/segments;
    const coastalPonds=pondsNearTile(this.seed,cx*size,cz*size,size);
    const shoreline=new Float32Array(positions.count*2);
    // One extra vertex on each side gives smooth, matching normals at seams.
    const stride=segments+3;
    const heights=new Float64Array(stride*stride);
    for(let row=-1;row<=segments+1;row++){
      const z=centerZ-size/2+row*step;
      for(let col=-1;col<=segments+1;col++){
        const x=centerX-size/2+col*step;
        heights[(row+1)*stride+col+1]=this.heightAt(x,z);
      }
    }
    for(let row=0;row<=segments;row++){
      for(let col=0;col<=segments;col++){
        const i=row*(segments+1)+col;
        const x=centerX-size/2+col*step;
        const z=centerZ-size/2+row*step;
        const sample=(r,c)=>heights[(r+1)*stride+c+1];
        const groundY=sample(row,col);
        positions.setZ(i,groundY);
        let sand=0,wet=0;
        for(const pond of coastalPonds){
          const coast=pondSandAt(pond,x,z,groundY);
          if(coast.sand>sand){sand=coast.sand;wet=coast.wet;}
        }
        shoreline[i*2]=sand;
        shoreline[i*2+1]=wet;
        const dx=(sample(row,col+1)-sample(row,col-1))/(2*step);
        const dz=(sample(row+1,col)-sample(row-1,col))/(2*step);
        // Geometry is rotated -90° around X into world X/Z.
        const inv=1/Math.hypot(dx,1,dz);
        normals.setXYZ(i,-dx*inv,dz*inv,inv);
        // Preserve the original shared 28m texture tiling, no UV seams.
        uvs.setXY(i,(x+1000)/2000,(1000-z)/2000);
      }
    }
    geometry.setAttribute('fcShoreData',new THREE.BufferAttribute(shoreline,2));
    positions.needsUpdate=true;
    normals.needsUpdate=true;
    uvs.needsUpdate=true;
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.group.material);
    mesh.name = `Terrain ${cx},${cz}`;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(centerX, 0, centerZ);
    mesh.receiveShadow = this.group.receiveShadow;
    this.group.add(mesh);
    mesh.userData.ponds=[];
    mesh.userData.waterMeshes=[];
    const sites=coastalPonds.filter(p=>p.kind!=='lake'&&
      p.x>=cx*size&&p.x<(cx+1)*size&&p.z>=cz*size&&p.z<(cz+1)*size);
    for(const pond of sites){
      const water=this.createWaterSurface(pond);
      mesh.userData.waterMeshes.push(water);
      mesh.userData.ponds.push(pond);
    }
    return mesh;
  }

  // Lake panorama: dissolve the fog and move the far clipping plane as the
  // shore approaches. Preserve the existing misty forest away from lakes.
  updateVisibilityTarget(x,z){
    let influence=0;
    for(const lake of lakesNearTile(this.seed,x-380,z-380,760)){
      const dx=x-lake.x,dz=z-lake.z;
      const normalized=Math.hypot(
        (dx*lake.cos+dz*lake.sin)/lake.rx,
        (-dx*lake.sin+dz*lake.cos)/lake.rz
      );
      // Fully clear along the water; ease back to forest fog ~100m inland.
      const distance=Math.max(0,(normalized-1)*Math.min(lake.rx,lake.rz));
      const value=1-Math.max(0,Math.min(1,(distance-25)/105));
      const smooth=value*value*(3-2*value);
      influence=Math.max(influence,smooth);
    }
    this.visibilityTarget=influence;
    // Extra terrain needed before the fog clears; avoid exposing a hard
    // square edge of the heightfield across the far shore.
    this.radius=Math.max(influence,this.visibility)>.06
      ?this.baseRadius+1:this.baseRadius;
  }

  tick(now){
    this.waterTime.value=now*.001;
    const dt=this.lastVisibilityTick===null?0:Math.max(0,Math.min(.1,(now-this.lastVisibilityTick)*.001));
    this.lastVisibilityTick=now;
    const t=1-Math.exp(-dt*2.6);
    this.visibility+=(this.visibilityTarget-this.visibility)*t;
    if(Math.abs(this.visibilityTarget-this.visibility)<.001)
      this.visibility=this.visibilityTarget;
    if(this.fog)
      this.fog.density=this.baseFogDensity+
        (.0032-this.baseFogDensity)*this.visibility;
    if(this.camera){
      const targetFar=this.baseCameraFar+100*this.visibility;
      if(Math.abs(this.camera.far-targetFar)>1){
        this.camera.far=targetFar;
        this.camera.updateProjectionMatrix();
      }
    }
  }

  setSeed(seed) {
    if (this.seed === seed) return;
    this.clear();
    this.seed = seed;
    this.visibilityTarget=0;
  }

  update(x, z, seed) {
    this.setSeed(seed);
    this.updateVisibilityTarget(x,z);
    const cx = Math.floor(x / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    if (this.centerX === cx && this.centerZ === cz && this.lastRadius === this.radius) return;
    for (let dx = -this.radius; dx <= this.radius; dx++) {
      for (let dz = -this.radius; dz <= this.radius; dz++) {
        const tx = cx + dx, tz = cz + dz, key = `${tx},${tz}`;
        if (!this.chunks.has(key)) this.chunks.set(key, this.createChunk(tx, tz));
      }
    }
    for (const [key, mesh] of this.chunks) {
      const [tx, tz] = key.split(',').map(Number);
      if (Math.abs(tx - cx) > this.radius || Math.abs(tz - cz) > this.radius) {
        this.releaseChunk(mesh);
        this.chunks.delete(key);
      }
    }
    this.syncLakes();
    this.centerX = cx;
    this.centerZ = cz;
    this.lastRadius=this.radius;
  }

  releaseChunk(mesh){
    for(const water of mesh.userData.waterMeshes??[]){
      this.group.remove(water);
      water.geometry.dispose();
    }
    this.group.remove(mesh);
    mesh.geometry.dispose();
  }

  clear() {
    for (const mesh of this.chunks.values()) this.releaseChunk(mesh);
    this.chunks.clear();
    this.lastRadius=null;
    for(const {mesh} of this.lakeMeshes.values()){
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.lakeMeshes.clear();
    this.centerX = this.centerZ = null;
  }

  dispose() {
    this.clear();
    this.group.parent?.remove(this.group);
    this.waterMaterial.dispose();
    if(this.fog)this.fog.density=this.baseFogDensity;
    if(this.camera){
      this.camera.far=this.baseCameraFar;
      this.camera.updateProjectionMatrix();
    }
    // Shared ground material/texture are owned by the caller.
  }
}
