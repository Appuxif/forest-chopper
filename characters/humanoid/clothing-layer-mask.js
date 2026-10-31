/**
 * Automatic garment-on-garment occlusion.
 *
 * A higher layer is rasterized into cylindrical silhouette atlases aligned to
 * the bind-pose torso and each arm. The underlying garment's own UVs are then
 * painted black wherever those silhouettes cover its surface.
 *
 * Unlike masking entire skinned triangles, this is per-texel. No per-outfit
 * mask assets, pair-specific rules, geometry cuts, or per-frame CPU work.
 * Both outfits follow the same skeleton, so the generated UV mask animates
 * with the garment.
 */
import * as THREE from 'https://esm.sh/three@0.170.0';

const WIDTH=256;
const HEIGHT=448;
const YMIN=-.10;
const YMAX=2.05;
const TAU=2*Math.PI;
const DEFAULT_SIZE=768;
const REGION_KEYS=['torso','left','right'];
const RANK={underwear:0,bra:1,bottom:3,top:4,shoes:5,outerwear:10};
const ANGLE_PADDING_FACTOR=1;

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const get4=(a,i)=>[a.getX(i),a.getY(i),a.getZ(i),a.getW(i)];
const emptyAtlas=()=>({torso:new Uint8Array(WIDTH*HEIGHT),
  left:new Uint8Array(WIDTH*HEIGHT),right:new Uint8Array(WIDTH*HEIGHT)});

