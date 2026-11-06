import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrass,GRASS_SHAPES,GRASS_PALETTES} from '../src/grass.js';

function threeMock(){
  const created={geometries:[],materials:[]};
  class BufferGeometry {
    constructor(){this.attributes={};created.geometries.push(this)}
    setAttribute(name,attr){this.attributes[name]=attr}
    computeVertexNormals(){this.normalsComputed=true}
  }
  class Float32BufferAttribute {
    constructor(array,itemSize){this.array=array;this.itemSize=itemSize}
  }
  class MeshLambertMaterial {
    constructor(options){this.options=options;created.materials.push(this)}
  }
  class Mesh {
    constructor(geometry,material){
      this.geometry=geometry;
      this.material=material;
      this.userData={};
    }
  }
  return {THREE:{BufferGeometry,Float32BufferAttribute,MeshLambertMaterial,Mesh,DoubleSide:2},created};
}

test('four recognizable tuft silhouettes use 12 prebuilt shared resources and a single mesh each',()=>{
  const {THREE,created}=threeMock();
  const grass=createGrass(THREE);
  assert.deepEqual(GRASS_SHAPES,['meadow','lush','sedge','fan']);
  assert.deepEqual(GRASS_PALETTES,['forest','fresh','dry']);
  assert.equal(grass.geometries.length,12);
  assert.equal(grass.materials.length,1);
  assert.equal(created.geometries.length,12);
  assert.equal(created.materials.length,1);
  assert.equal(grass.materials[0].options.vertexColors,true);
  assert.equal(grass.materials[0].options.side,THREE.DoubleSide);
  const bladeCounts=[9,12,7,8];
  for(let shape=0;shape<4;shape++){
    for(let palette=0;palette<3;palette++){
      const tuft=grass.create(shape,palette);
      assert.equal(tuft.geometry,grass.geometries[shape*3+palette]);
      assert.equal(tuft.material,grass.materials[0]);
      assert.equal(tuft.children,undefined,'each grass clump is one mesh/draw call');
      assert.equal(tuft.userData.grassShape,GRASS_SHAPES[shape]);
      assert.equal(tuft.userData.grassPalette,GRASS_PALETTES[palette]);
      const geometry=tuft.geometry;
      assert.equal(geometry.normalsComputed,true);
      const coords=geometry.attributes.position.array;
      const colors=geometry.attributes.color.array;
      assert.equal(coords.length,bladeCounts[shape]*5*2*3*3,
        'each tapered blade has 5 segments and 2 triangles per segment');
      assert.equal(colors.length,coords.length);
      assert.ok(coords.every(Number.isFinite),'blade geometry stays finite');
      assert.ok(colors.every(c=>Number.isFinite(c)&&c>=0&&c<=1));
      const y=coords.filter((_,i)=>i%3===1);
      assert.equal(Math.min(...y),0,'each tuft roots at terrain height');
      assert.ok(Math.max(...y)>.4&&Math.max(...y)<1.8,'readable grass height');
      const x=coords.filter((_,i)=>i%3===0);
      const z=coords.filter((_,i)=>i%3===2);
      assert.ok(Math.max(...x)-Math.min(...x)>.25,'clump is broad, not a floating triangle');
      assert.ok(Math.max(...z)-Math.min(...z)>.25,'clump spreads in multiple directions');
      const distinctY=new Set(y.map(v=>v.toFixed(3)));
      assert.ok(distinctY.size>=6,'individual blades have actual curved segments');
    }
  }
  for(let i=0;i<400;i++)grass.create(i%4,i%3);
  assert.equal(created.geometries.length,12,
    'streaming/growing chunks must never allocate more grass geometries');
  assert.equal(created.materials.length,1,
    'streaming/growing chunks must never allocate more grass materials');
});

