import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadMobAssets} from '../src/mob-assets.js';
import {CHICKEN_TYPE,createMobTypeRegistry} from '../src/mob-types.js';
class Group{
 constructor(){this.children=[];this.scale={value:1,multiplyScalar(n){this.value*=n;}};}
 add(child){this.children.push(child);}traverse(fn){fn(this);for(const c of this.children)c.traverse(fn);}
}
class Mesh extends Group{constructor(material){super();this.material=material;this.isMesh=true;}}
function clip(name='Run'){return {name,duration:.5416667,tracks:[{name:'Root.position',times:new Float32Array([1/24,13/24]),values:new Float32Array([0,0,0,0,0,2])}],clone(){const c=clip(name);return c;}};}
test('species assets keep shared materials immutable, select exact subcategory texture and normalize root motion',async()=>{
 const definition=CHICKEN_TYPE,material={name:'Hen Plumage | color atlas',map:{url:'embedded'},clone(){return {...this};}};
 const source=new Group();source.add(new Mesh(material));let modelLoads=0;
 const assets=await loadMobAssets({Group,SRGBColorSpace:'srgb'},createMobTypeRegistry(),{
  loadModel:async()=>{modelLoads++;return {scene:source,animations:['Idle','Walk','Walk_Fast','Run','Sit','Peck_1','Peck_2','Peck'].map(name=>clip(name))};},
  cloneModel:()=>{const visual=new Group();visual.add(new Mesh(material));return visual;},
  loadTexture:async url=>({url}),
 });
 const asset=assets.get('chicken');assert.equal(modelLoads,1);
 const white=asset.create({id:'one',subcategory:'white'},10),black=asset.create({id:'two',subcategory:'black'},10);
 const whiteMesh=white.visual.children[0],blackMesh=black.visual.children[0];
 assert.equal(whiteMesh.material.map.url,definition.subcategories.white.texture);
 assert.equal(blackMesh.material.map.url,definition.subcategories.black.texture);
 assert.notEqual(whiteMesh.material,blackMesh.material);assert.equal(material.map.url,'embedded');
 assert.equal(white.visual.scale.value,.4);
 assert.ok(Math.abs(asset.speeds.get('Run')-1.6)<1e-5);
 const track=asset.clips.get('Run').tracks[0];assert.equal(track.times[0],0);assert.equal(track.values[5],0);
 const bytes=fs.readFileSync(new URL('../assets/models/hen.glb',import.meta.url));const data=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 assert.ok(data.materials.some(m=>m.name.includes(definition.model.variantMaterial)),'variant selector must match actual GLB plumage');
});
