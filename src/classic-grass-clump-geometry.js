// Original dev grass ribbon, unchanged, reused to construct instanced clumps.
// Each blade retains the legacy mesh and material profile (no procedural
// lean, ground bend, tip widening or additional shading).
import {generateBladeRoots,hashGrass} from './grass-clumps-core.mjs';

export function makeTuftGeometry(THREE, tier, triangles=6) {
  const near = tier === 'near';
  const segments = triangles===1?1:triangles===3?2:(near?3:2);
  const positions = [], colors = [],centerXs = [];
  const bendAt = t => .105 * t * t;
  const point = (t, side) => {
    const bend = bendAt(t);
    const height = .24 *
      (t - .13 * Math.pow(t, 4)); // gently drooping tip
    const halfWidth = .0065 * (1 - t) ** .8;
    return [bend + side * halfWidth, .008 + height, 0];
  };
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments, t1 = (i + 1) / segments;
    const a = point(t0,-1), b = point(t0,1);
    const c = point(t1,-1), d = point(t1,1);
    positions.push(...a,...c,...b);
    centerXs.push(bendAt(t0),bendAt(t1),bendAt(t0));
    if((triangles===3&&i===0)||(triangles===1)){
      // One triangle at the lowest tiers; keep the silhouette tapering.
    }else{
      positions.push(...b,...c,...d);
      centerXs.push(bendAt(t0),bendAt(t1),bendAt(t1));
    }
    // Dark roots blend with the ground; sunlit tips stay readable even
    // where the forest-floor texture has a similar hue.
    const low=.77 + t0*.38, high=.77 + t1*.38;
    const shades=((triangles===3&&i===0)||triangles===1)
      ?[low,high,low]:[low,high,low,low,high,high];
    for (const shade of shades)
      colors.push(shade*.93,shade*1.04,shade*.88);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  // Vertex centerline lets width change without stretching the grass's curl.
  geometry.setAttribute('fcGrassCenterX',new THREE.Float32BufferAttribute(centerXs,1));
  geometry.setAttribute('fcGrassCenterZ',new THREE.Float32BufferAttribute(new Float32Array(centerXs.length),1));
  // A lone blade uses zero; grouped geometry assigns the blade slot.
  geometry.setAttribute('fcGrassBladeIndex',new THREE.Float32BufferAttribute(
    new Float32Array(centerXs.length),1));
  geometry.computeVertexNormals();
  return geometry;
}


export function makeClassicGrassClumpGeometry(THREE, config, tier) {
  const source=makeTuftGeometry(THREE,tier);
  const sourcePos=source.getAttribute('position').array;
  const sourceColor=source.getAttribute('color').array;
  const centreX=source.getAttribute('fcGrassCenterX').array;
  const centreZ=source.getAttribute('fcGrassCenterZ').array;
  const bladeCount=config.grassClusterBlades;
  const roots=generateBladeRoots({
    seed:config.grassClusterSeed,bladesPerClump:bladeCount,
    bladeGapMin:config.grassClusterBladeGapMin,
    bladeGapMax:config.grassClusterBladeGapMax,
  });
  const positions=new Float32Array(sourcePos.length*bladeCount);
  const colors=new Float32Array(sourceColor.length*bladeCount);
  const localCenterX=new Float32Array(centreX.length*bladeCount);
  const localCenterZ=new Float32Array(centreZ.length*bladeCount);
  const bladeIndices=new Float32Array(centreX.length*bladeCount);
  const sector=config.grassClusterAngleSpread*Math.PI/180;
  for(let blade=0;blade<bladeCount;blade++){
    const root=roots[blade];
    const t=bladeCount===1?0:blade/(bladeCount-1)-.5;
    const angle=sector*t+
      (hashGrass(config.grassClusterSeed,blade,0,11)-.5)*sector*.06;
    const c=Math.cos(angle),sin=Math.sin(angle);
    const base=blade*sourcePos.length;
    for(let i=0;i<sourcePos.length;i+=3){
      const x=sourcePos[i],z=sourcePos[i+2];
      positions[base+i]=root.x+c*x-sin*z;
      positions[base+i+1]=sourcePos[i+1];
      positions[base+i+2]=root.z+sin*x+c*z;
    }
    colors.set(sourceColor,base);
    const offset=blade*centreX.length;
    bladeIndices.fill(blade,offset,offset+centreX.length);
    for(let i=0;i<centreX.length;i++){
      localCenterX[offset+i]=root.x+c*centreX[i]-sin*centreZ[i];
      localCenterZ[offset+i]=root.z+sin*centreX[i]+c*centreZ[i];
    }
  }
  source.dispose();
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geo.setAttribute('fcGrassCenterX',new THREE.Float32BufferAttribute(localCenterX,1));
  geo.setAttribute('fcGrassCenterZ',new THREE.Float32BufferAttribute(localCenterZ,1));
  geo.setAttribute('fcGrassBladeIndex',new THREE.Float32BufferAttribute(bladeIndices,1));
  geo.computeVertexNormals();
  return geo;
}
