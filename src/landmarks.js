// Shared low-poly navigation cues. The trail is purely visual:
// tree spawn coordinates, collision, server and save state remain unchanged.
export function createLandmarks(ctx,doc=document) {
  const THREE=ctx.THREE;
  const trailGeometry=new THREE.PlaneGeometry(ctx.chunkSize,3.2);
  const trailMaterial=new THREE.MeshLambertMaterial({color:0x977f5a,side:THREE.DoubleSide});
  const poleGeometry=new THREE.CylinderGeometry(.115,.15,2.1,6);
  const poleMaterial=new THREE.MeshLambertMaterial({color:0x76553b});
  const boardGeometry=new THREE.PlaneGeometry(3.0,.8);

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

  function decorate(group,cx,cz) {
    if(cz!==0)return;
    // One continuous west-east band: exactly one shared flat quad per trail chunk.
    const trail=new THREE.Mesh(trailGeometry,trailMaterial);
    trail.rotation.x=-Math.PI/2;
    trail.position.set(cx*ctx.chunkSize+ctx.chunkSize/2,.025,0);
    trail.userData.landmark='trail';
    group.add(trail);

    // Every third chunk, one noninteractive sign on the edge of the trail.
    if(cx%3!==0)return;
    const position=signPosition(cx,cz);
    if(!position)return;
    const pole=new THREE.Mesh(poleGeometry,poleMaterial);
    pole.position.set(position.x,1.05,position.z);
    pole.userData.landmark='signpost';
    group.add(pole);
    const board=new THREE.Mesh(boardGeometry,boardMaterials[cx<0?1:0]);
    board.position.set(position.x,2.0,position.z);
    board.rotation.y=Math.PI; // Facing the trail to the south; readable from the path.
    board.userData.landmark='signboard';
    group.add(board);
  }
  return {decorate,signPosition};
}
