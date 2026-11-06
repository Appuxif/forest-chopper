// Baked ground AO: workers build a root-distance field for each *geometry*
// grass tile. Terrain shades with one windowed texture atlas, never drawing
// discs per frame on the main thread or adding geometry/shadow passes.
import {generateBladeRoots} from './grass-clumps-core.mjs';

export const GRASS_AO_TILE_METERS=12;
export const GRASS_AO_MAX_DISTANCE=1.0; // metres, including a neighbour border
export const GRASS_AO_DEFAULT_RESOLUTION=128;
export const GRASS_AO_DEFAULT_WINDOW=5;
const SQRT2=Math.SQRT2;

export function grassAORootOffsets(clusterConfig=null){
  if(!clusterConfig)return [[0,0]];
  const n=clusterConfig.grassClusterBlades;
  const roots=generateBladeRoots({
    seed:clusterConfig.grassClusterSeed,bladesPerClump:n,
    bladeGapMin:clusterConfig.grassClusterBladeGapMin,
    bladeGapMax:clusterConfig.grassClusterBladeGapMax,
  });
  // Classic geometry rotates the individual blade silhouette, not its
  // root placement. Match makeClassicGrassClumpGeometry exactly.
  return roots.map(root=>[root.x,root.z]);
}

// Packed samples: x,y,z,yaw,height,...; ordinary records are also supported.
// "sampling" is a deterministic percentage of roots (world/tile stable).
export function bakeGrassAO({samples,tx,tz,size=GRASS_AO_TILE_METERS,
  resolution=GRASS_AO_DEFAULT_RESOLUTION,clusterConfig=null,sampling=100}){
  const res=Math.max(16,Math.min(256,resolution|0));
  const pixelMetres=size/res;
  const pad=Math.ceil(GRASS_AO_MAX_DISTANCE/pixelMetres)+1;
  const width=res+2*pad,length=width*width;
  const distances=new Float32Array(length);
  distances.fill(1e5);
  const roots=grassAORootOffsets(clusterConfig);
  const packed=samples instanceof Float32Array;
  const count=packed?Math.floor(samples.length/9):samples.length;
  const share=Math.max(0,Math.min(100,sampling))/100;
  const tileX=tx*size,tileZ=tz*size;
  for(let i=0;i<count;i++){
    const j=i*9;
    const x=packed?samples[j]:samples[i].x;
    const z=packed?samples[j+2]:samples[i].z;
    const yaw=packed?samples[j+3]:(samples[i].yaw??samples[i].angle??0);
    const scale=packed?samples[j+4]:(samples[i].height??samples[i].scale??1);
    const min=clusterConfig?.grassClusterMinHeight??0;
    const max=clusterConfig?.grassClusterMaxHeight??0;
    const norm=Math.max(0,Math.min(1,(scale-min)/Math.max(.001,max-min)));
    const visualScale=clusterConfig ? (.82+.40*norm)*((min+max)*.5/.525):1;
    const c=Math.cos(yaw),s=Math.sin(yaw);
    for(let k=0;k<roots.length;k++){
      // Avoid transcendental hash per blade. Stable across remeshing/visits.
      const h=(Math.imul(i+1,73856093)^Math.imul(k+1,19349663)^
        Math.imul(tx+1,83492791)^Math.imul(tz+1,2654435761))>>>0;
      if((h%10000)/10000>=share)continue;
      const [rx,rz]=roots[k],gx=x+visualScale*(rx*c-rz*s);
      const gz=z+visualScale*(rx*s+rz*c);
      const px=(gx-tileX)/pixelMetres+pad-.5;
      const py=(gz-tileZ)/pixelMetres+pad-.5;
      const ix=Math.floor(px),iy=Math.floor(py);
      for(let dz=0;dz<=1;dz++)for(let dx=0;dx<=1;dx++){
        const col=ix+dx,row=iy+dz;
        if(col<0||row<0||col>=width||row>=width)continue;
        const offset=row*width+col;
        const d=Math.hypot(px-col,py-row);
        if(d<distances[offset])distances[offset]=d;
      }
    }
  }
  // Two linear-time chamfer passes, independent of the shadow radius.
  // Unlike stamping 50-cm circles per root, complexity is O(roots + pixels).
  for(let y=0;y<width;y++)for(let x=0;x<width;x++){
    const at=y*width+x;
    let d=distances[at];
    if(x>0)d=Math.min(d,distances[at-1]+1);
    if(y>0){
      d=Math.min(d,distances[at-width]+1);
      if(x>0)d=Math.min(d,distances[at-width-1]+SQRT2);
      if(x+1<width)d=Math.min(d,distances[at-width+1]+SQRT2);
    }
    distances[at]=d;
  }
  for(let y=width-1;y>=0;y--)for(let x=width-1;x>=0;x--){
    const at=y*width+x;
    let d=distances[at];
    if(x+1<width)d=Math.min(d,distances[at+1]+1);
    if(y+1<width){
      d=Math.min(d,distances[at+width]+1);
      if(x>0)d=Math.min(d,distances[at+width-1]+SQRT2);
      if(x+1<width)d=Math.min(d,distances[at+width+1]+SQRT2);
    }
    distances[at]=d;
  }
  const ao=new Uint8Array(length),unit=pixelMetres/GRASS_AO_MAX_DISTANCE*255;
  for(let i=0;i<length;i++)ao[i]=Math.min(255,Math.round(distances[i]*unit));
  return {ao,tx,tz,resolution:res,pad,width};
}

