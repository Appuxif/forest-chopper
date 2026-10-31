// Cached transparent 2D snapshots of the actual in-game procedural item meshes.
// This runs once at idle time, not once per slot or on each inventory render.
import {MUSHROOM_SPECIES} from './mushrooms.js';
import {FLOWER_SPECIES} from './flowers.js';

export const itemIconKey=item=>item?.id==='axe'?'axe:'+item.tier:item?.id;

function axeIcon(ctx,tier){
  const {THREE}=ctx;
  const group=new THREE.Group();
  const bladeColors=[0xb6c1c7,0xa0cfeb,0xb8a0ef,0xe4c46b];

  // Prefer the actual axe from the lumberjack GLB, not the simple
  // first-person box/cylinder approximation.
  const visual=ctx.ownAvatar?.visual;
  if(visual){
    visual.updateWorldMatrix(true,true);
    const inverse=visual.matrixWorld.clone().invert();
    visual.traverse(node=>{
      if(!node.isMesh||!/^Axe (blade|handle)$/i.test(node.name))return;
      const materials=(Array.isArray(node.material)?node.material:[node.material])
        .map(mat=>{
          const copy=mat.clone();
          if(/blade/i.test(node.name)&&copy.color){
            copy.color.setHex(bladeColors[tier]);
            if('metalness' in copy)copy.metalness=.45;
          }
          return copy;
        });
      const mesh=new THREE.Mesh(node.geometry,Array.isArray(node.material)?materials:materials[0]);
      mesh.applyMatrix4(inverse.clone().multiply(node.matrixWorld));
      mesh.visible=true;
      mesh.layers.set(0); // The world avatar meshes live on character-only layer 3.
      group.add(mesh);
    });
  }

  // The GLB may be unavailable while loading. Keep an icon instead of a
  // blank texture, and make sure third-person visibility doesn't carry over.
  if(!group.children.length){
    const fallback=ctx.axe.clone(true);
    fallback.position.set(0,0,0);
    fallback.rotation.set(0,0,-.25);
    fallback.traverse(node=>{
      node.visible=true;
      node.layers.set(0);
      if(!node.isMesh)return;
      node.material=node.material.clone();
      if(fallback.children.indexOf(node)>0&&node.material.color){
        node.material.color.setHex(bladeColors[tier]);
      }
    });
    group.add(...[fallback]);
  }

  group.visible=true;
  return group;
}

function logIcon(ctx){
  const {THREE,logGeo,logMat,endMat,logLength}=ctx;
  const group=new THREE.Group();
  const trunk=new THREE.Mesh(logGeo,logMat);
  trunk.rotation.z=Math.PI/2;
  group.add(trunk);
  const endGeo=new THREE.CircleGeometry(ctx.logRadius,10);
  for(const sign of [-1,1]){
    const end=new THREE.Mesh(endGeo,endMat);
    end.position.x=sign*logLength/2;
    end.rotation.y=sign*Math.PI/2;
    group.add(end);
  }
  // Only the two circles are icon-only geometries, disposed after snapshot.
  group.userData.iconGeometries=[endGeo];
  return group;
}

function collectModels(ctx){
  const models=[];
  const add=(key,make)=>models.push([key,make]);
  MUSHROOM_SPECIES.forEach((name,i)=>add('mushroom:'+name,()=>ctx.mushrooms.create(i)));
  FLOWER_SPECIES.forEach((name,i)=>add('flower:'+name,()=>ctx.flowers.create(i)));
  add('log',()=>logIcon(ctx));
  add('branch',()=>ctx.forestResources?.createIconModel('branch'));
  add('stone',()=>ctx.forestResources?.createIconModel('stone'));
  add('bench',()=>ctx.crafting?.createIconModel());
  for(let tier=0;tier<4;tier++)add('axe:'+tier,()=>axeIcon(ctx,tier));
  return models;
}

export function renderItemIcons(ctx,doc=document){
  const {THREE}=ctx;
  const icons=new Map();
  let renderer;
  try{
    const canvas=doc.createElement('canvas');
    renderer=new THREE.WebGLRenderer({
      canvas,alpha:true,antialias:true,preserveDrawingBuffer:true,
      powerPreference:'low-power',
    });
    renderer.setPixelRatio(1);
    renderer.setSize(144,144,false);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000,0);

    const scene=new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff,0x6c745c,2.5));
    const key=new THREE.DirectionalLight(0xfff1d4,2.7);
    key.position.set(-2,5,4);scene.add(key);
    const fill=new THREE.DirectionalLight(0xbad6ff,1);
    fill.position.set(3,2,-3);scene.add(fill);

    const camera=new THREE.OrthographicCamera(-1,1,1,-1,.05,50);
    const box=new THREE.Box3(),size=new THREE.Vector3(),center=new THREE.Vector3();

    for(const [id,make] of collectModels(ctx)){
      let object;
      try{
        object=make();
        if(!object)continue;
        scene.add(object);
        box.setFromObject(object);
        if(box.isEmpty())continue;
        box.getCenter(center);
        box.getSize(size);
        // Wide items (logs, benches, axes) need a little more space.
        const span=Math.max(size.x*1.25,size.y*1.15,size.z*1.25,.32);
        camera.left=-span/2;
        camera.right=span/2;
        camera.top=span/2;
        camera.bottom=-span/2;
        camera.updateProjectionMatrix();
        camera.position.set(center.x+2.4,center.y+1.7,center.z+3.2);
        camera.lookAt(center);
        renderer.clear();
        renderer.render(scene,camera);
        icons.set(id,canvas.toDataURL('image/png'));
      }catch(err){
        console.warn('Inventory icon '+id+' fallback:',err);
      }finally{
        if(object){
          scene.remove(object);
          for(const geometry of object.userData.iconGeometries??[])geometry.dispose();
          if(id.startsWith('axe:'))object.traverse(node=>{
            if(node.isMesh)for(const material of (Array.isArray(node.material)?node.material:[node.material])){
              material.dispose();
            }
          });
        }
      }
    }
  }catch(err){
    // Emoji remain visible when an extra WebGL context isn't available.
    console.warn('Could not render inventory icons:',err);
  }finally{
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
  return icons;
}
