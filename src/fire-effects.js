// Instanced campfire/torch VFX adapted from campfire_smoke_isolated.html.
// Shared shader/geometry, bounded instance counts, no per-frame mesh allocation.
export const FIRE_TIERS=Object.freeze({
 ultra:Object.freeze({smoke:30,flames:7,sparks:6}),
 high:Object.freeze({smoke:10,flames:3,sparks:3}),
 medium:Object.freeze({smoke:0,flames:1,sparks:1}),
 low:Object.freeze({smoke:0,flames:0,sparks:0}),
 glow:Object.freeze({smoke:0,flames:0,sparks:0}),
 off:Object.freeze({smoke:0,flames:0,sparks:0}),
});
export const TORCH_TIERS=Object.freeze({
 ultra:Object.freeze({smoke:20,flames:5,sparks:3}),
 high:Object.freeze({smoke:10,flames:2,sparks:1}),
 medium:Object.freeze({smoke:0,flames:1,sparks:0}),
 low:FIRE_TIERS.low,glow:FIRE_TIERS.glow,off:FIRE_TIERS.off,
});
const DOWNGRADE=Object.freeze({ultra:'high',high:'medium',medium:'low',low:'glow'});
export const SMOKE_OPACITY=.10; // Screenshot: 90% transparency.
export const DEMO_FLAME_HEIGHT=1.45;
export function fireBaseRadius(kind){return kind==='torch'?.145*.7:.70*.5;}
export function fireHeight(kind){return kind==='torch'?.60:1.00;}
// Uniform scale of the entire reference simulation (not individual particles).
export function fireVisualScale(kind){return (kind==='torch'?.60:.80)/DEMO_FLAME_HEIGHT;}
export function resolveFireTier(preset,distance){
 const selected=['ultra','high','medium','low'].includes(preset)?preset:'high';
 if(distance>=100)return 'glow';
 return distance>=50?DOWNGRADE[selected]:selected;
}
export function firePreset(settings){
 if(settings?.performancePreset!=='custom')return settings?.performancePreset??'low';
 return settings.quality==='high'?'ultra':settings.quality==='balanced'?'high':'medium';
}

// Reproduce the source HTML's LCG and random-call order. The source first
// constructs five logs (3 random values each), then 48 flames, 660 smoke
// puffs and 160 embers. We retain only the instances the game actually needs.
function sourceLayout(){
 let state=712903;
 const random=()=>((state=(1664525*state+1013904223)>>>0)/4294967296);
 const between=(lo,hi)=>lo+(hi-lo)*random();
 for(let i=0;i<5;i++){between(-.04,.13);between(-.14,.14);between(-.14,.14);}
 const flames=[];
 for(let i=0;i<48;i++){
  const a=between(0,Math.PI*2);
  const r=i<4?between(0,.2):between(.15,.57);
  const seed=between(0,100);
  const flame={x:Math.cos(a)*r,z:Math.sin(a)*r,seed,rot:between(0,Math.PI*2),
   total:between(.66,1.40)*(i<3?1.16:1),
   width:between(.85,1.15),height:between(.78,1.23)};
  if(i<10)flames.push(flame);
 }
 const puffs=[];
 for(let i=0;i<660;i++){
  const puff={phase:random(),angle:between(0,Math.PI*2),
   radius:Math.sqrt(random()),seed:between(0,300),rise:between(.75,1.36),
   shape:[between(.72,1.42),between(.74,1.5),between(.73,1.45)]};
  if(i<30)puffs.push(puff);
 }
 const embers=[];
 for(let i=0;i<160;i++){
  const ember={phase:random(),angle:between(0,6.28),
   radius:between(.1,.55),velocity:between(.18,.48),seed:between(0,40)};
  if(i<6)embers.push(ember);
 }
 return {flames,puffs,embers};
}
const SOURCE_LAYOUT=sourceLayout();

