// Trim oversized transparent foliage quads against the generated texture atlas.
// No cards are dropped and no triangles added; the caller keeps the optimized geometry.
export function trimSpruceFoliageGeometry(source, atlas, {padding=6, alphaThreshold=8}={}) {
  const position=source.getAttribute?.('position'), uv=source.getAttribute?.('uv');
  const index=source.index?.array;
  if(!position||!uv||!index || position.count%4!==0
    || index.length!==position.count/4*6 || atlas?.width%2!==0
    || atlas?.height%2!==0 || !atlas.data) return null;

  const count=position.count/4;
  for(let i=0;i<count;i++){
    const j=i*4,k=i*6;
    if(index[k]!==j || index[k+1]!==j+1 || index[k+2]!==j+2
      || index[k+3]!==j || index[k+4]!==j+2 || index[k+5]!==j+3) return null;
  }
  const {width,height,data}=atlas;
  const tiles=[],tileW=width/2,tileH=height/2;
  for(let ty=0;ty<2;ty++)for(let tx=0;tx<2;tx++){
    let minX=tileW,minY=tileH,maxX=-1,maxY=-1;
    for(let y=0;y<tileH;y++)for(let x=0;x<tileW;x++){
      if(data[((ty*tileH+y)*width+tx*tileW+x)*4+3]<=alphaThreshold)continue;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);
      minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    }
    tiles.push(maxX<0?null:{
      u0:(tx*tileW+Math.max(0,minX-padding))/width,
      u1:(tx*tileW+Math.min(tileW,maxX+1+padding))/width,
      v0:(ty*tileH+Math.max(0,minY-padding))/height,
      v1:(ty*tileH+Math.min(tileH,maxY+1+padding))/height,
    });
  }

  const geometry=source.clone();
  const outPosition=geometry.getAttribute('position'),outUv=geometry.getAttribute('uv');
  let trimmedCards=0,coveredArea=0;
  for(let card=0;card<count;card++){
    const j=card*4;
    const loU=Math.min(uv.getX(j),uv.getX(j+1),uv.getX(j+2),uv.getX(j+3));
    const hiU=Math.max(uv.getX(j),uv.getX(j+1),uv.getX(j+2),uv.getX(j+3));
    const loV=Math.min(uv.getY(j),uv.getY(j+1),uv.getY(j+2),uv.getY(j+3));
    const hiV=Math.max(uv.getY(j),uv.getY(j+1),uv.getY(j+2),uv.getY(j+3));
    const du=hiU-loU,dv=hiV-loV;
    const tileX=Math.floor((loU+hiU));
    const tileY=Math.floor((loV+hiV));
    const bounds=tiles[tileY*2+tileX];
    if(!bounds||du<1e-6||dv<1e-6 || tileX<0||tileX>1||tileY<0||tileY>1)continue;
    const u0=Math.max(loU,bounds.u0),u1=Math.min(hiU,bounds.u1);
    const v0=Math.max(loV,bounds.v0),v1=Math.min(hiV,bounds.v1);
    if(u1<=u0||v1<=v0)continue;
    const corners=Array.from({length:4},(_,i)=>({
      u:uv.getX(j+i),v:uv.getY(j+i),
      x:position.getX(j+i),y:position.getY(j+i),z:position.getZ(j+i),
    }));
    const corner=(uHigh,vHigh)=>corners.find(p=>
      Math.abs(p.u-(uHigh?hiU:loU))<1e-4
      &&Math.abs(p.v-(vHigh?hiV:loV))<1e-4);
    const p00=corner(false,false),p10=corner(true,false),
      p01=corner(false,true),p11=corner(true,true);
    if(!p00||!p10||!p01||!p11)continue;
    const newCorners=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]];
    for(let i=0;i<4;i++){
      const [u,v]=newCorners[i],a=(u-loU)/du,b=(v-loV)/dv;
      outUv.setXY(j+i,u,v);
      outPosition.setXYZ(j+i,
        p00.x*(1-a)*(1-b)+p10.x*a*(1-b)+p01.x*(1-a)*b+p11.x*a*b,
        p00.y*(1-a)*(1-b)+p10.y*a*(1-b)+p01.y*(1-a)*b+p11.y*a*b,
        p00.z*(1-a)*(1-b)+p10.z*a*(1-b)+p01.z*(1-a)*b+p11.z*a*b);
    }
    trimmedCards++;
    coveredArea+=(u1-u0)*(v1-v0)/(du*dv);
  }
  if(!trimmedCards)return null;
  outPosition.needsUpdate=true;
  outUv.needsUpdate=true;
  geometry.computeBoundingSphere?.();
  geometry.computeBoundingBox?.();
  return {geometry,stats:{
    cards:count,trimmedCards,meanAreaRatio:coveredArea/trimmedCards,
    atlasSize:[width,height],
  }};
}
