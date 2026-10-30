// Lightweight offline-at-startup tree growth recipes. Exactly ten shared
// geometries per species, reused with four GPU instances per tree canopy.
// Birch: attraction-point growth (space colonization), with a strict node cap.
// Fir: Weber-Penn-inspired tier taper, branch angles, and drooping branchlets.
// No per-tree procedural geometry and no biological time simulation.
export const TREE_VARIANT_COUNT = 10;

function randomFor(seed) {
  let state = (seed * 1664525 + 1013904223) >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
const PI = Math.PI;
const rotateY = (p, a) => [
  p[0]*Math.cos(a)-p[2]*Math.sin(a), p[1],
  p[0]*Math.sin(a)+p[2]*Math.cos(a),
];

function builder(withUvs=false, withColors=false) {
  const positions=[], uvs=[], colors=[];
  return {
    positions,uvs,colors,
    tri(a,b,c,uv=null,shade=null) {
      positions.push(...a,...b,...c);
      if(withUvs)uvs.push(...(uv??[0,0,0,1,1,0]));
      if(withColors)colors.push(...(shade??[
        .85,.95,.84,.85,.95,.84,.85,.95,.84,
      ]));
    },
    finish(THREE) {
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      if(withUvs)geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
      if(withColors)geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
      geo.computeVertexNormals();
      return geo;
    },
  };
}

function barkFromBase(baseGeo) {
  const out=builder(true);
  const p=baseGeo.getAttribute('position').array;
  const uv=baseGeo.getAttribute('uv').array;
  for(let i=0,j=0;i<p.length;i+=9,j+=6){
    out.tri([p[i],p[i+1],p[i+2]],
      [p[i+3],p[i+4],p[i+5]],
      [p[i+6],p[i+7],p[i+8]],
      [uv[j],uv[j+1],uv[j+2],uv[j+3],uv[j+4],uv[j+5]]);
  }
  return out;
}

// Tube coordinates are in tree units where Y is multiplied ~8x by the
// existing trunk transform; compute the cross section in unsquashed space.
function twig(out, a, b, r0, r1, segments=5) {
  const dx=b[0]-a[0],dy=(b[1]-a[1])*8,dz=b[2]-a[2];
  const len=Math.hypot(dx,dy,dz)||1;
  const forward=[dx/len,dy/len,dz/len];
  let side=[-forward[2],0,forward[0]];
  const sideLength=Math.hypot(...side);
  if(sideLength<.0001)side=[1,0,0];
  else side=side.map(x=>x/sideLength);
  const up=[
    forward[1]*side[2]-forward[2]*side[1],
    forward[2]*side[0]-forward[0]*side[2],
    forward[0]*side[1]-forward[1]*side[0],
  ];
  const point=(p,r,angle)=>[
    p[0]+r*(side[0]*Math.cos(angle)+up[0]*Math.sin(angle)),
    p[1]+r*(side[1]*Math.cos(angle)+up[1]*Math.sin(angle))/8,
    p[2]+r*(side[2]*Math.cos(angle)+up[2]*Math.sin(angle)),
  ];
  for(let i=0;i<segments;i++){
    const t=i*2*PI/segments,n=(i+1)*2*PI/segments;
    const a0=point(a,r0,t),a1=point(a,r0,n);
    const b0=point(b,r1,t),b1=point(b,r1,n);
    const u=i/segments,v=(i+1)/segments;
    out.tri(a0,b0,a1,[u,0,u,1,v,0]);
    out.tri(a1,b0,b1,[v,0,u,1,v,1]);
  }
}

function leafCluster(out, point, rand, size=.11) {
  // A small spray of pointed leaves, not round blobs. Mesh is double-sided.
  const palette=[
    [.68,.83,.62],[.79,.94,.72],[.89,1.04,.83],[.61,.77,.55],
  ];
  for(let l=0;l<7;l++){
    const a=rand()*2*PI,cs=Math.cos(a),sn=Math.sin(a);
    const length=size*(.6+rand()*.8),width=length*(.28+.14*rand());
    const origin=[point[0]+(rand()-.5)*.055,
      point[1]+(rand()-.5)*.025,point[2]+(rand()-.5)*.055];
    const tip=[origin[0]+cs*length,
      origin[1]+.015+rand()*.05,origin[2]+sn*length];
    const left=[origin[0]-sn*width,origin[1]+.006,
      origin[2]+cs*width];
    const right=[origin[0]+sn*width,origin[1]-.003,
      origin[2]-cs*width];
    const dark=palette[(l+3)%4],bright=palette[l%4],mid=palette[1];
    out.tri(origin,left,tip,[0,0,0,0,0,0],[...dark,...mid,...bright]);
    out.tri(origin,tip,right,[0,0,0,0,0,0],[...dark,...bright,...mid]);
  }
}

function spaceColonization(rand) {
  // Grow one 90-degree crown sector. Nearest active twigs attract nearby
  // leaf points; nearby points disappear as a twig reaches them.
  const attractors=[];
  const targetCount=43+Math.floor(rand()*15);
  for(let i=0;i<targetCount;i++){
    const angle=(rand()-.5)*1.35;
    const radial=.65+Math.sqrt(rand())*2.05;
    attractors.push([
      radial*Math.cos(angle),-.11+rand()*.52,
      radial*Math.sin(angle),
    ]);
  }
  const nodes=[
    {p:[.12,-.16,0],parent:-1,depth:0},
    {p:[.51,-.065,0],parent:0,depth:1},
  ];
  let remaining=attractors;
  const influence=2.05,kill=.20,step=.175;
  for(let iteration=0;iteration<26 && remaining.length && nodes.length<95;iteration++){
    const assigned=new Map(),unreached=[];
    for(const attractor of remaining){
      let nearest=-1,best=influence*influence;
      let hit=false;
      for(let i=0;i<nodes.length;i++){
        const p=nodes[i].p;
        const dx=attractor[0]-p[0],dy=(attractor[1]-p[1])*5,
          dz=attractor[2]-p[2];
        const d=dx*dx+dy*dy+dz*dz;
        if(d<kill*kill){hit=true;break;}
        if(d<best){best=d;nearest=i;}
      }
      if(hit)continue;
      unreached.push(attractor);
      if(nearest<0)continue;
      const p=nodes[nearest].p;
      const dx=attractor[0]-p[0],dy=(attractor[1]-p[1])*5,
        dz=attractor[2]-p[2],distance=Math.hypot(dx,dy,dz)||1;
      let acc=assigned.get(nearest);
      if(!acc){acc=[0,0,0,0];assigned.set(nearest,acc);}
      acc[0]+=dx/distance;acc[1]+=dy/distance;acc[2]+=dz/distance;acc[3]++;
    }
    remaining=unreached;
    if(assigned.size===0)break;
    for(const [i,acc] of assigned){
      if(nodes.length>=95)break;
      const mag=Math.hypot(acc[0],acc[1],acc[2])||1;
      const p=nodes[i].p;
      const pos=[p[0]+step*acc[0]/mag,
        p[1]+step*.20*acc[1]/mag,p[2]+step*acc[2]/mag];
      // Avoid redundant co-located sprouts from converging twigs.
      if(nodes.some(n=>(n.p[0]-pos[0])**2+
          ((n.p[1]-pos[1])*5)**2+(n.p[2]-pos[2])**2<.065**2))continue;
      nodes.push({p:pos,parent:i,depth:nodes[i].depth+1});
    }
  }
  return nodes;
}

function birchVariant(THREE,baseTrunk,seed) {
  const rand=randomFor(seed);
  const branches=barkFromBase(baseTrunk);
  const leaves=builder(false,true);
  const nodes=spaceColonization(rand);
  const childCounts=new Uint16Array(nodes.length);
  for(const node of nodes)if(node.parent>=0)childCounts[node.parent]++;
  for(let k=1;k<nodes.length;k++){
    const node=nodes[k],parent=nodes[node.parent];
    const radius=Math.max(.012,.105-node.depth*.0044);
    for(let quarter=0;quarter<4;quarter++){
      const angle=quarter*PI/2;
      twig(branches,rotateY(parent.p,angle),rotateY(node.p,angle),
        radius*1.17,radius*.75);
    }
  }
  // Keep leaf growth concentrated on the latest twigs and open branch
  // junctions so white bark remains visible through an irregular crown.
  const endpoints=[];
  for(let i=1;i<nodes.length;i++){
    const node=nodes[i];
    if(childCounts[i]===0 || (node.depth>4 && i%4===0))endpoints.push(node);
  }
  // A sector has the same foliage geometry in each of four GPU instances.
  for(const node of endpoints.slice(-54)){
    const p=node.p;
    leafCluster(leaves,[p[0]*.32,p[1],p[2]*.32],rand,
      .065+rand()*.048);
  }
  return {trunk:branches.finish(THREE),canopy:leaves.finish(THREE),
    growthNodes:nodes.length,leafClusters:Math.min(endpoints.length,54)};
}

function coniferVariant(THREE,baseTrunk,seed) {
  const rand=randomFor(seed);
  const branches=barkFromBase(baseTrunk);
  const needles=builder(false,true);
  const levels=5+Math.floor(rand()*3);
  const crownWidth=2.65+rand()*.50;
  const droop=.035+rand()*.055;
  // Weber-Penn-like branching hierarchy: trunk -> tapered whorls ->
  // alternating lateral needle sprays. No iterative simulation.
  for(let level=0;level<levels;level++){
    const t=level/(levels-1);
    const y=-.30+t*.73;
    const branchLength=crownWidth*Math.pow(1-t,.82)+.16;
    const branchCount=2+(level%2);
    for(let b=0;b<branchCount;b++){
      const a=-PI/4+(b+.45+rand()*.18)/branchCount*(PI/2);
      const c=Math.cos(a),s=Math.sin(a);
      const length=branchLength*(.83+.25*rand());
      const base=[c*.14,y,s*.14];
      const middle=[c*length*.49,y+.025,s*length*.49];
      const tip=[c*length,y+.058-droop*length*.42,s*length];
      // Real radial wooden branches baked into the trunk mesh.
      for(let q=0;q<4;q++){
        twig(branches,rotateY(base,q*PI/2),rotateY(middle,q*PI/2),
          .075*(1-t*.52),.038*(1-t*.45));
        twig(branches,rotateY(middle,q*PI/2),rotateY(tip,q*PI/2),
          .038*(1-t*.45),.006);
      }
      // A continuous serrated needle pad around the woody branch. Wide
      // diagonal faces make the bough readable from ground-level cameras,
      // while the thin dark underside leaves gaps between crown tiers.
      const segments=6,stemWidth=.31+.11*rand(),needleHeight=.045+.015*rand();
      const frame=(k)=>{
        const u=k/segments;
        const x=base[0]+(tip[0]-base[0])*u;
        const z=base[2]+(tip[2]-base[2])*u;
        const height=y+.035*u-droop*length*.42*u*u;
        const taper=Math.pow(Math.max(0,1-u),.57);
        const jagged=1+.13*Math.sin(k*8.2+level*1.3+b*3.7);
        const width=(.12+stemWidth*Math.sin(PI*u)**.7)*taper*jagged*(1-t*.27);
        const lx=(x-s*width)/crownWidth,lz=(z+c*width)/crownWidth;
        const rx=(x+s*width)/crownWidth,rz=(z-c*width)/crownWidth;
        const px=x/crownWidth,pz=z/crownWidth;
        const thickness=needleHeight*(.55+.45*taper);
        return {
          left:[lx,height-thickness*.36,lz],
          right:[rx,height-thickness*.36,rz],
          up:[px,height+thickness,pz],
          down:[px,height-thickness*.93,pz],
        };
      };
      for(let k=0;k<segments;k++){
        const a0=frame(k),a1=frame(k+1);
        const shade=.78+.10*t+.10*k/segments;
        const dark=[shade*.58,shade*.71,shade*.57];
        const lower=[shade*.69,shade*.83,shade*.65];
        const mid=[shade*.90,shade*1.03,shade*.83];
        const bright=[shade*1.08,shade*1.21,shade*.99];
        needles.tri(a0.up,a0.left,a1.up,null,[...bright,...mid,...bright]);
        needles.tri(a1.up,a0.left,a1.left,null,[...bright,...mid,...mid]);
        needles.tri(a0.up,a1.up,a0.right,null,[...bright,...bright,...mid]);
        needles.tri(a0.right,a1.up,a1.right,null,[...mid,...bright,...mid]);
        needles.tri(a0.left,a0.down,a1.left,null,[...mid,...dark,...mid]);
        needles.tri(a1.left,a0.down,a1.down,null,[...mid,...dark,...lower]);
        needles.tri(a0.down,a0.right,a1.down,null,[...dark,...mid,...lower]);
        needles.tri(a1.down,a0.right,a1.right,null,[...lower,...mid,...mid]);
      }
    }
  }
  return {trunk:branches.finish(THREE),canopy:needles.finish(THREE),
    whorls:levels};
}

export function createTreeVariants(THREE, baseTrunk) {
  const birch=[],conifer=[];
  for(let i=0;i<TREE_VARIANT_COUNT;i++){
    birch.push(birchVariant(THREE,baseTrunk,0x726b001+i*997));
    conifer.push(coniferVariant(THREE,baseTrunk,0x919a142+i*997));
  }
  return {birch,conifer};
}