const cache=new WeakMap();
function assets(THREE){
 let a=cache.get(THREE);
 if(a)return a;
 const flameVertex=[
 'uniform float uTime;attribute float aSeed;varying float vH;varying float vAround;',
 'void main(){float h=clamp(position.y,0.,1.);vH=h;vAround=uv.x;',
 'vec3 p=position;p.xz*=1.0+sin(uTime*8.2+aSeed*9.+h*13.)*.055;',
 'vec4 local=instanceMatrix*vec4(p,1.0);',
 'local.x+=sin(uTime*4.3+aSeed*5.+h*8.)*.17*h*h;',
 'local.z+=cos(uTime*3.7+aSeed*4.+h*6.)*.15*h*h;',
 'vec4 wp=modelMatrix*local;',
 'gl_Position=projectionMatrix*viewMatrix*wp;}',
 ].join('\n');
 const flameFragment=[
 'varying float vH;varying float vAround;',
 'void main(){float h=clamp(vH,0.,1.);',
 'vec3 low=vec3(1.0,.92,.51),mid=vec3(1.0,.34,.04),high=vec3(.68,.055,.008);',
 'vec3 c=mix(low,mid,smoothstep(.08,.53,h));c=mix(c,high,smoothstep(.56,.98,h));',
 'float fade=smoothstep(0.,.08,h)*(1.-smoothstep(.55,1.,h));',
 'float f=.84+.16*sin(vAround*21.+h*17.);gl_FragColor=vec4(c,fade*f*.67);}',
 ].join('\n');
 const smokeVertex=[
 'varying vec3 vNormalView;varying float vLocalY;varying vec3 vWorldPos;',
 'void main(){vec4 local=instanceMatrix*vec4(position,1.0);',
 'vec4 wp=modelMatrix*local;vWorldPos=wp.xyz;',
 'vLocalY=local.y;',
 'vec3 sizes=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));',
 'vec3 n=mat3(instanceMatrix)*(normal/max(sizes*sizes,vec3(.00001)));',
 'vNormalView=normalize(normalMatrix*n);gl_Position=projectionMatrix*viewMatrix*wp;}',
 ].join('\n');
 const smokeFragment=[
 'uniform float uOpacity;varying vec3 vNormalView;varying float vLocalY;varying vec3 vWorldPos;',
 'void main(){float front=clamp(vNormalView.z,0.,1.);',
 'float softened=pow(front,1.8);',
 'float noise=.91+.09*sin(vWorldPos.x*4.3+vWorldPos.y*1.87+vWorldPos.z*3.6);',
 'float warm=1.-smoothstep(.8,3.7,vLocalY);',
 'vec3 color=mix(vec3(.63,.68,.74),vec3(.65,.54,.46),warm*.6);',
 'gl_FragColor=vec4(color,uOpacity*softened*noise);}',
 ].join('\n');
 const flameGeo=new THREE.ConeGeometry(1,1,9,13,true);
 flameGeo.translate(0,.5,0);
 const seeds=new Float32Array(10);
 for(let i=0;i<10;i++)seeds[i]=SOURCE_LAYOUT.flames[i].seed;
 flameGeo.setAttribute('aSeed',new THREE.InstancedBufferAttribute(seeds,1));
 const smokeGeo=new THREE.SphereGeometry(1,12,10);
 const sparkGeo=new THREE.SphereGeometry(.035,6,5);
 const flameMat=new THREE.ShaderMaterial({uniforms:{uTime:{value:0}},
   vertexShader:flameVertex,fragmentShader:flameFragment,
   transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending});
 const smokeMat=new THREE.ShaderMaterial({
   uniforms:{uOpacity:{value:SMOKE_OPACITY}},
   vertexShader:smokeVertex,fragmentShader:smokeFragment,
   transparent:true,depthWrite:false,depthTest:true,side:THREE.FrontSide});
 const sparkMat=new THREE.MeshBasicMaterial({color:0xffae4b,transparent:true,
   blending:THREE.AdditiveBlending,depthWrite:false});
 let glowTexture=null;
 // A procedural additive sprite: no HTML, network dependency, or terrain mesh.
 if(typeof document!=='undefined'&&THREE.CanvasTexture){
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=64;
  const brush=canvas.getContext('2d');
  if(brush){
   const gradient=brush.createRadialGradient(32,32,0,32,32,32);
   gradient.addColorStop(0,'rgba(255,198,92,.95)');
   gradient.addColorStop(.19,'rgba(255,116,30,.65)');
   gradient.addColorStop(1,'rgba(255,75,15,0)');
   brush.fillStyle=gradient;brush.fillRect(0,0,64,64);
   glowTexture=new THREE.CanvasTexture(canvas);
  }
 }
 a={flameGeo,smokeGeo,sparkGeo,flameMat,smokeMat,sparkMat,glowTexture};
 cache.set(THREE,a);
 return a;
}
function seeded(n){return (Math.sin(n*129.31+18.72)*43758.5453)%1;}
function unit(n){return seeded(n)-Math.floor(seeded(n));}
function range(n,low,high){return low+(high-low)*unit(n);}
function makeInstanced(THREE,geo,material,count,dynamic=false){
 const mesh=new THREE.InstancedMesh(geo,material,count);
 mesh.count=0;mesh.visible=false;
 mesh.frustumCulled=false; // Explicit camera-frustum test in the owning game system.
 if(dynamic)mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
 mesh.castShadow=false;mesh.receiveShadow=false;
 return mesh;
}

