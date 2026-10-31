import {createTrailTexture} from './trail-texture.js';
// Shared low-poly navigation cues. The trail is purely visual:
// tree spawn coordinates, collision, server and save state remain unchanged.
export function createLandmarks(ctx,doc=document) {
  const THREE=ctx.THREE;
  const trailGeometry=new THREE.PlaneGeometry(ctx.chunkSize,3.2,12,4);
  const trailMaterial=new THREE.MeshLambertMaterial({
    map:createTrailTexture(THREE,doc,ctx.chunkSize,ctx.renderer),
    side:THREE.DoubleSide,
  });
  const poleGeometry=new THREE.CylinderGeometry(.115,.15,2.1,6);
  const poleMaterial=new THREE.MeshLambertMaterial({color:0x76553b});
  const boardGeometry=new THREE.PlaneGeometry(3.0,.8);
  // One fire at the trailhead. Every rock/log is made from existing shared assets.
  const flameGeometry=new THREE.ConeGeometry(.36,1.05,5);
  const emberGeometry=new THREE.ConeGeometry(.19,.64,5);
  const flameMaterial=new THREE.MeshLambertMaterial({color:0xffb141,emissive:0xff661c,emissiveIntensity:.85,transparent:true,opacity:.94,depthWrite:false});
  const emberMaterial=new THREE.MeshLambertMaterial({color:0xffe9a3,emissive:0xff932d,emissiveIntensity:.8});
  const reduceMotion=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):{matches:false};
  let activeFire=null,lastFireTick=-Infinity;

  const boardMaterials=['←  К НАЧАЛУ','К НАЧАЛУ  →'].map(label=>{
    const canvas=doc.createElement('canvas');
    canvas.width=512;canvas.height=128;
    const g=canvas.getContext('2d');
    g.fillStyle='#d8bc85';g.fillRect(0,0,512,128);
    g.strokeStyle='#755638';g.lineWidth=12;g.strokeRect(6,6,500,116);
    g.font='bold 34px sans-serif';g.fillStyle='#34291b';g.textAlign='center';
    g.textBaseline='middle';g.fillText(label,256,64,470);
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    return new THREE.MeshLambertMaterial({map:texture,side:THREE.DoubleSide});
  });

  function signPosition(cx,cz) {
    const candidates=[[12,4.8],[17,4.8],[7,4.8],[12,7.8],[17,7.8]];
    for(const [ox,oz] of candidates) {
      const x=cx*ctx.chunkSize+ox,z=cz*ctx.chunkSize+oz;
      let blocked=false;
      // Consider the original deterministic positions, even for already-felled trees.
      for(let i=0;i<8;i++){
        const tx=cx*ctx.chunkSize+ctx.rand(cx,cz,i*3)*ctx.chunkSize;
        const tz=cz*ctx.chunkSize+ctx.rand(cx,cz,i*3+1)*ctx.chunkSize;
        if(Math.hypot(tx,tz)<8)continue;
        if((tx-x)**2+(tz-z)**2<3*3){blocked=true;break;}
      }
      if(!blocked)return {x,z};
    }
    return null;
  }

  function createCampfire(parent) {
    const fire=new THREE.Group();fire.position.set(5,ctx.terrain.heightAt(5,5),5);
    fire.userData.landmark='campfire';
    for(let i=0;i<6;i++){
      const a=i*Math.PI/3;
      const rock=new THREE.Mesh(ctx.rockGeo,ctx.rockMat);
      rock.position.set(Math.cos(a)*.87,.16,Math.sin(a)*.87);
      rock.scale.setScalar(.19);rock.castShadow=true;fire.add(rock);
    }
    for(let i=0;i<3;i++){
      const log=new THREE.Mesh(ctx.logGeo,ctx.logMat);
      log.position.set(0,.15,0);
      log.rotation.set(0,i*Math.PI/3,Math.PI/2);
      log.scale.set(.34,.42,.34);
      log.castShadow=true;
      fire.add(log);
    }
    const flame=new THREE.Mesh(flameGeometry,flameMaterial);
    flame.position.set(0,.66,0);fire.add(flame);
    const inner=new THREE.Mesh(emberGeometry,emberMaterial);
    inner.position.set(.07,.54,.02);fire.add(inner);
    // Dynamic local point-light shadows. One 256px cube map (six small
    // views), restricted to nearby casters by the atmosphere renderer.
    const light=new THREE.PointLight(0xffaa66,1.8,9,2);
    light.position.set(0,1.5,0);
    light.castShadow=true;
    light.layers?.enable(1); // illuminate remote animated characters
    light.layers?.enable(3); // illuminate the local skinned character
    light.shadow.mapSize.set(256,256);
    light.shadow.camera.near=.2;
    light.shadow.camera.far=9;
    light.shadow.bias=-.001;
    light.shadow.normalBias=.025;
    light.shadow.radius=2;
    light.shadow.autoUpdate=false;
    light.shadow.needsUpdate=true;
    fire.add(light);
    // These are not interactive/simulated fire particles; just three tiny cached geometry sparks.
    const sparks=[];
    for(let i=0;i<3;i++){
      const spark=new THREE.Mesh(ctx.flowerGeo,emberMaterial);
      spark.scale.setScalar(.12);
      spark.position.set((i-1)*.24,.95+i*.13,(i%2?.18:-.14));
      fire.add(spark);sparks.push(spark);
    }
    parent.add(fire);
    parent.userData?.shadowDecor?.push(fire);
    parent.userData?.grassClearings?.push({x:5,z:5,radius:1.65});
    activeFire={parent,flame,inner,light,sparks};
    lastFireTick=-Infinity;
  }

  function tick(now) {
    if(!activeFire)return;
    if(ctx.chunks.get('0,0')!==activeFire.parent){activeFire=null;return;}
    const {flame,inner,light,sparks}=activeFire;
    if(reduceMotion.matches){
      flame.scale.y=1;inner.scale.y=1;light.intensity=1.8;
      for(let i=0;i<sparks.length;i++)sparks[i].position.y=.95+i*.13;
      return;
    }
    if(!Number.isFinite(now))return;
    // Keep animated silhouettes in sync with the render while near the fire.
    // When the player is far away, reuse the last depth cube map.
    if(Math.hypot(ctx.px-5,ctx.pz-5)<11)light.shadow.needsUpdate=true;
    if(now-lastFireTick<150)return;
    lastFireTick=now;
    flame.scale.y=1+Math.sin(now*.009)*.09;
    inner.scale.y=1+Math.sin(now*.013+1)*.075;
    light.intensity=1.8+Math.sin(now*.007)*.20;
    for(let i=0;i<sparks.length;i++)sparks[i].position.y=.95+i*.13+Math.sin(now*.004+i*2)*.08;
  }

  function decorate(group,cx,cz) {
    if(cz!==0)return;
    // Trail follows the heightfield; each chunk owns its subdivided geometry.
    const centerX=cx*ctx.chunkSize+ctx.chunkSize/2;
    const geometry=trailGeometry.clone();
    const vertices=geometry.getAttribute('position');
    for(let i=0;i<vertices.count;i++){
      const x=centerX+vertices.getX(i),z=-vertices.getY(i);
      vertices.setZ(i,ctx.terrain.heightAt(x,z)+.025);
    }
    vertices.needsUpdate=true;
    geometry.computeVertexNormals();
    (group.userData.terrainGeometries??=[]).push(geometry);
    const trail=new THREE.Mesh(geometry,trailMaterial);
    trail.rotation.x=-Math.PI/2;
    trail.position.set(centerX,0,0);
    // This plane covers the real ground; without receiveShadow trees cannot
    // darken the trail even though the ground below receives shadows.
    trail.receiveShadow=true;
    trail.userData.landmark='trail';
    group.add(trail);
    if(cx===0)createCampfire(group);

    // Every third chunk, one noninteractive sign on the edge of the trail.
    if(cx%3!==0)return;
    const position=signPosition(cx,cz);
    if(!position)return;
    const pole=new THREE.Mesh(poleGeometry,poleMaterial);
    pole.position.set(position.x,ctx.terrain.heightAt(position.x,position.z)+1.05,position.z);
    pole.userData.landmark='signpost';
    pole.castShadow=true;
    group.add(pole);
    group.userData?.shadowDecor?.push(pole);
    group.userData?.grassClearings?.push({x:position.x,z:position.z,radius:.85});
    const board=new THREE.Mesh(boardGeometry,boardMaterials[cx<0?1:0]);
    board.position.set(position.x,ctx.terrain.heightAt(position.x,position.z)+2.0,position.z);
    board.rotation.y=Math.PI; // Facing the trail to the south; readable from the path.
    board.userData.landmark='signboard';
    board.castShadow=true;
    group.add(board);
    group.userData?.shadowDecor?.push(board);
  }
  return {decorate,signPosition,tick};
}
