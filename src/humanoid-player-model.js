// Visual-only player model selection, applied once at world launch.
// The existing lumberjack remains the physics / root-motion driver.
const MOTIONS={Idle:'idle',Walk:'walk',Run:'run',StrafeLeft:'strafe_left',StrafeRight:'strafe_right',Jump:'jump',Fall:'fall'};
const LOWER_BONES=new Set(['Root','pelvis','thigh_l','thigh_r','shin_l','shin_r','foot_l','foot_r','ball_l','ball_r']);

function lowerTrack(name){
  const index=name.lastIndexOf('.');
  return LOWER_BONES.has(index<0?name:name.slice(0,index));
}

export function createHumanoidPlayerModel({THREE,avatar,model='legacy'}){
  const noop={tick(){}};
  if(model==='legacy'||(model!=='male'&&model!=='female'))return noop;

  let active=null;
  let lowerState='',upperState='',lastChopEnd=-1,pendingChops=0;
  const oldVisual=avatar.visual;
  const oldShadows=avatar.shadowMeshes.slice();

  function playLayer(name,layer,speed=1){
    if(!active)return;
    const action=active.layers[name]?.[layer];
    if(!action)return;
    const previous=layer==='lower'?lowerState:upperState;
    if(previous===name){
      if(layer==='lower')action.setEffectiveTimeScale(speed);
      return;
    }
    const old=active.layers[previous]?.[layer];
    action.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1);
    if(name==='Chop'){
      action.setLoop(THREE.LoopOnce,1);
      action.clampWhenFinished=true;
    }
    action.play();
    old?.fadeOut(.12);
    action.fadeIn(.12);
    if(layer==='lower')lowerState=name;
    else upperState=name;
  }

  // Loading never blocks gameplay. In case of an asset error, show the legacy
  // character rather than leaving the player invisible.
  void (async()=>{
    const [{createLiteHumanoid},{GLTFLoader}]=await Promise.all([
      import('../characters/humanoid/humanoid-lite.js?v=fc-game-model1'),
      import('https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js')
    ]);
    const [actor,chopGLTF,axeGLTF]=await Promise.all([
      // Fixed outfit only: no clothing/morph customization controls yet.
      createLiteHumanoid({body:model,face:'default',hair:'short02',
        top:'shirt',bottom:'jeans',shoes:'shoes',outerwear:null}),
      new GLTFLoader().loadAsync('./characters/humanoid/lite/chop_preview.glb'),
      new GLTFLoader().loadAsync('./characters/humanoid/lite/axe_preview.glb')
    ]);
    const chop=chopGLTF.animations.find(clip=>clip.name==='Chop');
    if(!chop)throw new Error('Missing Chop clip');
    actor.mixer.stopAllAction();
    actor.action=null;
    const layers={};
    for(const clip of [...actor.clips,chop]){
      const separated={lower:[],upper:[]};
      for(const track of clip.tracks){
        const layer=lowerTrack(track.name)?'lower':'upper';
        if(layer==='lower'&&/Root\.position$/.test(track.name)){
          const fixed=track.clone();
          for(let i=0;i<fixed.values.length;i+=3){
            fixed.values[i]=0;fixed.values[i+2]=0;
          }
          separated.lower.push(fixed);
        }else separated[layer].push(track);
      }
      layers[clip.name]={};
      for(const layer of ['lower','upper']){
        if(separated[layer].length){
          layers[clip.name][layer]=actor.mixer.clipAction(new THREE.AnimationClip(
            clip.name+'_'+layer,clip.duration,separated[layer]));
        }
      }
    }

    const hand=actor.bones.get('hand_r');
    let axeGrip=null;
    axeGLTF.scene.traverse(node=>{if(node.name.startsWith('AXE_GRIP'))axeGrip=node;});
    if(!hand||!axeGrip)throw new Error('Axe grip or right hand bone missing');
    hand.add(axeGrip.clone(true));
    const root=actor.root;
    root.rotation.y=Math.PI;
    root.traverse(node=>{if(node.isMesh){node.layers.set(3);node.castShadow=true;}});
    avatar.group.add(root);
    oldVisual.visible=false;
    avatar.shadowMeshes.splice(0,avatar.shadowMeshes.length,
      ...actor.meshes);
    active={actor,layers,root};
    console.info('[Forest Chopper] Player character:',model,actor.stats());
  })().catch(error=>{
    console.error('[Forest Chopper] Failed to load selected model:',model,error);
    oldVisual.visible=true;
    avatar.shadowMeshes.splice(0,avatar.shadowMeshes.length,...oldShadows);
  });

  function tick(dt,motion,rate,gameActor){
    if(!active)return;
    const name=MOTIONS[motion]||'idle';
    playLayer(name,'lower',rate<0?-Math.abs(rate):Math.abs(rate));
    // The new authored Chop must complete independently from legacy Chop2.
    if(gameActor.upperState==='Chop2'&&gameActor.chopEnd>performance.now()&&
       gameActor.chopEnd!==lastChopEnd){
      lastChopEnd=gameActor.chopEnd;
      pendingChops=Math.min(2,pendingChops+1);
    }
    const chop=active.layers.Chop?.upper;
    const playing=upperState==='Chop'&&chop&&
      chop.time<chop.getClip().duration-1e-5;
    if(!playing&&pendingChops>0){
      pendingChops--;
      if(upperState==='Chop'){chop.stop();upperState='';}
      playLayer('Chop','upper',1);
    }else if(!playing){
      playLayer(name,'upper',Math.abs(rate));
    }
    active.actor.update(dt);
  }
  return {tick};
}
