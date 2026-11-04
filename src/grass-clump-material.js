// Curved grass shader shared with the editor's lighting model.
// Tile paging, visibility and the original dev LOD remain in micro-grass.js.
export function makeGameGrassClumpMaterial(THREE,player,near,interaction=true){
  const u={
    fcGrassPlayer:{value:player},
    fcGrassFade:{value:new THREE.Vector4(-2,-1,19,26)},
    fcGrassSizeRange:{value:new THREE.Vector2(1,1)},
    fcGrassWidth:{value:1},
    fcGrassWindTime:{value:0},fcGrassWindSpeed:{value:0},
    fcGrassTilt:{value:0},
    fcGrassSunDirection:{value:new THREE.Vector3(.38,.89,.27)},
    fcGrassSunPower:{value:1},
    fcGrassAmbientPower:{value:1},
    fcGrassDensityLod:{value:new THREE.Vector4(10,98,4.55,.005)},
    fcGrassDensityShape:{value:new THREE.Vector2(.25,1)},
    fcGrassMinDensity:{value:0},
    fcGrassDensityCurve:{value:.17},
    fcGrassTurnRange:{value:new THREE.Vector2(0,0)},
    fcGrassProceduralNormals:{value:1},
    fcGrassTranslucency:{value:1},fcGrassAO:{value:1},
    fcGrassTranslucencyIntensity:{value:.6},fcGrassAOIntensity:{value:.6},
    fcGrassClearings:{value:Array.from({length:24},()=>new THREE.Vector4())},
    ...(near?{fcGrassActors:{value:Array.from({length:6},()=>new THREE.Vector4())}}:{}),
  };
  const Material=THREE.MeshBasicMaterial??THREE.MeshLambertMaterial;
  const material=new Material({color:0xffffff,vertexColors:true,
    side:THREE.DoubleSide,depthWrite:true,toneMapped:false});
  material.userData.grassUniforms=u;
  material.customProgramCacheKey=()=> 'fc-game-curved-'+(near?'near':'far')+
    (interaction?'-push-v4':'-basic-v4');
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,u);
    const vCommon=[
      '#include <common>',
      'uniform vec2 fcGrassPlayer;',
      'uniform vec4 fcGrassFade;',
      'uniform float fcGrassWidth;',
      'uniform float fcGrassWindTime;',
      'uniform float fcGrassWindSpeed;',
      'uniform vec4 fcGrassDensityLod;',
      'uniform vec2 fcGrassDensityShape;',
      'uniform float fcGrassDensityCurve;',
      'uniform float fcGrassMinDensity;',
      'uniform vec4 fcGrassClearings[24];',
      'uniform vec3 fcGrassSunDirection;',
      'uniform float fcGrassSunPower;',
      'attribute vec2 fcBladeCentre;',
      'attribute float fcBladeProgress;',
      'attribute vec3 fcBladeTangent;',
      'attribute vec3 fcBladeAcross;',
      'attribute float fcGrassPriority;',
      'varying float vFcBladeProgress;',
      'varying float vFcSmoothLight;',
      'varying float vFcFlatLight;',
      'varying float vFcBackLight;',
      ...(near&&interaction?['uniform vec4 fcGrassActors[6];']:[]),
    ].join('\n');
    const vBegin=[
      '#include <begin_vertex>',
      'vFcBladeProgress=fcBladeProgress;',
      '#ifdef USE_INSTANCING',
      'float fcDist=length(instanceMatrix[3].xz-fcGrassPlayer);',
      'float fcT=clamp((fcDist-fcGrassDensityLod.x)/max(.001,',
      '  fcGrassDensityLod.y-fcGrassDensityLod.x),0.,1.);',
      // Exact dev rational LOD + an optional editor-derived pre-exponent.
      'float fcShapeT=fcGrassDensityCurve<.0001?0.:pow(fcT,fcGrassDensityCurve);',
      'float fcNear=fcShapeT*fcShapeT*fcShapeT;',
      'float fcFar=(fcGrassDensityShape.y-fcShapeT)*',
      '  (fcGrassDensityShape.y-fcShapeT);',
      'float fcDenom=fcNear+(fcGrassDensityShape.x+fcGrassDensityLod.w)*fcFar;',
      'float fcFalloff=fcDenom>0.?clamp(fcNear/fcDenom,0.,1.):0.;',
      'float fcCoverage=mix(1.,fcGrassMinDensity,fcFalloff);',
      'float fcWidth=fcGrassWidth*(1.+fcFalloff*fcGrassDensityLod.z);',
      'transformed.xz=fcBladeCentre+(transformed.xz-fcBladeCentre)*fcWidth;',
      'float fcTip=fcBladeProgress*fcBladeProgress;',
      'float fcWave=sin(fcGrassWindTime*1.35*fcGrassWindSpeed+',
      '  instanceMatrix[3].x*.31+instanceMatrix[3].z*.21);',
      'float fcWave2=sin(fcGrassWindTime*.79*fcGrassWindSpeed+',
      '  instanceMatrix[3].z*.37);',
      'transformed.x+=fcGrassWindSpeed*fcWave*fcTip*.085;',
      'transformed.z+=fcGrassWindSpeed*fcWave2*fcTip*.056;',
      ...(near&&interaction?[
        'vec2 fcPush=vec2(0.);float fcStrongest=0.;',
        'for(int i=0;i<6;i++){',
        'vec4 actor=fcGrassActors[i];if(actor.w<=.001)continue;',
        'vec2 delta=instanceMatrix[3].xz-actor.xy;',
        'if(abs(delta.x)>=actor.z||abs(delta.y)>=actor.z)continue;',
        'float d=length(delta);',
        'float power=actor.w*(1.-smoothstep(.12,actor.z,d));',
        'if(power>fcStrongest){fcStrongest=power;',
        'fcPush=delta/max(d,.001)*power*.38;}}',
        'transformed.x+=dot(fcPush,instanceMatrix[0].xz)*fcTip;',
        'transformed.z+=dot(fcPush,instanceMatrix[2].xz)*fcTip;',
        'transformed.y-=0.075*fcStrongest*fcTip/max(instanceMatrix[1].y,.01);',
      ]:[]),
      'float fcFadeIn=smoothstep(fcGrassFade.x,fcGrassFade.y,fcDist);',
      'float fcFadeOut=1.-smoothstep(fcGrassFade.z,fcGrassFade.w,fcDist);',
      'float fcVisible=fcFadeIn*fcFadeOut;',
      'for(int i=0;i<24;i++){vec4 area=fcGrassClearings[i];',
      'if(area.w>.5&&distance(instanceMatrix[3].xz,area.xy)<area.z)',
      '  fcVisible=0.;}',
      // Same instance priority and curve as conservative CPU prefix LOD.
      'fcVisible*=step(fcGrassPriority,clamp(fcCoverage,0.,1.));',
      'transformed*=fcVisible;',
      '#endif',
      'vec3 smoothN=normalize(cross(fcBladeAcross,fcBladeTangent));',
      'vec3 flatN=normalize(cross(fcBladeAcross,vec3(0.,1.,0.)));',
      'vec4 worldP=vec4(transformed,1.);',
      '#ifdef USE_INSTANCING',
      'smoothN=normalize(mat3(instanceMatrix)*smoothN);',
      'flatN=normalize(mat3(instanceMatrix)*flatN);',
      'worldP=instanceMatrix*worldP;',
      '#endif',
      'smoothN=normalize(mat3(modelMatrix)*smoothN);',
      'flatN=normalize(mat3(modelMatrix)*flatN);',
      'worldP=modelMatrix*worldP;',
      'vFcSmoothLight=abs(dot(smoothN,normalize(fcGrassSunDirection)));',
      'vFcFlatLight=abs(dot(flatN,normalize(fcGrassSunDirection)));',
      'vFcBackLight=fcGrassSunPower*max(dot(',
      '  -normalize(cameraPosition-worldP.xyz),',
      '  normalize(fcGrassSunDirection)),0.);',
    ].join('\n');
    const fCommon=[
      '#include <common>',
      'uniform float fcGrassProceduralNormals;',
      'uniform float fcGrassTranslucency;',
      'uniform float fcGrassAO;',
      'uniform float fcGrassTranslucencyIntensity;',
      'uniform float fcGrassAOIntensity;',
      'uniform float fcGrassAmbientPower;',
      'uniform float fcGrassSunPower;',
      'varying float vFcBladeProgress;',
      'varying float vFcSmoothLight;',
      'varying float vFcFlatLight;',
      'varying float vFcBackLight;',
    ].join('\n');
    const fColor=[
      '#include <color_fragment>',
      'float fcFlat=.70+.23*vFcFlatLight;',
      'float fcCurved=.52+.46*vFcSmoothLight;',
      'float fcLight=mix(fcFlat,fcCurved,fcGrassProceduralNormals);',
      'if(fcGrassTranslucency>.5){',
      'float tr=(.20+.48*vFcBackLight)*(.30+.70*vFcBladeProgress);',
      'fcLight+=fcGrassTranslucencyIntensity*tr;}',
      'if(fcGrassAO>.5){',
      'float root=pow(1.-vFcBladeProgress,1.4);',
      'fcLight*=1.-.88*fcGrassAOIntensity*root;}',
      // MeshBasicMaterial gives us symmetric leaves; restore actual
      // day/night dimming that unlit Basic would otherwise ignore.
      'float dayLight=clamp(.05+.48*fcGrassAmbientPower+',
      '  .47*fcGrassSunPower,.03,1.1);',
      'diffuseColor.rgb*=clamp(fcLight*dayLight,.014,1.14);',
    ].join('\n');
    shader.vertexShader=shader.vertexShader.replace('#include <common>',vCommon)
      .replace('#include <begin_vertex>',vBegin);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',fCommon)
      .replace('#include <color_fragment>',fColor);
  };
  return material;
}
