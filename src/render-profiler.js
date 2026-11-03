// Debug-only renderer instrumentation. OFF by default; no additional render
// pass and no GPU synchronization. Three's actual draw counters are sampled
// around renderBufferDirect, so instancing, frustum culling and multi-material
// groups are reflected in the submitted frame rather than estimated.
export const PROFILE_CATEGORIES=Object.freeze([
  'trees','grass','terrain','water','decor','players','fire',
  'structures','items','resources','sky','other',
]);

export const PROFILE_LABELS=Object.freeze({
  trees:'Деревья',grass:'Трава',terrain:'Земля',water:'Вода',
  decor:'Декор',players:'Персонажи',fire:'Огонь',structures:'Постройки',
  items:'Предметы / брёвна',resources:'Ресурсы',sky:'Небо',other:'Прочее',
});

const valid=n=>Number.isFinite(n)&&n>=0?n:0;
const rounded=n=>Math.round(n*100)/100;
const blank=()=>({drawCalls:0,triangles:0,meshes:0,instances:0});
const countInstances=o=>o?.isInstancedMesh?Math.max(0,o.count||0):1;

// Object overrides are intentionally preferred to names. Ancestry handles
// dynamically attached props, player parts, chunk decorations and fire FX.
export function classifyRenderable(object){
  if(object?.userData?.microGrass)return 'grass';
  if(/^Distant (?:conifer|birch)/.test(object?.name||''))return 'trees';
  let node=object;
  while(node){
    const d=node.userData??{};
    if(PROFILE_CATEGORIES.includes(d.profileCategory))return d.profileCategory;
    if(d.microGrass)return 'grass';
    if(d.fcProceduralVisual||d.spruceModel||d.birchModel||
       d.species||d.hitProxy)return 'trees';
    if(d.decorType)return 'decor';
    if(d.fireKind||d.fireOrigin||d.fireBody||d.flame)return 'fire';
    if(d.landmark==='campfire')return 'fire';
    if(d.landmark==='trail')return 'terrain';
    if(d.landmark)return 'structures';
    if(/^Terrain(?: |$)/.test(node.name||''))return 'terrain';
    if(/^(Lake|Pond) /.test(node.name||''))return 'water';
    if(/^Distant (?:conifer|birch)/.test(node.name||''))return 'trees';
    node=node.parent;
  }
  if(object?.isSkinnedMesh)return 'players';
  return 'other';
}

function countGeometryTriangles(geometry){
  if(!geometry)return 0;
  const total=geometry.index?.count??geometry.attributes?.position?.count??0;
  const range=geometry.drawRange??{};
  return Math.floor(Math.max(0,Math.min(Math.max(0,total-(range.start??0)),range.count??Infinity))/3);
}

// Scene inventory counts active scene-graph meshes and their *potential*
// triangles, not actual visible/frustum-culled draws. Shared GPU geometries
// are counted only once in the "uniqueGeometries" column.
export function scanSceneGeometry(scene){
  const groups=new Map();
  const visit=node=>{
    if(node.visible===false)return;
    if(node.userData?.decorBatchSource)return;
    if(node.isMesh||node.isLine||node.isPoints||node.isSprite){
      const category=classifyRenderable(node);
      if(!groups.has(category))groups.set(category,{
        category,meshes:0,instances:0,trianglesPotential:0,geometries:new Set(),
      });
      const entry=groups.get(category);
      const n=countInstances(node);
      if(n>0){
        entry.meshes++;
        entry.instances+=n;
        if(node.geometry){
          entry.geometries.add(node.geometry);
          if(node.isMesh)entry.trianglesPotential+=countGeometryTriangles(node.geometry)*n;
        }
      }
    }
    for(const child of node.children??[])visit(child);
  };
  if(scene)visit(scene);
  return PROFILE_CATEGORIES.map(category=>{
    const v=groups.get(category);
    return {category,meshes:v?.meshes??0,instances:v?.instances??0,
      trianglesPotential:v?.trianglesPotential??0,
      uniqueGeometries:v?.geometries?.size??0};
  });
}