function baseBonePoint(mesh,name){
  const index=mesh.skeleton.bones.findIndex(b=>b.name===name);
  if(index<0)return null;
  return new THREE.Vector3().setFromMatrixPosition(
    mesh.skeleton.boneInverses[index].clone().invert()
  );
}
function skeletonAxes(mesh){
  const arms={};
  for(const [side,letter] of [['left','l'],['right','r']]){
    const shoulder=baseBonePoint(mesh,'upperarm_'+letter);
    const elbow=baseBonePoint(mesh,'lowerarm_'+letter);
    const hand=baseBonePoint(mesh,'hand_'+letter);
    arms[side]={shoulder,elbow,hand};
  }
  return arms;
}
function armAxisCenter(y,arm){
  const {shoulder,elbow,hand}=arm;
  if(!shoulder||!elbow||!hand)return {x:0,z:0};
  const [a,b]=y>=elbow.y?[shoulder,elbow]:[elbow,hand];
  const t=clamp((y-a.y)/((b.y-a.y)||1),0,1);
  return {x:lerp(a.x,b.x,t),z:lerp(a.z,b.z,t)};
}
function regionFromTriangle(mesh,a,b,c){
  const index=mesh.geometry.getAttribute('skinIndex');
  const weight=mesh.geometry.getAttribute('skinWeight');
  if(!index||!weight)return 'torso';
  const scores={torso:0,left:0,right:0};
  for(const vertex of [a,b,c]){
    const ids=get4(index,vertex),weights=get4(weight,vertex);
    for(let i=0;i<4;i++){
      const influence=weights[i];
      if(influence<.001)continue;
      const bone=mesh.skeleton.bones[ids[i]]?.name||'';
      const side=/(?:clavicle|upperarm|lowerarm|hand|index|middle|pinky|ring|thumb)_.*_l$|^(?:clavicle|upperarm|lowerarm|hand)_l$/.test(bone)?'left'
        :/(?:clavicle|upperarm|lowerarm|hand|index|middle|pinky|ring|thumb)_.*_r$|^(?:clavicle|upperarm|lowerarm|hand)_r$/.test(bone)?'right'
        :(bone.endsWith('_l')&&/arm|hand|clavicle/.test(bone))?'left'
        :(bone.endsWith('_r')&&/arm|hand|clavicle/.test(bone))?'right'
        :'torso';
      scores[side]+=influence;
    }
  }
  return scores.left>scores.torso&&scores.left>=scores.right?'left':
    scores.right>scores.torso&&scores.right>scores.left?'right':'torso';
}
function vertex(mesh,id,out){
  return out.fromBufferAttribute(mesh.geometry.getAttribute('position'),id);
}
function projection(point,region,axes){
  const center=region==='torso'?{x:0,z:0}:armAxisCenter(point.y,axes[region]);
  let angle=Math.atan2(point.x-center.x,point.z-center.z)/TAU;
  if(angle<0)angle+=1;
  return {x:angle*WIDTH,y:(point.y-YMIN)/(YMAX-YMIN)*HEIGHT};
}
function atlasCell(x,y){
  const yy=Math.floor(y);
  if(yy<0||yy>=HEIGHT)return -1;
  const xx=((Math.floor(x)%WIDTH)+WIDTH)%WIDTH;
  return yy*WIDTH+xx;
}
function dilate(original,padding){
  const r=clamp(Math.round(padding),0,7);
  if(!r)return original;
  const expanded=new Uint8Array(original.length);
  // Expand the coverage silhouette by a few atlas pixels, not by entire
  // anatomical zones. Helps cover slightly protruding inner cloth.
  for(let y=0;y<HEIGHT;y++){
    for(let x=0;x<WIDTH;x++){
      if(!original[y*WIDTH+x])continue;
      for(let dy=-r;dy<=r;dy++){
        const yy=y+dy;if(yy<0||yy>=HEIGHT)continue;
        for(let dx=-r;dx<=r;dx++){
          expanded[yy*WIDTH+((x+dx+WIDTH)%WIDTH)]=1;
        }
      }
    }
  }
  return expanded;
}
function collectCoverageAtlas(outerwear,{padding=2}={}){
  const raw=emptyAtlas();
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  for(const mesh of outerwear){
    if(!mesh?.geometry||!mesh.isSkinnedMesh)continue;
    const indices=mesh.geometry.index?.array;
    const count=indices?indices.length:mesh.geometry.attributes.position.count;
    const axes=skeletonAxes(mesh);
    for(let f=0;f<count;f+=3){
      const ai=indices?indices[f]:f,bi=indices?indices[f+1]:f+1,ci=indices?indices[f+2]:f+2;
      vertex(mesh,ai,a);vertex(mesh,bi,b);vertex(mesh,ci,c);
      const region=regionFromTriangle(mesh,ai,bi,ci);
      const grid=raw[region];
      // Surface sampling, rather than only vertices, avoids atlas pinholes.
      const span=Math.max(a.distanceTo(b),b.distanceTo(c),c.distanceTo(a));
      const subdivisions=clamp(Math.ceil(span/.012),2,20);
      for(let i=0;i<=subdivisions;i++){
        for(let j=0;j<=subdivisions-i;j++){
          const v=i/subdivisions,w=j/subdivisions,u=1-v-w;
          const point={x:a.x*u+b.x*v+c.x*w,
            y:a.y*u+b.y*v+c.y*w,z:a.z*u+b.z*v+c.z*w};
          const p=projection(point,region,axes);
          const cell=atlasCell(p.x,p.y);
          if(cell>=0)grid[cell]=1;
        }
      }
    }
  }
  for(const region of REGION_KEYS)raw[region]=dilate(raw[region],padding*ANGLE_PADDING_FACTOR);
  return raw;
}

