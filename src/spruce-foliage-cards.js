/**
 * Procedural spruce with foliage cards for Three.js r180+.
 * Ported from Three.js JSON Studio generator, no UI dependencies.
 * Units: 1 unit = 1 meter. The atlas uses an HTML canvas (browser only).
 *
 * Two meshes per tree: textured bark/branches + foliage cards; 2 draw calls per tree in the base render pass.
 * Leaves are alpha-tested quads; hidden secondary twigs still supply attachment positions.
 *
 * For many trees: generate a few seed variants once and instance their meshes,
 * instead of calling createSpruce hundreds of times.
 */
import * as THREE from 'https://esm.sh/three@0.170.0';
import {SPRUCE_PRESET} from './tree-model-presets.js';
export {SPRUCE_PRESET};

const num = (v, fallback) => v === undefined ? fallback : Number(v);

function createRNG(seed = 1) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function between(rng, a, b) { return a + (b - a) * rng(); }
function unit(v) { return v.lengthSq() < 1e-12 ? new THREE.Vector3(0,1,0) : v.normalize(); }
function tangentFrame(d) {
  const h = Math.abs(d.y) > .91 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
  const right = unit(new THREE.Vector3().crossVectors(d,h));
  const up = unit(new THREE.Vector3().crossVectors(d,right));
  return [right, up];
}
function createBatchedBuilder() {
  const pos=[], norm=[], colors=[], uvs=[], indices=[];
  const colorVertex=(p, n, color, u=0, v=0) => {
    pos.push(p.x,p.y,p.z);
    norm.push(n.x,n.y,n.z);
    colors.push(color.r,color.g,color.b);
    uvs.push(u,v);
  };
  return {
    triangleCount:()=>indices.length / 3,
    geometry() {
      const g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
      g.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));
      g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
      g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
      g.setIndex(indices);
      g.computeBoundingSphere();
      return g;
    },
    // Tapered tube (frustum), open ends so adjacent segments can meet.
    cylinder(from,to,r0,r1,sides,color,v0=0,v1=null) {
      const diff=to.clone().sub(from);
      if(diff.lengthSq()<1e-9)return;
      const d=unit(diff);
      if(v1===null)v1=v0+Math.sqrt(diff.lengthSq())/.55;
      const [u,v]=tangentFrame(d);
      const first=pos.length/3;
      for(let i=0;i<=sides;i++) {
        const angle=i*2*Math.PI/sides;
        const n=u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v,Math.sin(angle));
        colorVertex(from.clone().addScaledVector(n,r0),n,color,i/sides,v0);
        colorVertex(to.clone().addScaledVector(n,r1),n,color,i/sides,v1);
      }
      for(let i=0;i<sides;i++) {
        const j=first+2*i;
        indices.push(j,j+2,j+1,j+1,j+2,j+3);
      }
    },
    // A true, non-truncated triangular cone: 3 side faces, 1 sharp apex.
    // The narrow triangular base is hidden inside the secondary twig, so no cap.
    // width = base diameter; length is much larger, like a slender green stick.
    needle(base,direction,width,length,color,spin) {
      const d=unit(direction.clone());
      const [u,v]=tangentFrame(d);
      const radius=width*.5;
      const ring=[];
      for(let i=0;i<3;i++) {
        const angle=spin+i*Math.PI*2/3;
        ring.push(base.clone().addScaledVector(u,Math.cos(angle)*radius)
          .addScaledVector(v,Math.sin(angle)*radius));
      }
      const tip=base.clone().addScaledVector(d,length);
      for(let i=0;i<3;i++) {
        const a=ring[i],b=ring[(i+1)%3];
        // Independent flat normal on each side gives a readable 3D silhouette.
        const n=unit(new THREE.Vector3().crossVectors(b.clone().sub(a),tip.clone().sub(a)));
        const first=pos.length/3;
        colorVertex(a,n,color);
        colorVertex(b,n,color);
        colorVertex(tip,n,color);
        indices.push(first,first+1,first+2);
      }
    }
  };
}