export function createRenderProfiler(renderer,{clock=()=>performance.now()}={}){
  let enabled=false,activeFrame=null,activeShadow=null,lastFrame=null;
  let originalDirect=null,startedAt=0,totalFrames=0,totalShadowCalls=0,totalShadowTriangles=0;
  const shadows=new Map();
  const row=(category,values)=>({category,...values});
  const makeFrame=()=>({
    main:new Map(),shadow:new Map(),mainDraws:0,mainTriangles:0,
    shadowDraws:0,shadowTriangles:0,
  });
  const addDraw=(map,category,object,drawCalls,triangles)=>{
    if(!map.has(category))map.set(category,{...blank(),objects:new Set()});
    const v=map.get(category);
    v.drawCalls+=drawCalls;
    v.triangles+=triangles;
    if(!v.objects.has(object)){
      v.objects.add(object);
      v.meshes++;
      v.instances+=countInstances(object);
    }
  };
  const serialize=map=>PROFILE_CATEGORIES.map(category=>{
    const v=map?.get(category);
    return row(category,{drawCalls:v?.drawCalls??0,triangles:v?.triangles??0,
      meshes:v?.meshes??0,instances:v?.instances??0});
  });
  function beginFrame(){
    if(!enabled)return;
    activeFrame=makeFrame();
    activeShadow=null;
  }
  function endFrame(){
    if(!enabled||!activeFrame)return;
    const frame=activeFrame;
    lastFrame={main:serialize(frame.main),shadow:serialize(frame.shadow),
      mainDraws:frame.mainDraws,mainTriangles:frame.mainTriangles,
      shadowDraws:frame.shadowDraws,shadowTriangles:frame.shadowTriangles};
    totalFrames++;
    activeFrame=null;
    activeShadow=null;
  }
  function beginShadow(light,kind='other'){
    if(!enabled||!activeFrame)return;
    const id=light?.uuid??light?.id??kind;
    const label=kind==='sunNear'?'Солнце · ближний каскад'
      :kind==='sunFar'?'Солнце · дальний каскад'
      :kind==='point'
        ?(light?.parent?.userData?.fireKind==='torch'?'Факел'
          :light?.parent?.userData?.fireKind==='campfire'?'Костёр':'Точечный свет')
        :'Другие тени';
    activeShadow={id:String(id),kind,label,started:clock(),drawCalls:0,triangles:0,
      faces:light?.isPointLight?6:1,
      resolution:light?.shadow?.mapSize
        ?[light.shadow.mapSize.x,light.shadow.mapSize.y]:null};
  }
  function endShadow(){
    if(!activeShadow)return;
    const v=activeShadow;
    activeShadow=null;
    const prev=shadows.get(v.id);
    shadows.set(v.id,{
      id:v.id,kind:v.kind,label:v.label,resolution:v.resolution,
      faces:v.faces,refreshes:(prev?.refreshes??0)+1,
      totalDrawCalls:(prev?.totalDrawCalls??0)+v.drawCalls,
      totalTriangles:(prev?.totalTriangles??0)+v.triangles,
      lastDrawCalls:v.drawCalls,lastTriangles:v.triangles,
      lastCpuMs:rounded(valid(clock()-v.started)),lastUpdatedMs:clock(),
    });
  }
  function start(){
    if(enabled)return false;
    if(typeof renderer?.renderBufferDirect!=='function')return false;
    originalDirect=renderer.renderBufferDirect;
    enabled=true;startedAt=clock();totalFrames=0;
    totalShadowCalls=0;totalShadowTriangles=0;
    shadows.clear();lastFrame=null;activeFrame=null;activeShadow=null;
    renderer.renderBufferDirect=function(camera,scene,geometry,material,object,group){
      if(!activeFrame)return originalDirect.apply(this,arguments);
      const beforeCalls=renderer.info?.render?.calls??0;
      const beforeTriangles=renderer.info?.render?.triangles??0;
      const result=originalDirect.apply(this,arguments);
      const calls=Math.max(0,(renderer.info?.render?.calls??0)-beforeCalls);
      const tris=Math.max(0,(renderer.info?.render?.triangles??0)-beforeTriangles);
      if(calls>0){
        const category=classifyRenderable(object);
        const map=activeShadow?activeFrame.shadow:activeFrame.main;
        addDraw(map,category,object,calls,tris);
        if(activeShadow){
          activeShadow.drawCalls+=calls;activeShadow.triangles+=tris;
          activeFrame.shadowDraws+=calls;activeFrame.shadowTriangles+=tris;
          totalShadowCalls+=calls;totalShadowTriangles+=tris;
        }else{
          activeFrame.mainDraws+=calls;activeFrame.mainTriangles+=tris;
        }
      }
      return result;
    };
    renderer.__forestProfiler={beginShadow,endShadow};
    return true;
  }
  function stop(){
    if(!enabled)return false;
    renderer.renderBufferDirect=originalDirect;
    delete renderer.__forestProfiler;
    originalDirect=null;activeFrame=null;activeShadow=null;enabled=false;
    return true;
  }
  function snapshot(scene=null){
    const now=clock();
    return {
      enabled,uptimeSeconds:rounded(enabled?(now-startedAt)/1000:0),frames:totalFrames,
      frame:lastFrame??{main:serialize(null),shadow:serialize(null),
        mainDraws:0,mainTriangles:0,shadowDraws:0,shadowTriangles:0},
      inventory:scene?scanSceneGeometry(scene):null,
      shadowTotals:{drawCalls:totalShadowCalls,triangles:totalShadowTriangles,
        callsPerFrame:rounded(totalShadowCalls/Math.max(1,totalFrames)),
        trianglesPerFrame:Math.round(totalShadowTriangles/Math.max(1,totalFrames))},
      lights:[...shadows.values()].map(s=>({
        ...s,ageSeconds:rounded(Math.max(0,now-s.lastUpdatedMs)/1000),
      })).sort((a,b)=>b.lastUpdatedMs-a.lastUpdatedMs),
    };
  }
  return {start,stop,beginFrame,endFrame,beginShadow,endShadow,snapshot,
    get enabled(){return enabled;}};
}
