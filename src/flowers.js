// Stylized low-poly wildflowers, 1 draw call each. Stem, leaves, seven petals
// and golden flower centre are merged into four shared vertex-colored geometries.
// Only these four geometries and one material are allocated, never per chunk.
export const FLOWER_SPECIES=Object.freeze([
  'daisy',          // ivory petals
  'buttercup',      // golden yellow
  'pink_wildflower',
  'blue_wildflower',
]);

const COLORS=Object.freeze([
  {petals:0xf6eee0,center:0xeaa83b},
  {petals:0xf5ca41,center:0xbc7526},
  {petals:0xef97b1,center:0xeaa83b},
  {petals:0x8eaeea,center:0xeaa83b},
]);

export function createFlowers(THREE) {
  const material=new THREE.MeshLambertMaterial({
    vertexColors:true,side:THREE.DoubleSide,
  });

  function createGeometry(palette) {
    const positions=[],colors=[];
    const rgb=new Map();
    function add(a,b,c,hex) {
      if(!rgb.has(hex))rgb.set(hex,[
        ((hex>>16)&255)/255,((hex>>8)&255)/255,(hex&255)/255,
      ]);
      const color=rgb.get(hex);
      positions.push(...a,...b,...c);
      colors.push(...color,...color,...color);
    }

    const stemSides=6;
    for(let i=0;i<stemSides;i++) {
      const a=i*2*Math.PI/stemSides,b=(i+1)*2*Math.PI/stemSides;
      const footA=[Math.cos(a)*.038,0,Math.sin(a)*.038];
      const footB=[Math.cos(b)*.038,0,Math.sin(b)*.038];
      const headA=[Math.cos(a)*.024,.62,Math.sin(a)*.024];
      const headB=[Math.cos(b)*.024,.62,Math.sin(b)*.024];
      add(footA,headA,footB,0x538a3c);
      add(footB,headA,headB,0x538a3c);
    }

    // Two simple lance-shaped leaves, reaching to either side of the stem.
    for(const [angle,y] of [[.4,.23],[Math.PI+.7,.35]]) {
      const ux=Math.cos(angle),uz=Math.sin(angle),vx=-uz,vz=ux;
      const base=[ux*.02,y,uz*.02];
      const mid=[ux*.20,y+.08,uz*.20];
      const left=[mid[0]+vx*.095,y+.045,mid[2]+vz*.095];
      const right=[mid[0]-vx*.095,y+.045,mid[2]-vz*.095];
      const tip=[ux*.36,y+.035,uz*.36];
      add(base,left,mid,0x689a47);
      add(base,mid,right,0x689a47);
      add(left,tip,mid,0x689a47);
      add(mid,tip,right,0x689a47);
    }

    // A seven-petal starburst with individually shaped, slightly upturned petals.
    for(let i=0;i<7;i++) {
      const angle=(i+.5)*Math.PI*2/7;
      const ux=Math.cos(angle),uz=Math.sin(angle),vx=-uz,vz=ux;
      const p=(r,w,y)=>[ux*r+vx*w,y,uz*r+vz*w];
      const base=p(.075,0,.635);
      const mid=p(.245,0,.675);
      const left=p(.23,-.122,.682);
      const right=p(.23,.122,.682);
      const outerLeft=p(.36,-.09,.655);
      const outerRight=p(.36,.09,.655);
      const tip=p(.405,0,.64);
      add(base,left,mid,palette.petals);
      add(base,mid,right,palette.petals);
      add(left,outerLeft,mid,palette.petals);
      add(mid,outerRight,right,palette.petals);
      add(outerLeft,tip,mid,palette.petals);
      add(mid,tip,outerRight,palette.petals);
    }

    // Tiny golden dome (visible above the petals) instead of a yellow octahedron.
    for(let i=0;i<8;i++) {
      const a=i*Math.PI/4,b=(i+1)*Math.PI/4;
      const top=[0,.748,0];
      const rA=[.105*Math.cos(a),.69,.105*Math.sin(a)];
      const rB=[.105*Math.cos(b),.69,.105*Math.sin(b)];
      const footA=[.077*Math.cos(a),.65,.077*Math.sin(a)];
      const footB=[.077*Math.cos(b),.65,.077*Math.sin(b)];
      add(top,rA,rB,palette.center);
      add(rA,footA,rB,palette.center);
      add(rB,footA,footB,palette.center);
    }

    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.computeVertexNormals();
    return geometry;
  }

  const geometries=COLORS.map(createGeometry);
  function create(speciesIndex) {
    const index=Number.isInteger(speciesIndex)&&speciesIndex>=0&&
      speciesIndex<FLOWER_SPECIES.length?speciesIndex:0;
    const flower=new THREE.Mesh(geometries[index],material);
    flower.userData.flowerSpecies=FLOWER_SPECIES[index];
    return flower;
  }
  return {create,geometries,materials:[material]};
}
