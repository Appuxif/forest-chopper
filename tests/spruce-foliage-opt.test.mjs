import test from 'node:test';
import assert from 'node:assert/strict';
import {trimSpruceFoliageGeometry} from '../src/spruce-foliage-opt.js';

class Attribute {
  constructor(data,itemSize){this.array=Float32Array.from(data);this.itemSize=itemSize;this.count=this.array.length/itemSize;}
  getX(i){return this.array[i*this.itemSize];}
  getY(i){return this.array[i*this.itemSize+1];}
  getZ(i){return this.array[i*this.itemSize+2];}
  setXY(i,x,y){this.array.set([x,y],i*this.itemSize);}
  setXYZ(i,x,y,z){this.array.set([x,y,z],i*this.itemSize);}
  clone(){return new Attribute(this.array,this.itemSize);}
}
class Geometry {
  constructor(){
    const UV=[],POS=[],indices=[];
    for(let tile=0;tile<4;tile++){
      const x=(tile%2)*.5, y=Math.floor(tile/2)*.5, base=tile*4;
      UV.push(x+.004,y+.004, x+.496,y+.004, x+.496,y+.496, x+.004,y+.496);
      POS.push(x*10,0,y*10, x*10+1,0,y*10, x*10+1,1,y*10, x*10,1,y*10);
      indices.push(base,base+1,base+2,base,base+2,base+3);
    }
    this.attributes={uv:new Attribute(UV,2),position:new Attribute(POS,3)};
    this.index={array:Uint16Array.from(indices)};
  }
  getAttribute(key){return this.attributes[key];}
  clone(){
    const g=new Geometry();
    for(const [k,a] of Object.entries(this.attributes))g.attributes[k]=a.clone();
    g.index={array:Uint16Array.from(this.index.array)};
    return g;
  }
  computeBoundingSphere(){}
  computeBoundingBox(){}
}
function atlas(){
  const pixels=new Uint8ClampedArray(32*32*4);
  for(let ty=0;ty<2;ty++)for(let tx=0;tx<2;tx++)
    for(let y=5;y<=8;y++)for(let x=3;x<=12;x++)
      pixels[((ty*16+y)*32+tx*16+x)*4+3]=255;
  return {width:32,height:32,data:pixels};
}
test('alpha-aware quad trim preserves 100% of opaque atlas pixels, UV bounds and all triangles',()=>{
  const g=new Geometry(),originalPos=Array.from(g.getAttribute('position').array);
  const trimmed=trimSpruceFoliageGeometry(g,atlas(),{padding:1});
  assert.ok(trimmed);
  assert.equal(trimmed.stats.cards,4);
  assert.equal(trimmed.stats.trimmedCards,4);
  assert.ok(trimmed.stats.meanAreaRatio<.35,trimmed.stats.meanAreaRatio);
  const output=trimmed.geometry;
  assert.deepEqual(Array.from(output.index.array),Array.from(g.index.array));
  assert.deepEqual(Array.from(g.getAttribute('position').array),originalPos,'original GLB is untouched');
  const uv=output.getAttribute('uv'),pos=output.getAttribute('position');
  for(let tile=0;tile<4;tile++){
    const j=tile*4,tx=tile%2,ty=Math.floor(tile/2);
    assert.ok(uv.getX(j)>tx*.5+.004);
    assert.ok(uv.getY(j)>ty*.5+.004);
    assert.ok(uv.getX(j+2)<tx*.5+.496);
    assert.ok(uv.getY(j+2)<ty*.5+.496);
    for(const x of [3,12])for(const y of [5,8]){
      const u=(tx*16+x+.5)/32,v=(ty*16+y+.5)/32;
      assert.ok(u>=uv.getX(j)&&u<=uv.getX(j+2));
      assert.ok(v>=uv.getY(j)&&v<=uv.getY(j+2));
    }
    // Cropped geometry stays inside original quad and remains oriented.
    assert.ok(pos.getX(j)>originalPos[j*3]);
    assert.ok(pos.getY(j)>originalPos[j*3+1]);
  }
});
test('unsupported topology or opaque empty atlas leaves GLB original intact',()=>{
  const g=new Geometry();
  const empty={width:32,height:32,data:new Uint8ClampedArray(32*32*4)};
  assert.equal(trimSpruceFoliageGeometry(g,empty),null);
  const broken=g.clone();broken.index.array[0]=1000;
  assert.equal(trimSpruceFoliageGeometry(broken,atlas()),null);
});
