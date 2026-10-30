// Shared procedural tree meshes. Generated once, reused for every tree:
// no per-tree geometry, texture or material allocations.
export function createTreeGeometry(THREE) {
  const geometry=(positions,colors,uvs)=>{
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    if(colors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    if(uvs)g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    g.computeVertexNormals();
    return g;
  };
  const pin=[],pu=[];
  const bin=[],bu=[];
  const pi=Math.PI;
  function trunk(positions,uvs,birch){
    const segments=14,rings=9;
    const triangle=(a,b,c,uv1,uv2,uv3)=>{
      positions.push(...a,...b,...c);
      uvs.push(...uv1,...uv2,...uv3);
    };
    const point=(angle,v)=>{
      const wobble=1+.023*Math.sin(angle*5.0+v*13)+
        .018*Math.sin(angle*9-v*21);
      const r=(.6*(1-v)+.38*v)*wobble;
      return [Math.cos(angle)*r,v-.5,Math.sin(angle)*r];
    };
    for(let j=0;j<rings;j++)for(let i=0;i<segments;i++){
      const u=i/segments,u1=(i+1)/segments,v=j/rings,v1=(j+1)/rings;
      const a=point(u*2*pi,v),b=point(u1*2*pi,v);
      const c=point(u*2*pi,v1),d=point(u1*2*pi,v1);
      triangle(a,c,b,[u,v],[u,v1],[u1,v]);
      triangle(b,c,d,[u1,v],[u,v1],[u1,v1]);
    }
    // The twigs of the birch are real branching geometry, sharing its bark
    // material and staying in the existing single-trunk draw call.
    if(!birch)return;
    const tube=(a,b,r0,r1)=>{
      const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2];
      const len=Math.hypot(dx,dy,dz)||1;
      const sx=-dz/len,sz=dx/len,sideLen=Math.hypot(sx,sz)||1;
      const ux=sx/sideLen,uz=sz/sideLen;
      // Local Y is scaled by the tree's 7.5–14 m height, so squash the
      // cross-section vertically before the whole tree is scaled.
      for(let n=0;n<6;n++){
        const t=n*pi/3,t1=(n+1)*pi/3;
        const p=(end,r,angle)=>{
          const cs=Math.cos(angle),sn=Math.sin(angle);
          return [end[0]+ux*r*cs,end[1]+.12*r*sn,
            end[2]+uz*r*cs];
        };
        const p0=p(a,r0,t),p1=p(a,r0,t1),q0=p(b,r1,t),q1=p(b,r1,t1);
        triangle(p0,q0,p1,[n/6,0],[n/6,1],[(n+1)/6,0]);
        triangle(p1,q0,q1,[(n+1)/6,0],[n/6,1],[(n+1)/6,1]);
      }
    };
    for(let k=0;k<9;k++){
      const a=(k/9)*2*pi+.16*Math.sin(k*11.17);
      const dx=Math.cos(a),dz=Math.sin(a);
      const height=.09+.035*(k%4);
      const base=[dx*.25,height,dz*.25];
      const elbow=[dx*(.75+.08*(k%3)),.28+.045*(k%4),dz*(.75+.08*(k%3))];
      const end=[dx*(1.35+.16*(k%3)),.51+.035*(k%4),
        dz*(1.35+.16*(k%3))];
      tube(base,elbow,.12,.079);
      tube(elbow,end,.079,.031);
      // Forked slender twigs support the leaf clusters above.
      const turn=a+.45*(k%2?1:-1);
      tube(end,[end[0]+.36*Math.cos(turn),end[1]+.1,
        end[2]+.36*Math.sin(turn)],.035,.005);
      tube(elbow,[end[0]-.21*Math.sin(a),end[1]-.035,
        end[2]+.21*Math.cos(a)],.036,.008);
    }
  }
  trunk(pin,pu,false);
  trunk(bin,bu,true);

  const pinePos=[],pineCol=[];
  const birchPos=[],birchCol=[];
  function coloredTriangle(pos,col,a,b,c,ca,cb,cc){
    pos.push(...a,...b,...c);
    col.push(...ca,...cb,...cc);
  }
  // Branch fans: each twig has a serrated needle outline, tapered tip,
  // drooping outer half and a darker interior. Three staggered whorls
  // produce open layered branches rather than four solid cones.
  for(let layer=0;layer<4;layer++){
    const y=-.46+layer*.255;
    const radius=1-layer*.18;
    for(let branch=0;branch<12;branch++){
      const angle=2*pi*(branch+(layer%2)*.5)/12;
      const c=Math.cos(angle),s=Math.sin(angle),tx=-s,tz=c;
      const shift=1+.08*Math.sin(branch*7.3+layer*13.1);
      const stages=[0.12,.36,.58,.79,1];
      const widths=[.10,.20,.25,.14,0];
      const center=t=>{
        const drop=.16*t*t;
        return [c*radius*t*shift,y+.11-.11*t-drop,s*radius*t*shift];
      };
      const left=(i)=>{
        const p=center(stages[i]),w=widths[i]*radius*
          (i%2===1?1.17:.94);
        return [p[0]+tx*w,p[1]+.018*Math.sin(i*2),p[2]+tz*w];
      };
      const right=(i)=>{
        const p=center(stages[i]),w=widths[i]*radius*
          (i%2===1?1.17:.94);
        return [p[0]-tx*w,p[1]+.018*Math.sin(i*2+1),p[2]-tz*w];
      };
      const shading=t=>[.72+.32*t,.80+.26*t,.75+.20*t];
      for(let i=0;i<4;i++){
        const a=left(i),b=right(i),c=left(i+1),d=right(i+1);
        const low=shading(stages[i]),high=shading(stages[i+1]);
        coloredTriangle(pinePos,pineCol,a,c,b,low,high,low);
        coloredTriangle(pinePos,pineCol,b,c,d,low,high,high);
        // An underside lip gives each bough a dimensional outline.
        const e=[c[0],c[1]-.047,c[2]];
        coloredTriangle(pinePos,pineCol,a,e,c,
          [.48,.57,.47],[.55,.63,.49],high);
      }
    }
  }
  // Jagged, small-scale leaf bouquets: faceted leaf groups grow around the
  // birch's white branching skeleton, never a single round icosahedron.
  for(let k=0;k<17;k++){
    const a=k*2.399963+0.18;
    const rad=.16+.67*Math.sqrt((k+.4)/17);
    const cx=Math.cos(a)*rad,cz=Math.sin(a)*rad*.78;
    const cy=.35*Math.sin(k*1.91)+.22*(1-rad);
    const size=.19+.09*(.5+.5*Math.sin(k*12.7));
    const tip=[cx+.11*Math.cos(a),cy+size*.95,cz+.11*Math.sin(a)];
    const root=[cx-.055*Math.cos(a),cy-size*.75,cz-.055*Math.sin(a)];
    const east=[cx+size,cy+.015,cz],west=[cx-size,cy+.015,cz];
    const north=[cx,cy+.08,cz+size*.76],south=[cx,cy-.055,cz-size*.76];
    const light=[.91,1.06,.88],dark=[.60,.79,.58],mid=[.76,.93,.70];
    coloredTriangle(birchPos,birchCol,tip,east,north,light,mid,light);
    coloredTriangle(birchPos,birchCol,tip,north,west,light,dark,mid);
    coloredTriangle(birchPos,birchCol,tip,west,south,light,mid,dark);
    coloredTriangle(birchPos,birchCol,tip,south,east,light,mid,mid);
    coloredTriangle(birchPos,birchCol,root,north,east,dark,mid,mid);
    coloredTriangle(birchPos,birchCol,root,west,north,dark,dark,mid);
    coloredTriangle(birchPos,birchCol,root,south,west,dark,mid,dark);
    coloredTriangle(birchPos,birchCol,root,east,south,dark,mid,mid);
    // Two narrow detached leaflets along each outer twig.
    if(k%2===0){
      const x=cx+.16*Math.cos(a),z=cz+.16*Math.sin(a);
      coloredTriangle(birchPos,birchCol,
        [cx,cy-.08,cz],[x+.06,cy+.17,z],[x-.12,cy+.02,z+.13],
        dark,light,mid);
    }
  }
  return {
    trunkGeo:geometry(pin,null,pu),
    birchTrunkGeo:geometry(bin,null,bu),
    leafGeo:geometry(pinePos,pineCol,null),
    birchLeafGeo:geometry(birchPos,birchCol,null),
  };
}