test('regional palettes have distinct colors while geometry stays deterministic for every seed',()=>{
  const {THREE}=threeMock();
  const first=createGrass(THREE);
  const second=createGrass(THREE);
  for(let i=0;i<first.geometries.length;i++){
    assert.deepEqual(first.geometries[i].attributes.position.array,
      second.geometries[i].attributes.position.array);
    assert.deepEqual(first.geometries[i].attributes.color.array,
      second.geometries[i].attributes.color.array);
  }
  const sampleColors=[0,1,2].map(palette=>
    first.geometries[palette].attributes.color.array.slice(0,18));
  assert.notDeepEqual(sampleColors[0],sampleColors[1]);
  assert.notDeepEqual(sampleColors[1],sampleColors[2]);
  assert.equal(first.create(99,99).userData.grassShape,'meadow');
  assert.equal(first.create(99,99).userData.grassPalette,'forest');
});

test('every collectible tuft uses the dry-grass color family, regardless of micro-grass settings',()=>{
  const {THREE,created}=threeMock();
  const grasses=createGrass(THREE);
  const material=grasses.materials[0];
  assert.equal(created.geometries.length,12);
  assert.equal(created.materials.length,1);
  // Each of the 9..12 leaves has a separate fixed slot; vertex colors are
  // computed independently, not as one light-green color for the whole tuft.
  for(const shape of [0,1,2,3])for(const palette of [0,1,2]){
    const geometry=grasses.create(shape,palette).geometry;
    const index=geometry.attributes.fcGrassBladeIndex.array;
    const pos=geometry.attributes.position.array;
    assert.equal(index.length,pos.length/3);
    const bladeCount=[9,12,7,8][shape];
    assert.deepEqual([...new Set(index)],Array.from({length:bladeCount},(_,i)=>i));
    for(let blade=0;blade<bladeCount;blade++)
      assert.ok(index.slice(blade*30,(blade+1)*30).every(n=>n===blade));
  }
  const uniforms=material.userData.grassPaletteUniforms;
  assert.equal(uniforms.fcGrassRandomColors.value,1);
  assert.equal(uniforms.fcGrassYellowShare.value,1);
  const shader={
    uniforms:{},
    vertexShader:'#include <common>\n#include <color_vertex>',
    fragmentShader:'#include <common>\n#include <normal_fragment_begin>\n#include <lights_fragment_end>',
  };
  material.onBeforeCompile(shader);
  assert.strictEqual(shader.uniforms.fcGrassRandomColors,uniforms.fcGrassRandomColors);
  assert.strictEqual(shader.uniforms.fcGrassYellowShare,uniforms.fcGrassYellowShare);
  assert.match(shader.vertexShader,/attribute float fcGrassBladeIndex/);
  assert.match(shader.vertexShader,/step\(1\.0-fcGrassYellowShare,fcFamily\)/);
  assert.match(shader.vertexShader,/fcGrassBladeIndex\*19\.19/);
  assert.match(shader.vertexShader,/vec3\(\.045,\.18,\.035\)/);
  assert.match(shader.vertexShader,/vec3\(\.84,\.73,\.32\)/);
  assert.match(shader.vertexShader,/#ifdef USE_INSTANCING\s+fcPalettePosition=instanceMatrix\[3\]\.xz/);
  assert.match(shader.vertexShader,/#else\s+fcPalettePosition=modelMatrix\[3\]\.xz/);
  assert.match(shader.fragmentShader,/normal = normalize\(mat3\(viewMatrix\)/);
  assert.match(shader.fragmentShader,/reflectedLight\.directDiffuse \*= 0\.38/);
  assert.match(shader.fragmentShader,/reflectedLight\.indirectDiffuse \*= 0\.68/);
  // The old per-frame setPalette() API was removed: the global color slider
  // controls micro-grass only. Here 100% of leaves use the fcDry branch.
  assert.equal(grasses.setPalette,undefined);
  assert.equal(uniforms.fcGrassRandomColors.value,1);
  assert.equal(uniforms.fcGrassYellowShare.value,1);
  assert.deepEqual(shader.uniforms.fcGrassYellowShare,uniforms.fcGrassYellowShare);
  assert.match(shader.vertexShader,/vec3 fcDry=mix\(vec3\(\.24,\.115,\.035\),/);
  assert.match(shader.vertexShader,/vec3\(\.84,\.73,\.32\),fcShade\)/);
  assert.equal(created.geometries.length,12);
  assert.equal(created.materials.length,1);
});

test('collectible bushes use the same three independent lighting switches',()=>{
  const {THREE,created}=threeMock();
  const grass=createGrass(THREE);
  const u=grass.materials[0].userData.grassPaletteUniforms;
  const oldGeometries=[...grass.geometries];
  grass.setEffects({
    grassClusterProceduralNormals:true,
    grassClusterTranslucency:true,
    grassClusterAO:true,
    grassClusterTranslucencyIntensity:.95,
    grassClusterAOIntensity:.4,
  },{position:{x:3,y:4,z:0},intensity:1.6});
  assert.equal(u.fcGrassFxNormals.value,1);
  assert.equal(u.fcGrassFxTranslucency.value,1);
  assert.equal(u.fcGrassFxAO.value,1);
  assert.equal(u.fcGrassFxTranslucencyIntensity.value,.95);
  assert.equal(u.fcGrassFxAOIntensity.value,.4);
  assert.equal(u.fcGrassFxSunDirection.value.x,.6);
  assert.equal(u.fcGrassFxSunDirection.value.y,.8);
  assert.equal(u.fcGrassFxSunIntensity.value,.8);
  grass.setEffects({
    grassClusterProceduralNormals:true,grassClusterNormalsIntensity:.35,
  });
  assert.equal(u.fcGrassFxNormals.value,.35);
  grass.setEffects({
    grassClusterProceduralNormals:true,grassClusterNormalsIntensity:0,
  });
  assert.equal(u.fcGrassFxNormals.value,0,
    'zero normals strength restores classic lighting even if old flag is true');
  grass.setEffects({
    grassClusterProceduralNormals:true,grassClusterNormalsIntensity:1,
  });
  assert.equal(u.fcGrassFxNormals.value,1);
  // The sun's target can move with the camera's cascaded shadow maps.
  // Lighting must depend on (sun.position - sun.target.position).
  grass.setEffects({grassClusterTranslucency:true},
    {position:{x:103,y:104,z:90},
      target:{position:{x:100,y:100,z:90}},intensity:1.6});
  assert.ok(Math.abs(u.fcGrassFxSunDirection.value.x-.6)<1e-10);
  assert.ok(Math.abs(u.fcGrassFxSunDirection.value.y-.8)<1e-10);
  assert.ok(Math.abs(u.fcGrassFxSunDirection.value.z)<1e-10);
  const shader={
    uniforms:{},
    vertexShader:'#include <common>\n#include <color_vertex>',
    fragmentShader:'#include <common>\n#include <normal_fragment_begin>\n#include <color_fragment>\n#include <lights_fragment_end>\n#include <opaque_fragment>',
  };
  grass.materials[0].onBeforeCompile(shader);
  assert.strictEqual(shader.uniforms.fcGrassFxAO,u.fcGrassFxAO);
  assert.match(shader.fragmentShader,/fcSmooth=normalize\(vNormal\)/);
  assert.match(shader.fragmentShader,/mix\(normal,fcProceduralNormal,fcGrassFxNormals\)/);
  assert.match(shader.fragmentShader,/if\(fcGrassFxTranslucency>\.5\)/);
  assert.match(shader.fragmentShader,/fcSunHorizontal/);
  assert.match(shader.fragmentShader,/fcViewHorizontal/);
  assert.match(shader.fragmentShader,/fcAzimuth/);
  assert.match(shader.fragmentShader,/fcTransmission\*1\.08/);
  assert.match(shader.fragmentShader,/fcRootAO/);
  assert.equal(created.materials.length,1);
  assert.deepEqual(grass.geometries,oldGeometries);
  grass.setEffects({
    grassClusterProceduralNormals:false,
    grassClusterTranslucency:false,
    grassClusterAO:false,
  });
  assert.equal(u.fcGrassFxNormals.value,0);
  assert.equal(u.fcGrassFxTranslucency.value,0);
  assert.equal(u.fcGrassFxAO.value,0);
  grass.setEffects({grassClusterTranslucency:true},
    {position:{x:0,y:10,z:-4},intensity:0});
  assert.equal(u.fcGrassFxSunIntensity.value,0,
    'there must be no transmission glow when the sun is off');
  assert.equal(created.geometries.length,12);
});