function createClothingCanvas(mesh,outerwear,{size=DEFAULT_SIZE,padding=2}={}){
  const atlas=collectCoverageAtlas(outerwear,{padding});
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const image=ctx.createImageData(size,size);
  image.data.fill(255);
  const positions=mesh.geometry.getAttribute('position');
  const uv=mesh.geometry.getAttribute('uv');
  if(!positions||!uv)return canvas;
  const axes=skeletonAxes(mesh);
  const idx=mesh.geometry.index?.array;
  const count=idx?idx.length:positions.count;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  let maskedPixels=0;
  const pick=(attribute,i)=>[attribute.getX(i)*size,attribute.getY(i)*size];
  for(let f=0;f<count;f+=3){
    const ai=idx?idx[f]:f,bi=idx?idx[f+1]:f+1,ci=idx?idx[f+2]:f+2;
    const [x0,y0]=pick(uv,ai),[x1,y1]=pick(uv,bi),[x2,y2]=pick(uv,ci);
    const det=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2);
    if(Math.abs(det)<1e-8)continue;
    const minX=clamp(Math.floor(Math.min(x0,x1,x2)),0,size-1);
    const maxX=clamp(Math.ceil(Math.max(x0,x1,x2)),0,size-1);
    const minY=clamp(Math.floor(Math.min(y0,y1,y2)),0,size-1);
    const maxY=clamp(Math.ceil(Math.max(y0,y1,y2)),0,size-1);
    vertex(mesh,ai,a);vertex(mesh,bi,b);vertex(mesh,ci,c);
    const region=regionFromTriangle(mesh,ai,bi,ci);
    const grid=atlas[region];
    for(let y=minY;y<=maxY;y++){
      for(let x=minX;x<=maxX;x++){
        const px=x+.5,py=y+.5;
        const u=((y1-y2)*(px-x2)+(x2-x1)*(py-y2))/det;
        const v=((y2-y0)*(px-x2)+(x0-x2)*(py-y2))/det;
        const w=1-u-v;
        if(u<0||v<0||w<0)continue;
        const point={x:a.x*u+b.x*v+c.x*w,
          y:a.y*u+b.y*v+c.y*w,z:a.z*u+b.z*v+c.z*w};
        const pr=projection(point,region,axes);
        const cell=atlasCell(pr.x,pr.y);
        if(cell>=0&&grid[cell]){
          const at=(y*size+x)*4;
          if(image.data[at])maskedPixels++;
          image.data[at]=0;
          image.data[at+1]=0;
          image.data[at+2]=0;
        }
      }
    }
  }
  ctx.putImageData(image,0,0);
  canvas.dataset.maskedPixels=String(maskedPixels);
  return canvas;
}

export function applyClothingLayerMask(mesh,coveringMeshes,{padding=2,resolution=DEFAULT_SIZE}={}){
  clearClothingLayerMask(mesh);
  if(!mesh||!coveringMeshes?.length)return null;
  const canvas=createClothingCanvas(mesh,coveringMeshes,{padding,size:resolution});
  const masked=Number(canvas.dataset.maskedPixels||0);
  if(!masked)return {maskedPixels:0,resolution};
  const texture=new THREE.CanvasTexture(canvas);
  texture.flipY=false;
  texture.colorSpace=THREE.NoColorSpace;
  texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.magFilter=THREE.LinearFilter;
  const material=mesh.material;
  mesh.userData.layerMaskOriginal={
    alphaMap:material.alphaMap,
    alphaTest:material.alphaTest,
    alphaToCoverage:material.alphaToCoverage,
    transparent:material.transparent
  };
  material.alphaMap=texture;
  material.alphaTest=.5;
  material.alphaToCoverage=true;
  material.needsUpdate=true;
  mesh.userData.layerMaskTexture=texture;
  return {maskedPixels:masked,resolution};
}
export function clearClothingLayerMask(mesh){
  const original=mesh?.userData?.layerMaskOriginal;
  if(!original)return;
  const material=mesh.material;
  material.alphaMap=original.alphaMap;
  material.alphaTest=original.alphaTest;
  material.alphaToCoverage=original.alphaToCoverage;
  material.transparent=original.transparent;
  material.needsUpdate=true;
  mesh.userData.layerMaskTexture?.dispose();
  delete mesh.userData.layerMaskOriginal;
  delete mesh.userData.layerMaskTexture;
}
export const CLOTHING_LAYER_RANK=RANK;
