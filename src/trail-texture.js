// Seamless, deterministic sandy/gravel trail texture. One canvas + GPU texture
// shared by all trail chunks, UV repeats an integer number of times across X.
export function createTrailTexture(THREE,doc,chunkSize=24,renderer=null){
  const size=256,canvas=doc.createElement('canvas');
  canvas.width=canvas.height=size;
  const g=canvas.getContext('2d');
  g.fillStyle='#b8a27a';
  g.fillRect(0,0,size,size);
  let state=0x739f21c5;
  const random=()=>{
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    return state/4294967296;
  };
  // Irregular compacted sand and subtle darker earth. Gradients wrap across
  // the canvas edges, so the join between world chunks remains invisible.
  for(let i=0;i<55;i++){
    const x=random()*size,y=random()*size,radius=12+random()*38;
    const pale=random()<.5;
    for(const ox of [-size,0,size])for(const oy of [-size,0,size]){
      const cx=x+ox,cy=y+oy;
      if(cx+radius<0||cx-radius>size||cy+radius<0||cy-radius>size)continue;
      const grad=g.createRadialGradient(cx,cy,0,cx,cy,radius);
      grad.addColorStop(0,pale?'rgba(225,202,150,.21)':'rgba(104,80,54,.13)');
      grad.addColorStop(1,'rgba(120,92,61,0)');
      g.fillStyle=grad;
      g.fillRect(cx-radius,cy-radius,radius*2,radius*2);
    }
  }
  // Fine soil grains and scattered small pebbles. No visible tile borders.
  for(let i=0;i<3900;i++){
    const x=random()*size,y=random()*size,r=.25+random()*1.2;
    const bright=random()<.48;
    g.fillStyle=bright?'rgba(232,213,165,.22)':'rgba(91,73,48,.20)';
    g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();
  }
  for(let i=0;i<105;i++){
    const x=random()*size,y=random()*size,rx=1+random()*2.3,ry=.4+random()*.95;
    g.fillStyle=random()<.5?'rgba(226,214,184,.34)':'rgba(116,103,81,.32)';
    g.beginPath();g.ellipse(x,y,rx,ry,random()*Math.PI,0,Math.PI*2);g.fill();
  }
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.repeat.set(chunkSize/8,3.2/8);
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.magFilter=THREE.LinearFilter;
  if(renderer)texture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
  return texture;
}
