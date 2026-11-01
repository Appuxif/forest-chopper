// Experimental in-game comparison: old lumberjack vs the new 53-bone humanoid.
// Reuses existing physics + root motion. The old avatar remains the invisible
// movement driver; the replacement is visual-only and never changes world data.
const LABELS={legacy:'Старый',male:'Male · 53 кости',female:'Female · 53 кости'};
const MOTIONS={Idle:'idle',Walk:'walk',Run:'run',StrafeLeft:'strafe_left',StrafeRight:'strafe_right',Jump:'jump',Fall:'fall'};
const LOWER_BONES=new Set(['Root','pelvis','thigh_l','thigh_r','shin_l','shin_r','foot_l','foot_r','ball_l','ball_r']);
function classifyTrack(name){
  const dot=name.lastIndexOf('.');
  const bone=dot<0?name:name.slice(0,dot);
  return LOWER_BONES.has(bone);
}
export function createHumanoidGamePreview({THREE,avatar,game,renderer}){
  const originalVisual=avatar?.visual;
  const originalShadows=avatar?.shadowMeshes?.slice()||[];
  const cache=new Map();
  let selected='legacy',active=null,requestId=0,lastChopEnd=-1;
  let lowState='',upState='';
  const panel=document.createElement('div');
  panel.id='humanoid-game-preview';
  Object.assign(panel.style,{
    position:'absolute',right:'12px',top:'110px',zIndex:'31',padding:'9px 10px',
    color:'#eaf8ec',background:'rgba(10,22,27,.91)',border:'1px solid #3c6655',
    borderRadius:'10px',font:'12px/1.5 system-ui,sans-serif',maxWidth:'235px',
    boxShadow:'0 4px 18px #0008'
  });
  const label=document.createElement('label');
  label.textContent='🧍 Тест персонажа · ';
  label.htmlFor='humanoid-preview-select';
  const select=document.createElement('select');
  select.id='humanoid-preview-select';
  for(const [value,title] of Object.entries(LABELS)){
    const option=document.createElement('option');option.value=value;option.textContent=title;select.add(option);
  }
  Object.assign(select.style,{background:'#172b32',color:'white',border:'1px solid #496d64',borderRadius:'5px',padding:'3px',maxWidth:'100%'});
  const metrics=document.createElement('div');metrics.style.whiteSpace='pre-line';
  metrics.style.marginTop='5px';metrics.style.fontSize='11px';
  metrics.textContent='Одинаковый мир / камера / настройки.\nСравни FPS и Draw Calls.';
  panel.append(label,select,metrics);game.append(panel);
  let lastMetricsAt=performance.now(),frames=0;
  function switchLayer(name,layer,speed=1){
    if(!active)return;
    const bank=active.layers[name];if(!bank||!bank[layer])return;
    const field=layer==='lower'?'lower':'upper';
    const previous=field==='lower'?lowState:upState;
    const old=active.layers[previous]?.[layer];
    const next=bank[layer];
    if(previous===name){
      if(layer==='lower')next.setEffectiveTimeScale(speed);
      return;
    }
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(speed);
    next.play();
    if(name==='Chop'){next.setLoop(THREE.LoopOnce,1);next.clampWhenFinished=true;}
    if(old&&old!==next)old.fadeOut(.12);
    next.fadeIn(.12);
    if(field==='lower')lowState=name;else upState=name;
  }
  function buildLayers(actor,animations){
    // Do not run the unmasked full-body Idle action that the general character
    // preview starts on creation: it would compete with our two animation layers.
    actor.mixer.stopAllAction();actor.action=null;
    const layers={};
    for(const clip of animations){
      const split={lower:[],upper:[]};
      for(const track of clip.tracks){
        const group=classifyTrack(track.name)?'lower':'upper';
        // Horizontal Root Motion is provided by the existing game controller.
        if(group==='lower'&&/Root\.position$/.test(track.name)){
          const fixed=track.clone();
          for(let i=0;i<fixed.values.length;i+=3){fixed.values[i]=0;fixed.values[i+2]=0;}
          split.lower.push(fixed);
        }else split[group].push(track);
      }
      layers[clip.name]={
        lower:split.lower.length?actor.mixer.clipAction(new THREE.AnimationClip(clip.name+'_demo_lower',clip.duration,split.lower)):null,
        upper:split.upper.length?actor.mixer.clipAction(new THREE.AnimationClip(clip.name+'_demo_upper',clip.duration,split.upper)):null
      };
    }
    return layers;
  }
  async function load(gender){
    if(cache.has(gender))return cache.get(gender);
    const promise=(async()=>{
      const [{createLiteHumanoid},{GLTFLoader}]=await Promise.all([
        import('../characters/humanoid/humanoid-lite.js?v=fc-game-demo1'),
        import('https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js')
      ]);
      const [actor,chopGltf,axeGltf]=await Promise.all([
        createLiteHumanoid({body:gender,face:'default',hair:'short02',top:'shirt',bottom:'jeans',shoes:'shoes',outerwear:null}),
        new GLTFLoader().loadAsync('./characters/humanoid/lite/chop_preview.glb'),
        new GLTFLoader().loadAsync('./characters/humanoid/lite/axe_preview.glb')
      ]);
      const chop=chopGltf.animations.find(c=>c.name==='Chop');
      if(!chop)throw Error('Chop animation was not exported');
      const allClips=[...actor.clips,chop];
      const layers=buildLayers(actor,allClips);
      const root=actor.root;
      // The axe is a temporary game-test prop, not part of the humanoid model.
      // It is always attached to the right hand, including during Chop.
      let grip=null;axeGltf.scene.traverse(node=>{if(node.name.startsWith('AXE_GRIP'))grip=node;});
      const rightHand=actor.bones.get('hand_r');
      if(!grip||!rightHand)throw Error('Axe preview grip or right hand bone missing');
      rightHand.add(grip.clone(true));
      root.rotation.y=Math.PI; // matches the old lumberjack's facing convention
      root.visible=false;
      root.traverse(o=>{if(o.isMesh){o.layers.set(3);o.castShadow=true;}});
      avatar.group.add(root);
      const meshes=[];
      root.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o)});
      const stats=actor.stats();
      console.info('[Humanoid test]',gender,stats,'Chop:',chop.duration.toFixed(2)+'s');
      return {actor,layers,root,meshes,stats,gender};
    })();
    cache.set(gender,promise);
    try{return await promise;}catch(err){cache.delete(gender);throw err;}
  }
  async function choose(gender){
    const id=++requestId;
    select.value=gender;
    metrics.textContent=gender==='legacy'?'Стандартный дровосек, без новой модели.':'Загружаю модель и одежду…';
    if(gender==='legacy'){
      if(active)active.root.visible=false;
      active=null;selected='legacy';
      originalVisual.visible=true;
      avatar.shadowMeshes.splice(0,avatar.shadowMeshes.length,...originalShadows);
      return;
    }
    try{
      const target=await load(gender);
      if(id!==requestId)return;
      if(active)active.root.visible=false;
      active=target;selected=gender;active.root.visible=true;
      originalVisual.visible=false;
      avatar.shadowMeshes.splice(0,avatar.shadowMeshes.length,...active.meshes);
      lowState='';upState='';lastChopEnd=-1;
      metrics.textContent=LABELS[gender]+' · '+active.stats.triangles.toLocaleString('ru')+
        ' трис, '+active.stats.skinnedMeshes+' skinned meshes\nОжидаем одинаковые мир и управление.';
    }catch(error){
      console.error('Humanoid game preview failed',error);
      metrics.textContent='Ошибка загрузки: '+error.message;
      select.value='legacy';
      selected='legacy';active=null;originalVisual.visible=true;
      avatar.shadowMeshes.splice(0,avatar.shadowMeshes.length,...originalShadows);
    }
  }
  select.addEventListener('change',()=>{void choose(select.value)});
  function tick(dt,motion,rate,gameActor){
    const now=performance.now();
    frames++;
    if(now-lastMetricsAt>=1000){
      const fps=Math.round(frames*1000/(now-lastMetricsAt));
      frames=0;lastMetricsAt=now;
      const info=renderer.info.render;
      const description=active
        ? LABELS[selected]+' · '+active.stats.triangles.toLocaleString('ru')+' трис · '+active.stats.skinnedMeshes+' мешей'
        : 'Старый дровосек';
      metrics.textContent=description+'\nFPS '+fps+' · Draw '+info.calls+' · Tri '+info.triangles.toLocaleString('ru')+
        '\nПередвижение и физика без изменений';
    }
    if(!active)return;
    const name=MOTIONS[motion]||'idle';
    switchLayer(name,'lower',rate<0?-Math.abs(rate):Math.abs(rate));
    const inChop=gameActor.upperState==='Chop2'&&performance.now()<gameActor.chopEnd;
    if(inChop){
      if(gameActor.chopEnd!==lastChopEnd){
        lastChopEnd=gameActor.chopEnd;
        // Retrigger even when already in Chop after repeated clicks.
        upState='';
      }
      switchLayer('Chop','upper',1.6);
    }else switchLayer(name,'upper',Math.abs(rate));
    active.actor.update(dt);
  }
  return {tick,choose,get selected(){return selected},get active(){return active},panel};
}
