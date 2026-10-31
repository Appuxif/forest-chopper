/**
 * Pixel-precision UV skin mask painter for Humanoid Lite.
 * White=visible skin, black=hidden. No source GLB/topology changes.
 */
import * as THREE from 'https://esm.sh/three@0.170.0';
import {PAINT_RESOLUTION,uvToCanvas} from './skin-paint-math.js';
export {PAINT_RESOLUTION,uvToCanvas,interpolateScreenPoints} from './skin-paint-math.js';
export function createSkinPainter(skinnedBody,{size=PAINT_RESOLUTION,maxUndo=8}={}){
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw Error('2D canvas required for skin mask');
  let strokes=0;
  const undoStack=[];
  const material=skinnedBody.material=skinnedBody.material.clone();
  // Three.Material.clone JSON-copies userData, turning THREE.Color into a
  // numeric hex value. Preserve the original skin tint as a Color object:
  // LiteHumanoid.setSkinColor expects material.userData.originalColor.r/g/b.
  const originalTint=material.userData.originalColor;
  if(originalTint!==undefined)
    material.userData.originalColor=originalTint?.isColor
      ?originalTint.clone():new THREE.Color(originalTint);
  ctx.fillStyle='#fff';
  ctx.fillRect(0,0,size,size);
  const texture=new THREE.CanvasTexture(canvas);
  texture.flipY=false;
  texture.colorSpace=THREE.NoColorSpace;
  texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
  texture.magFilter=THREE.LinearFilter;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;
  material.alphaMap=texture;
  material.alphaTest=.5;
  material.alphaToCoverage=true;
  material.needsUpdate=true;
  const notify=()=>{texture.needsUpdate=true};
  function snapshot(){
    undoStack.push(ctx.getImageData(0,0,size,size));
    if(undoStack.length>maxUndo)undoStack.shift();
  }
  function stamp(uv,{mode='hide',radius=12,hardness=.80}={}){
    if(!uv)return false;
    const xy=uvToCanvas(uv,size),x=xy.x,y=xy.y;
    if(x<0||x>=size||y<0||y>=size)return false;
    const r=Math.max(1,Math.min(100,radius));
    const alpha=mode==='show'?255:0;
    const color='rgb('+alpha+','+alpha+','+alpha+')';
    const grad=ctx.createRadialGradient(x,y,r*hardness,x,y,r);
    grad.addColorStop(0,color);
    grad.addColorStop(1,mode==='show'?'rgba(255,255,255,0)':'rgba(0,0,0,0)');
    ctx.fillStyle=grad;
    ctx.fillRect(x-r-1,y-r-1,r*2+2,r*2+2);
    strokes++;
    notify();
    return true;
  }
  function undo(){
    const image=undoStack.pop();
    if(!image)return false;
    ctx.putImageData(image,0,0);
    notify();
    return true;
  }
  function clear({keepUndo=true}={}){
    if(keepUndo)snapshot();
    else undoStack.length=0;
    ctx.fillStyle='#fff';
    ctx.fillRect(0,0,size,size);
    notify();
    strokes=0;
  }
  function load(dataURL){
    if(!dataURL){
      clear({keepUndo:false});
      return Promise.resolve(false);
    }
    return new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>{
        if(image.width!==size||image.height!==size){
          reject(Error('PNG mask must be '+size+'x'+size+', got '+image.width+'x'+image.height));
          return;
        }
        undoStack.length=0;
        ctx.clearRect(0,0,size,size);
        ctx.drawImage(image,0,0,size,size);
        notify();
        strokes=0;
        resolve(true);
      };
      image.onerror=()=>reject(Error('Could not decode mask image'));
      image.src=dataURL;
    });
  }
  function toPNG(){return canvas.toDataURL('image/png');}
  function stats(){return {resolution:size,brushStamps:strokes,undo:undoStack.length};}
  function dispose(){
    material.alphaMap=null;
    material.alphaTest=0;
    material.alphaToCoverage=false;
    material.needsUpdate=true;
    texture.dispose();
  }
  return {body:skinnedBody,canvas,texture,material,stamp,snapshot,undo,clear,load,toPNG,stats,dispose};
}