export function createFireEffects(THREE,parent,kind){
 const a=assets(THREE),torch=kind==='torch';
 const scale=fireVisualScale(kind),baseRadius=fireBaseRadius(kind);
 const anchor=new THREE.Group();
 // Reference coordinates remain unmodified: flames start at .41, smoke .74, sparks .55.
 // Their geometry, drift, rise, and size are scaled together by the parent transform.
 anchor.position.y=torch?1.48:.25;
 anchor.scale.setScalar(scale);
 parent.add(anchor);
 const flames=makeInstanced(THREE,a.flameGeo,a.flameMat,10);
 const smoke=makeInstanced(THREE,a.smokeGeo,a.smokeMat,30,true);
 const sparks=makeInstanced(THREE,a.sparkGeo,a.sparkMat,6,true);
 anchor.add(flames);anchor.add(smoke);anchor.add(sparks);
 const dummy=new THREE.Object3D();
const flameDescriptors=SOURCE_LAYOUT.flames;
 const puffs=SOURCE_LAYOUT.puffs.map(p=>({
  ...p,cycle:0,x:0,y:0,z:0,sx:1,sy:1,sz:1,dist:0,rotation:0,
 }));
 const ordered=puffs.slice();
 const emberDescriptors=SOURCE_LAYOUT.embers;
 // Glow is a tiny billboard instead of any distant flame/smoke geometry.
 const glow=a.glowTexture&&THREE.Sprite?new THREE.Sprite(new THREE.SpriteMaterial({
  map:a.glowTexture,color:0xffb36d,transparent:true,depthWrite:false,
  blending:THREE.AdditiveBlending})):null;
 if(glow){
  glow.position.y=torch?.10:.45;
  const size=torch?.55:1.55;
  glow.scale.set(size,size,1);
  glow.visible=false;anchor.add(glow);
 }
 let tier='off',lastUpdate=null;
 function setTier(next){
  if(next===tier)return;
  tier=next;
  const config=(torch?TORCH_TIERS:FIRE_TIERS)[tier]??FIRE_TIERS.off;
  flames.count=config.flames;smoke.count=config.smoke;sparks.count=config.sparks;
  flames.visible=config.flames>0;smoke.visible=config.smoke>0;sparks.visible=config.sparks>0;
  if(glow)glow.visible=tier==='glow';
  if(config.flames){
   for(let i=0;i<config.flames;i++){
    const f=flameDescriptors[i],s=f.total;
    dummy.position.set(f.x,.41-(torch?0:.20/scale),f.z);
    dummy.rotation.set(0,f.rot,0);
    // Preserve the requested campfire/torch cone-base widths inside a uniform VFX scale.
    const width=(baseRadius/scale)*s*f.width*(tier==='medium'?1.45:1);
    dummy.scale.set(width,fireHeight(kind)/scale*s*f.height,width);
    dummy.updateMatrix();flames.setMatrixAt(i,dummy.matrix);
   }
   flames.instanceMatrix.needsUpdate=true;
  }
 }
 function tick(now,cameraPos,worldPos,reducedMotion=false){
  if(!Number.isFinite(now))return;
  const config=(torch?TORCH_TIERS:FIRE_TIERS)[tier]??FIRE_TIERS.off;
  if(!config.smoke&&!config.sparks&&!config.flames)return;
  const time=reducedMotion?0:now*.001;
  a.flameMat.uniforms.uTime.value=time;
  if(lastUpdate!==null&&now>=lastUpdate&&now-lastUpdate<32)return;
  lastUpdate=now;
  if(config.smoke){
   const count=config.smoke;
   for(let i=0;i<count;i++){
    const p=puffs[i],progress=p.phase+time*.111*p.rise;
    const cycle=Math.floor(progress),phase=progress-cycle;
    // The HTML generator respawns smoke with a new angle, spread and seed
    // after each ascent. Use reproducible per-cycle randomness so culled
    // fires can resume at the correct phase without simulating offscreen.
    if(cycle!==p.cycle){
     p.cycle=cycle;
     p.angle=range(i*13+8+cycle*337,0,Math.PI*2);
     p.radius=Math.sqrt(unit(i*13+9+cycle*337));
     p.seed=range(i*13+10+cycle*337,0,300);
    }
    const spread=.095+1.14*Math.pow(phase,1.13);
    const radial=spread*p.radius,angle=p.angle+phase*3+time*.23;
    const wobble=.09+.33*phase;
    p.x=Math.cos(angle)*radial+Math.sin(time*.76+p.seed)*wobble;
    p.z=Math.sin(angle)*radial+Math.cos(time*.52+p.seed*.81)*wobble*.7;
    p.y=.74+7.6*phase+Math.sin(p.seed+time*1.3)*.05*phase;
    const falloff=Math.max(.015,Math.min(1,phase/.085,(1-phase)/.105));
    const radius=(.135+1.05*Math.pow(phase,.87))*falloff;
    [p.sx,p.sy,p.sz]=p.shape.map(v=>radius*v);
    p.rotation=time*.08+p.angle;
    const dx=(worldPos?.x??0)+scale*p.x-(cameraPos?.x??0);
    const dy=(worldPos?.y??0)+anchor.position.y+scale*p.y-(cameraPos?.y??0);
    const dz=(worldPos?.z??0)+scale*p.z-(cameraPos?.z??0);
    p.dist=dx*dx+dy*dy+dz*dz;
    ordered[i]=p;
   }
   // The original generator sorts transparent spheres back-to-front.
   // Bounded at 30, so no allocations or expensive cross-scene sorting.
   for(let i=1;i<count;i++){
    const p=ordered[i];let j=i-1;
    while(j>=0&&ordered[j].dist<p.dist){ordered[j+1]=ordered[j];j--;}
    ordered[j+1]=p;
   }
   for(let i=0;i<count;i++){
    const p=ordered[i];
    dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,p.rotation,0);
    dummy.scale.set(p.sx,p.sy,p.sz);dummy.updateMatrix();
    smoke.setMatrixAt(i,dummy.matrix);
   }
   smoke.instanceMatrix.needsUpdate=true;
  }
  if(config.sparks){
   for(let i=0;i<config.sparks;i++){
    const e=emberDescriptors[i],p=(e.phase+time*e.velocity)%1;
    dummy.position.set(Math.cos(e.angle+time*.3)*e.radius+Math.sin(time+e.seed)*p*.15,
      .55+p*4.7,
      Math.sin(e.angle+time*.3)*e.radius+Math.cos(time*.8+e.seed)*p*.16);
    const size=Math.max(.0001,(1-p)*(.05+.09*(.5+.5*Math.sin(e.seed*9.17)))/.035);
    dummy.rotation.set(0,0,0);dummy.scale.set(size,size,size);
    dummy.updateMatrix();sparks.setMatrixAt(i,dummy.matrix);
   }
   sparks.instanceMatrix.needsUpdate=true;
  }
 }
 function dispose(){
  // Shared geometry/material/texture belong to the THREE-level cache.
  flames.dispose?.();smoke.dispose?.();sparks.dispose?.();
  glow?.material?.dispose?.();
  parent.remove?.(anchor);
 }
 return {anchor,flames,smoke,sparks,glow,setTier,tick,dispose,get visualScale(){return scale;},get tier(){return tier;}};
}

// A single frustum is reused across all fires in a tick (not one per fire).
export function createFireVisibilityTester(ctx){
 const THREE=ctx.THREE;
 const supported=!!(THREE.Frustum&&THREE.Matrix4&&THREE.Sphere&&THREE.Vector3);
 const frustum=supported?new THREE.Frustum():null;
 const matrix=supported?new THREE.Matrix4():null;
 const sphere=supported?new THREE.Sphere():null;
 const center=supported?new THREE.Vector3():null;
 let available=false;
 return {
  begin(){
   const camera=ctx.camera;
   available=!!(frustum&&camera?.projectionMatrix&&camera?.matrixWorldInverse);
   if(!available)return;
   camera.updateMatrixWorld?.();
   matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
   frustum.setFromProjectionMatrix(matrix);
  },
  visible(x,y,z,kind,distance){
   if(!available)return true;
   const scale=kind==='torch'?.1:1;
   const far=distance>=100;
   center.set(x,y+(kind==='torch'?1.9:0)+(far?.5:4*scale),z);
   sphere.set(center,far?1:5*scale);
   return frustum.intersectsSphere(sphere);
  },
 };
}
