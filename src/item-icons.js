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

function potionIcon(ctx,kind){
 const THREE=ctx.THREE,g=new THREE.Group();
 const bottle=new THREE.Mesh(
   new THREE.CylinderGeometry(.26,.30,.72,10),
   new THREE.MeshStandardMaterial({color:({
      'potion:health':0xb93749,
      'potion:stamina':0x36a8c4,
      'potion:lumberjack':0xaa302d,
      'potion:light_feet':0x86d4a8,
      'potion:night_vision':0x6549b9,
    }[kind]??0x36a8c4),
     roughness:.22,metalness:.05,transparent:true,opacity:.86}));
 bottle.position.y=.48;g.add(bottle);
 const shoulder=new THREE.Mesh(new THREE.CylinderGeometry(.13,.23,.19,10),
   new THREE.MeshStandardMaterial({color:0xdceef2,transparent:true,opacity:.8}));
 shoulder.position.y=.93;g.add(shoulder);
 const neck=new THREE.Mesh(new THREE.CylinderGeometry(.13,.13,.19,10),
   new THREE.MeshStandardMaterial({color:0x9fb9bc,roughness:.22}));
 neck.position.y=1.12;g.add(neck);
 const cork=new THREE.Mesh(new THREE.CylinderGeometry(.15,.12,.17,10),
   new THREE.MeshLambertMaterial({color:0xab7d49}));
 cork.position.y=1.27;g.add(cork);
 return g;
}

function stewIcon(ctx,withHerbs=false){
 const {THREE}=ctx,g=new THREE.Group();
 const iron=new THREE.MeshStandardMaterial({color:0x48494c,metalness:.46,roughness:.52});
 const broth=new THREE.MeshLambertMaterial({color:0x9b6b38});
 const mushroom=new THREE.MeshLambertMaterial({color:0xc3a276});
 const bowl=new THREE.Mesh(new THREE.CylinderGeometry(.36,.26,.22,16),iron);
 bowl.position.y=.26;g.add(bowl);
 const contents=new THREE.Mesh(new THREE.CylinderGeometry(.33,.33,.015,16),broth);
 contents.position.y=.377;g.add(contents);
 for(const [x,z] of [[-.13,0],[.09,.12],[.13,-.11]]){
  const chunk=new THREE.Mesh(new THREE.SphereGeometry(.075,8,6),mushroom);
  chunk.position.set(x,.397,z);chunk.scale.set(1,.42,.8);g.add(chunk);
 }
 if(withHerbs){
  const herbs=new THREE.MeshLambertMaterial({color:0x3d9969});
  for(const [x,z] of [[-.09,.10],[.03,-.08],[.14,.055],[-.16,-.10]]){
   const leaf=new THREE.Mesh(new THREE.SphereGeometry(.042,7,5),herbs);
   leaf.position.set(x,.41,z);leaf.scale.set(.65,.3,1.3);g.add(leaf);
  }
 }
 return g;
}

// Only the dedicated thumbnail object is rotated: placement geometry remains unchanged.
export function benchIconModel(ctx){
  const model=ctx.crafting?.createIconModel();
  if(model)model.rotation.y+=Math.PI;
  return model;
}

function collectModels(ctx){
  const models=[];
  const add=(key,make)=>models.push([key,make]);
  MUSHROOM_SPECIES.forEach((name,i)=>add('mushroom:'+name,()=>ctx.mushrooms.create(i)));
  FLOWER_SPECIES.forEach((name,i)=>add('flower:'+name,()=>ctx.flowers.create(i)));
  add('dry_grass',()=>ctx.grasses?.create(0,2));
  add('log',()=>logIcon(ctx));
  add('branch',()=>ctx.forestResources?.createIconModel('branch'));
  add('stone',()=>ctx.forestResources?.createIconModel('stone'));
  add('bench',()=>benchIconModel(ctx));
  for(const kind of ['campfire','torch','table','fence','workbench','alchemy_table'])
    add(kind,()=>ctx.campStructures?.createIconModel?.(kind));
  for(const kind of ['chest','rack'])
    add(kind,()=>ctx.storages?.createIconModel?.(kind));
  add('food:mushroom_stew',()=>stewIcon(ctx));
  add('food:herbal_mushroom_stew',()=>stewIcon(ctx,true));
  for(const kind of ['potion:health','potion:stamina','potion:lumberjack','potion:light_feet','potion:night_vision'])
    add(kind,()=>potionIcon(ctx,kind));
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