// Deterministic spruce bark. Light grayscale pigments multiply the existing
// bark vertex colors, preserving the brown palette of trunk and branches.
// Repeating longitudinal fissures + short flaky plates; one shared texture.
function createBarkTexture(seed, maxAnisotropy=4) {
  const rng=createRNG(seed+23811);
  const canvas=document.createElement('canvas');
  canvas.width=256;canvas.height=512;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#eee9df';ctx.fillRect(0,0,256,512);
  // Narrow vertical grain and irregular shadow channels.
  for(let i=0;i<165;i++){
    const x=between(rng,0,256);
    const y=between(rng,-50,512);
    const length=between(rng,28,230);
    const width=between(rng,.6,3.8);
    const dark=rng()<.72;
    ctx.strokeStyle=dark
      ?'rgba(40,28,20,'+between(rng,.09,.30)+')'
      :'rgba(255,251,228,'+between(rng,.14,.38)+')';
    ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);
    ctx.bezierCurveTo(x+between(rng,-5,5),y+length*.35,
      x+between(rng,-7,7),y+length*.7,
      x+between(rng,-4,4),y+length);
    ctx.stroke();
  }
  // Bark flakes: little offset horizontal cracks between vertical ridges.
  for(let i=0;i<780;i++){
    const x=between(rng,0,256),y=between(rng,0,512);
    const length=between(rng,1.8,13), thick=between(rng,.5,2.2);
    ctx.fillStyle=rng()<.65
      ?'rgba(45,28,20,'+between(rng,.08,.27)+')'
      :'rgba(255,249,223,'+between(rng,.16,.45)+')';
    ctx.fillRect(x,y,length,thick);
  }
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.RepeatWrapping;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.magFilter=THREE.LinearFilter;
  texture.anisotropy=Math.min(4,Math.max(1,maxAnisotropy));
  return texture;
}


function createNeedleAtlas(seed, baseColor, accentColor, maxAnisotropy=4) {
  const rng = createRNG(seed + 9147);
  const canvas=document.createElement('canvas');
  canvas.width=512; canvas.height=512;
  const ctx=canvas.getContext('2d', {willReadFrequently:false});
  const dark = baseColor.clone().multiplyScalar(.66);
  const mid = baseColor.clone().lerp(accentColor,.35);
  const bright=accentColor.clone().lerp(new THREE.Color('#87b77b'),.22);
  const colorToCSS = c=>`#${c.getHexString()}`;
  const palette=[colorToCSS(dark),colorToCSS(baseColor),colorToCSS(mid),colorToCSS(accentColor),colorToCSS(bright)];
  function polygon(a,b,c,color) {
    ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.lineTo(c[0],c[1]);ctx.closePath();ctx.fill();
  }
  for(let tile=0;tile<4;tile++) {
    const tx=(tile%2)*256,ty=Math.floor(tile/2)*256;
    ctx.save();ctx.translate(tx,ty);
    const midY=128+between(rng,-6,6);
    // Thin twig along horizontal texture axis.
    ctx.strokeStyle='#554b2d'; ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(18,midY);ctx.quadraticCurveTo(128,midY-7,239,midY-3);ctx.stroke();
    const shoots=25+tile*2;
    // Secondary featherlets, needle clusters and intentionally transparent gaps.
    for(let i=0;i<shoots;i++) {
      const t=(i+.25+between(rng,-.15,.15))/shoots;
      const x=22+t*208;
      const taper=Math.pow(1-t,.8);
      const side=(i%2===0)?-1:1;
      const spread=(31+tile*4)*Math.sin(Math.PI*(.05+.90*t)) * (0.45+0.55*taper);
      const y0=midY + 2*Math.sin(t*8+tile);
      const y1=y0+side*spread*between(rng,.70,1.22);
      const x1=x+between(rng,18,38)*taper;
      ctx.strokeStyle=palette[0];ctx.lineWidth=1.7;
      ctx.beginPath();ctx.moveTo(x,y0);ctx.lineTo(x1,y1);ctx.stroke();
      const needles=16+Math.floor(rng()*10);
      for(let n=0;n<needles;n++) {
        const f=(n+.25)/needles;
        const sx=x+(x1-x)*f;
        const sy=y0+(y1-y0)*f;
        const leafSize=between(rng,6,14)*(1-.6*t);
        const dir=side*between(rng,.65,1);
        const opposite=n%3===0?-1:1;
        const ex=sx+leafSize*between(rng,.45,.95);
        const ey=sy+dir*leafSize*opposite;
        const width=between(rng,1.1,3.0);
        polygon([sx-width,sy-width*.5],[sx+width,sy+width*.5],[ex,ey],palette[Math.floor(rng()*palette.length)]);
      }
    }
    // More small needles along central twig, giving a connected silhouette.
    for(let i=0;i<135;i++) {
      const t=between(rng,.02,.98),x=18+t*220,y=midY-5*Math.sin(t*Math.PI);
      const side=(rng()<.5)?-1:1;
      const a=between(rng,4,12)*(1-t*.35);
      polygon([x-2,y],[x+2,y+side*1.5],[x+a, y+side*a*.75], palette[Math.floor(rng()*palette.length)]);
    }
    ctx.restore();
  }
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=THREE.ClampToEdgeWrapping;texture.wrapT=THREE.ClampToEdgeWrapping;
  texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
  texture.generateMipmaps=true;
  texture.anisotropy=Math.min(4, Math.max(1, maxAnisotropy));
  texture.flipY=false; // texture UVs and glTF export use the same atlas orientation
  return texture;
}


