// Forest grass assembled from gently curved, tapered blades, not cone pyramids.
// Four silhouettes × three regional colors. All 12 geometries and one vertex-
// colored material are shared by every chunk; one tuft is always ONE draw call.
export const GRASS_SHAPES = Object.freeze([
  'meadow',  // mid-height, naturally splayed
  'lush',    // short, many broad leaves
  'sedge',   // tall, narrow blades
  'fan',     // strongly leaning outward
]);
export const GRASS_PALETTES = Object.freeze([
  'forest',  // cool, deep green
  'fresh',   // bright meadow green
  'dry',     // olive/straw edges
]);

const SHAPES = Object.freeze([
  {blades:9,  height:.78, width:.079, spread:.39, lean:.24},
  {blades:12, height:.74, width:.091, spread:.49, lean:.28},
  {blades:7,  height:1.08,width:.061, spread:.31, lean:.30},
  {blades:8,  height:.86, width:.079, spread:.60, lean:.57},
]);
const PALETTES = Object.freeze([
  {root:0x31592b,mid:0x578445,tip:0x9bbf6b},
  {root:0x497038,mid:0x83a952,tip:0xc4d17e},
  {root:0x66733b,mid:0x9ea655,tip:0xd4c77c},
]);

function mixColor(hexA,hexB,t,brightness) {
  return [16,8,0].map(shift=>{
    const a=(hexA>>shift)&255,b=(hexB>>shift)&255;
    return Math.min(1,((a+(b-a)*t)*brightness)/255);
  });
}

// Static mesh geometry is deterministic and independent of mutable world state.
export function createGrass(THREE) {
  const geometries=[];
  const material=new THREE.MeshLambertMaterial({
    side:THREE.DoubleSide,vertexColors:true,
  });

  function geometryFor(shapeIndex,paletteIndex) {
    const style=SHAPES[shapeIndex],palette=PALETTES[paletteIndex];
    const position=[],colors=[];
    function vertex(point,color) {
      position.push(...point);
      colors.push(...color);
    }
    function triangle(a,b,c,ca,cb,cc){
      vertex(a,ca);vertex(b,cb);vertex(c,cc);
    }

    for(let blade=0;blade<style.blades;blade++) {
      // Offset each blade's azimuth, length, width and tip lean without
      // allocations during chunk generation.
      const noise=n=> {
        const value=Math.sin((shapeIndex+1)*59.31+(paletteIndex+1)*23.17+
          (blade+1)*61.89+n*97.27)*43758.5453;
        return value-Math.floor(value);
      };
      const angle=(blade+.32*(noise(1)-.5))*Math.PI*2/style.blades;
      const dx=Math.cos(angle),dz=Math.sin(angle);
      const tx=-dz,tz=dx;
      const rootRadius=.025+.11*noise(2);
      const height=style.height*(.72+noise(3)*.57);
      const width=style.width*(.69+noise(4)*.57);
      const outward=style.spread*(.64+noise(5)*.70);
      const tipCurl=(noise(6)-.5)*.18;
      const brightness=.88+.19*noise(7);

      function ring(t){
        // A blade grows nearly upright from the root, then arcs outwards.
        const bend=(t*t*(.64+.36*t))*outward+
          style.lean*Math.sin(t*Math.PI*.5)*t*.24;
        const x=dx*(rootRadius+bend)+tx*tipCurl*t*t;
        const z=dz*(rootRadius+bend)+tz*tipCurl*t*t;
        const y=height*t;
        const w=width*(1-t)**.82*(.80+.43*Math.sin(t*Math.PI));
        const color=t<.55?
          mixColor(palette.root,palette.mid,t/.55,brightness):
          mixColor(palette.mid,palette.tip,(t-.55)/.45,brightness);
        return {
          left:[x-tx*w,y,z-tz*w],
          right:[x+tx*w,y,z+tz*w],
          color,
        };
      }
      const steps=[0,.22,.48,.73,.9,1];
      let prev=ring(steps[0]);
      for(let i=1;i<steps.length;i++){
        const next=ring(steps[i]);
        triangle(prev.left,next.left,prev.right,
          prev.color,next.color,prev.color);
        triangle(prev.right,next.left,next.right,
          prev.color,next.color,next.color);
        prev=next;
      }
    }

    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(position,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.computeVertexNormals();
    return geometry;
  }

  for(let shape=0;shape<SHAPES.length;shape++)
    for(let palette=0;palette<PALETTES.length;palette++)
      geometries.push(geometryFor(shape,palette));

  function create(shapeIndex,paletteIndex){
    const shape=Number.isInteger(shapeIndex)&&shapeIndex>=0&&
      shapeIndex<GRASS_SHAPES.length?shapeIndex:0;
    const palette=Number.isInteger(paletteIndex)&&paletteIndex>=0&&
      paletteIndex<GRASS_PALETTES.length?paletteIndex:0;
    const tuft=new THREE.Mesh(geometries[shape*GRASS_PALETTES.length+palette],material);
    tuft.userData.grassShape=GRASS_SHAPES[shape];
    tuft.userData.grassPalette=GRASS_PALETTES[palette];
    return tuft;
  }

  return {create,geometries,materials:[material]};
}