function tileKey(tx,tz){return tx+','+tz;}
function copyTileDistance(atlas,dimensions,baked,originX,originZ,res){
  const {ao,tx,tz,pad,width}=baked;
  if(!ao||baked.resolution!==res)return;
  const tilePixelX=(tx-originX)*res-pad;
  const tilePixelZ=(tz-originZ)*res-pad;
  for(let y=0;y<width;y++){
    const dstY=tilePixelZ+y;
    if(dstY<0||dstY>=dimensions)continue;
    const sourceRow=y*width,dstRow=dstY*dimensions;
    for(let x=0;x<width;x++){
      const dstX=tilePixelX+x;
      if(dstX<0||dstX>=dimensions)continue;
      const dst=(dstRow+dstX)*4,v=ao[sourceRow+x];
      if(v<atlas[dst])atlas[dst]=v;
    }
  }
}

export function createGrassBakedAOAtlas(THREE,groundUniforms){
  if(!THREE?.DataTexture||!groundUniforms?.fcGroundGrassShadowMap)return null;
  const center=groundUniforms.fcGroundGrassShadowPatch.value;
  const cache=new Map(),pending=new Map();
  let size=0,windowTiles=0,res=0,originX=Infinity,originZ=Infinity;
  let shownX=Infinity,shownZ=Infinity;
  let texture=null,pixels=null,dirty=true,uploads=0,lastUpload=-Infinity,applied=0;
  let cacheLimit=64;
  function configure(options={}){
    const nextRes=[64,128,256].includes(options.resolution)?options.resolution:128;
    const nextWindow=[3,5].includes(options.windowTiles)?options.windowTiles:5;
    const nextCache=Math.max(16,Math.min(128,options.cacheTiles??64));
    if(nextRes!==res||nextWindow!==windowTiles){
      const resolutionChanged=nextRes!==res;
      res=nextRes;windowTiles=nextWindow;
      size=res*windowTiles;
      texture?.dispose();
      pixels=new Uint8Array(size*size*4);
      // Unbaked pixels mean no occlusion (maximum distance).
      for(let i=0;i<pixels.length;i+=4) pixels[i]=255;
      texture=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat,THREE.UnsignedByteType);
      texture.magFilter=texture.minFilter=THREE.LinearFilter;
      texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
      texture.generateMipmaps=false;
      texture.unpackAlignment=1;
      texture.needsUpdate=true;
      groundUniforms.fcGroundGrassShadowMap.value=texture;
      originX=originZ=Infinity;
      shownX=shownZ=Infinity;
      // Window size only changes atlas layout; keep expensive baked tiles.
      if(resolutionChanged){cache.clear();pending.clear();}
      dirty=true;
    }
    cacheLimit=nextCache;
    while(cache.size>cacheLimit) cache.delete(cache.keys().next().value);
  }
  function ready(baked){
    if(!baked?.ao||baked.resolution!==res)return false;
    const key=tileKey(baked.tx,baked.tz);
    pending.set(key,baked);
    return true;
  }
  function rebuild(){
    if(!pixels)return;
    for(let i=0;i<pixels.length;i+=4)pixels[i]=255;
    for(const baked of cache.values())
      if(baked.tx>=originX-1&&baked.tx<=originX+windowTiles&&
         baked.tz>=originZ-1&&baked.tz<=originZ+windowTiles)
        copyTileDistance(pixels,size,baked,originX,originZ,res);
    texture.needsUpdate=true;
    shownX=originX;shownZ=originZ;
    uploads++;
    dirty=false;
  }
  function tick(x,z,options={}){
    configure(options);
    const enabled=options.enabled!==false&&options.radius>0&&options.intensity>0;
    groundUniforms.fcGroundGrassShadowIntensity.value=enabled?options.intensity:0;
    groundUniforms.fcGroundGrassShadowRadius.value=options.radius??.5;
    groundUniforms.fcGroundGrassShadowSoftness.value=options.softness??50;
    groundUniforms.fcGroundGrassShadowEdgeFade.value=options.edgeFade===false?0:1;
    if(!enabled){center.set(0,0,0);return;}
    const cx=Math.floor(x/GRASS_AO_TILE_METERS);
    const cz=Math.floor(z/GRASS_AO_TILE_METERS);
    const nx=cx-Math.floor(windowTiles/2),nz=cz-Math.floor(windowTiles/2);
    if(nx!==originX||nz!==originZ){
      originX=nx;originZ=nz;dirty=true;
    }
    let budget=Math.max(1,Math.min(8,options.tilesPerFrame??2));
    for(const [key,baked] of pending){
      pending.delete(key);
      cache.delete(key);cache.set(key,baked);
      applied++;
      dirty=true;
      if(--budget===0)break;
    }
    while(cache.size>cacheLimit)cache.delete(cache.keys().next().value);
    const now=typeof performance!=='undefined'?performance.now():0;
    const fps=Math.max(1,Math.min(60,options.uploadsPerSecond??8));
    if(dirty&&now-lastUpload>=1000/fps){
      rebuild();lastUpload=now;
    }
    // If an upload was rate-limited, continue sampling the old world-space
    // atlas until the new pixels are uploaded; no 12-metre shadow jumps.
    if(Number.isFinite(shownX))center.set(shownX*GRASS_AO_TILE_METERS,
      shownZ*GRASS_AO_TILE_METERS,windowTiles*GRASS_AO_TILE_METERS);
    else center.set(0,0,0);
  }
  configure();
  return {
    ready,tick,
    has(tx,tz){
      const key=tileKey(tx,tz);
      const cached=cache.get(key);
      if(cached){
        cache.delete(key);cache.set(key,cached); // Mark recently used.
        return true;
      }
      return pending.has(key);
    },
    invalidate(){cache.clear();pending.clear();dirty=true;},
    get metrics(){return {cached:cache.size,pending:pending.size,
      uploads,applied,textureSize:size};},
    dispose(){
      texture?.dispose();
      groundUniforms.fcGroundGrassShadowMap.value=null;
      center.set(0,0,0);
      cache.clear();pending.clear();
    },
  };
}