function buildFoliageCardsSpruce(spec={}, options={}) {
  const p=spec.params && typeof spec.params==='object'?spec.params:spec;
  const rng=createRNG(num(p.seed,7));
  const H=Math.max(1,num(p.trunkHeight,6));
  const R=Math.max(.025,num(p.trunkRadius,.3));
  const quality=['low','balanced','high'].includes(options.quality) ? options.quality : 'balanced';
  const cfg={
    low:      {primarySides:3,secondarySides:3,pairsPerBranch:1,branchScale:.75},
    balanced: {primarySides:4,secondarySides:3,pairsPerBranch:2,branchScale:1},
    high:     {primarySides:5,secondarySides:4,pairsPerBranch:3,branchScale:1.08}
  }[quality];
  const whorls=Math.max(4,Math.min(24,Math.round(num(p.whorls,13))));
  const crownRatio=THREE.MathUtils.clamp(num(p.crownRatio,.98),.60,.99);
  const branchStart=THREE.MathUtils.clamp(num(p.branchStartHeight,2.5),.15,H*.8);
  const basePitch=THREE.MathUtils.clamp(num(p.basePitch,-25),-45,45);
  const topPitch=THREE.MathUtils.clamp(num(p.topPitch,-10),-30,65);
  const limbLength=Math.max(.15,num(p.level1Length,2.5))*(H/6);
  const secondaryFactor=THREE.MathUtils.clamp(num(p.level2LengthFactor,.35),.1,.8);
  const twigDensity=THREE.MathUtils.clamp(num(p.secondaryBranchDensity,1),0,3);
  const desiredPairs=THREE.MathUtils.clamp(Math.round(cfg.pairsPerBranch*twigDensity),0,12);
  const perBranch=THREE.MathUtils.clamp(Math.round(num(p.cardCountPerBranch,7)),1,30);
  const cardLengthScale=THREE.MathUtils.clamp(num(p.cardLengthScale,1),.3,2.5);
  const cardWidthScale=THREE.MathUtils.clamp(num(p.cardWidthScale,1),.3,2.5);
  const cardSpread=THREE.MathUtils.degToRad(THREE.MathUtils.clamp(num(p.cardSpread,35),0,90));
  const crossed=p.cardCrossed !== false;
  const alphaTest=THREE.MathUtils.clamp(num(p.cardAlphaTest,.48),.05,.9);
  const showFoliage=p.showFoliage !== false;
  const showSecondaryBranches=p.showSecondaryBranches !== false;
  const cap=Math.floor(THREE.MathUtils.clamp(num(p.maxTriangles,12000),2000,200000));
  const bark=new THREE.Color(p.barkColor??'#705238');
  const leaf=new THREE.Color(p.leafColor??'#245c36');
  const accent=new THREE.Color(p.leafAccent??'#44874d');
  const wood=createBatchedBuilder();
  const targets=[];
  const tree=new THREE.Group();tree.name=spec.name || 'Spruce Foliage Cards';
  const radial=a=>new THREE.Vector3(Math.cos(a),0,Math.sin(a));
  const trunk=t=>new THREE.Vector3(0,H*t,0);
  wood.cylinder(trunk(0),trunk(1),R,.001,8,bark,0,H/.55);
  const named=Array.isArray(p.branchesPerWhorl)?p.branchesPerWhorl:[];
  const levels=Math.round(num(p.levels,2));
  const branchesPerWhorl=w=>{
    const v=named[w];
    if(v !== undefined) return v<=0?0:THREE.MathUtils.clamp(Math.round(v*cfg.branchScale),1,10);
    return THREE.MathUtils.clamp(Math.round((7-4*w/(whorls-1))*cfg.branchScale),1,10);
  };
  // Reserve triangles for all main branches and foliage first; distribute the remaining
  // woody-geometry budget evenly across *pairs*, not individual left/right twigs.
  const mainBranchCount=Array.from({length:whorls},(_,w)=>branchesPerWhorl(w)).reduce((a,b)=>a+b,0);
  const expectedMainTriangles=16+mainBranchCount*5*2*cfg.primarySides;
  const remainingWood=Math.max(0,Math.floor(cap*.55)-expectedMainTriangles);
  const pairTriangles=4*cfg.secondarySides; // two tapered tubes per pair
  const pairsPerMain=mainBranchCount
    ? (showSecondaryBranches
        ? Math.min(desiredPairs,Math.floor(remainingWood/(mainBranchCount*pairTriangles)))
        : desiredPairs)
    : 0;
  for(let w=0;w<whorls;w++){
    const t=w/(whorls-1);
    const count=branchesPerWhorl(w);
    if(!count)continue;
    const origin=trunk(THREE.MathUtils.lerp(branchStart/H,crownRatio,t));
    const pitch=THREE.MathUtils.degToRad(THREE.MathUtils.lerp(basePitch,topPitch,t));
    const lengthBase=limbLength*Math.pow(1-t,.72)*between(rng,.88,1.1);
    const phase=between(rng,0,Math.PI*2);
    for(let b=0;b<count;b++){
      const az=phase+b*2*Math.PI/count+between(rng,-.12,.12);
      const out=radial(az),side=radial(az+Math.PI/2);
      const len=lengthBase*between(rng,.88,1.1);
      const points=[];
      for(let i=0;i<=5;i++){
        const u=i/5;
        const pos=origin.clone().addScaledVector(out,len*u*Math.cos(pitch));
        pos.y=origin.y+len*u*Math.sin(pitch)-len*.12*Math.sin(Math.PI*u*.9);
        pos.addScaledVector(side,len*.035*Math.sin(Math.PI*u)*Math.sin(b*3.1));
        points.push(pos);
      }
      const radius=R*(.15*(1-t)+.03);
      for(let i=0;i<5;i++){
        const u=i/5,v=(i+1)/5;
        wood.cylinder(points[i],points[i+1],
          Math.max(.002,radius*Math.pow(1-u,.9)),Math.max(.0015,radius*Math.pow(1-v,.9)),cfg.primarySides,bark,
          len*u/.55,len*v/.55);
      }
      const shoots=[];
      if(levels>=2 && pairsPerMain>0){
        for(let k=0;k<pairsPerMain;k++){
          // One attachment point shared by a symmetric left/right pair.
          const u=.24+(k+.35)/pairsPerMain*.64;
          const ix=Math.min(4,Math.floor(u*5));
          const base=points[ix].clone().lerp(points[ix+1],u*5-ix);
          const pairLength=len*secondaryFactor*(1-.46*u)*between(rng,.91,1.09);
          const forward=between(rng,.46,.56);
          const lateral=between(rng,.79,.88);
          const lift=between(rng,-.09,.035);
          const r2=Math.max(.0015,radius*.28*(1-.5*u));
          for(const flip of [-1,1]){
            const len2=pairLength*between(rng,.96,1.04);
            const dir=unit(out.clone().multiplyScalar(forward)
              .addScaledVector(side,flip*lateral)
              .add(new THREE.Vector3(0,lift+between(rng,-.018,.018),0)));
            const tip=base.clone().addScaledVector(dir,len2);
            if(showSecondaryBranches) wood.cylinder(base,tip,r2,r2*.12,cfg.secondarySides,bark,0,len2/.55);
            shoots.push({from:base.clone(),to:tip,dir,len:len2});
          }
        }
      }
      if(showFoliage){
        for(let c=0;c<perBranch;c++){
          const match=shoots.length?shoots[c%shoots.length]:null;
          let base,dir,baseLength;
          if(match){
            const along=c<shoots.length?0:between(rng,.16,.35);
            base=match.from.clone().lerp(match.to,along);
            dir=match.dir.clone();baseLength=match.len*(1-along*.4);
          } else {
            const u=.20+(c+.5)/perBranch*.72;
            const ix=Math.min(4,Math.floor(u*5));
            base=points[ix].clone().lerp(points[ix+1],u*5-ix);
            dir=unit(points[Math.min(5,ix+1)].clone().sub(points[ix]));baseLength=len*.30;
          }
          targets.push({base,dir,length:baseLength,phase:between(rng,-cardSpread,cardSpread),variant:Math.floor(rng()*4)});
        }
      }
    }
  }
  const positions=[],uvs=[],indices=[];
  const addCard=(target,rotation)=>{
    const dir=unit(target.dir.clone());
    const frame=tangentFrame(dir);
    const widthAxis=frame[0].clone();
    widthAxis.applyAxisAngle(dir,rotation);
    const L=Math.max(.10,target.length*cardLengthScale*between(rng,.9,1.15));
    const W=Math.max(.06,target.length*cardWidthScale*.72*between(rng,.85,1.15));
    // Texture's twig starts near 0; let the first edge enter the secondary branch.
    const center=target.base.clone().addScaledVector(dir,L*.45);
    const a=center.clone().addScaledVector(dir,-L*.5).addScaledVector(widthAxis,-W*.5);
    const b=center.clone().addScaledVector(dir,L*.5).addScaledVector(widthAxis,-W*.5);
    const c=center.clone().addScaledVector(dir,L*.5).addScaledVector(widthAxis,W*.5);
    const d=center.clone().addScaledVector(dir,-L*.5).addScaledVector(widthAxis,W*.5);
    const first=positions.length/3;
    for(const v of [a,b,c,d])positions.push(v.x,v.y,v.z);
    const col=target.variant%2, row=Math.floor(target.variant/2);
    const inset=.008, u0=(col+inset)*.5, u1=(col+1-inset)*.5;
    const v0=(row+inset)*.5, v1=(row+1-inset)*.5;
    uvs.push(u0,v0, u1,v0, u1,v1, u0,v1);
    indices.push(first,first+1,first+2,first,first+2,first+3);
  };
  let atlas=null;
  const available=Math.max(0,cap-wood.triangleCount());
  const perTarget=crossed?4:2;
  const targetCap=Math.floor(available/perTarget);
  if(showFoliage && targetCap>0){
    // Spread rendering budget across the whole tree; never exhaust it at the bottom.
    const chosen=targets.length>targetCap
      ? targets.filter((_,i)=>Math.floor((i+1)*targetCap/targets.length)>Math.floor(i*targetCap/targets.length))
      : targets;
    for(const target of chosen){
      addCard(target,target.phase);
      if(crossed)addCard(target,target.phase+Math.PI/2);
    }
    atlas=createNeedleAtlas(num(p.seed,7),leaf,accent,options.maxAnisotropy);
  }
  const woodMesh=new THREE.Mesh(wood.geometry(),new THREE.MeshLambertMaterial({
    vertexColors:true,
    map:createBarkTexture(num(p.seed,7),options.maxAnisotropy),
  }));
  woodMesh.name='Ствол и ветви';
  tree.add(woodMesh);
  if(atlas && positions.length){
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geo.setIndex(indices);geo.computeVertexNormals();geo.computeBoundingSphere();
    const material=new THREE.MeshStandardMaterial({
      map:atlas,color:0xffffff,roughness:1,metalness:0,side:THREE.DoubleSide,
      alphaTest,transparent:false,depthWrite:true,alphaToCoverage:true
    });
    const cards=new THREE.Mesh(geo,material);
    cards.name='Foliage Cards · текстура хвои';
    cards.castShadow=false;cards.receiveShadow=false;
    tree.add(cards);
  }
  tree.userData.spruceStats={triangleCap:cap,woodTriangles:wood.triangleCount(),needleTriangles:indices.length/3,needleCount:indices.length/6,twigPairs:levels>=2?mainBranchCount*pairsPerMain:0,showSecondaryBranches};
  return tree;
}


/** Parameter set supplied for the forest game. */


/**
 * @param {object} spec Full preset ({params}) or params object.
 * @param {object} options {quality: 'low'|'balanced'|'high', maxAnisotropy: number}
 * @returns {THREE.Group} Procedurally generated tree, ready for scene.add(tree).
 */
export function createSpruce(spec = SPRUCE_PRESET, options = {}) {
  if (spec?.generator && spec.generator !== 'foliageCardsSpruce') {
    throw new Error('Expected generator: foliageCardsSpruce');
  }
  return buildFoliageCardsSpruce(spec, options);
}

/** Frees a generated tree; only call if its resources aren't shared with other trees. */
export function disposeSpruce(tree) {
  tree.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      mat?.map?.dispose();
      mat?.dispose();
    }
  });
}
