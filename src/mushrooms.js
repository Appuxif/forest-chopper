// Four recognizable low-poly forest mushrooms. All GPU resources are created once:
// spawning/rebuilding a chunk only adds lightweight Mesh/Group instances.
export const MUSHROOM_SPECIES = Object.freeze([
  'fly_agaric', // red spotted cap, slender white stem
  'boletus',     // broad brown bun, stout stem
  'death_cap',   // pale green bell, narrow stem with a skirt
  'milkcap',     // wide cream funnel with a sunken centre
]);

export function createMushrooms(THREE) {
  const material = (color, options = {}) =>
    new THREE.MeshLambertMaterial({color, ...options});
  const stems = [
    material(0xf4e8d2),
    material(0xe2bf95),
    material(0xf0eed6),
    material(0xeedaba),
  ];
  const caps = [
    material(0xce382e, {side:THREE.DoubleSide}),
    material(0x8b5736, {side:THREE.DoubleSide}),
    material(0xc0c889, {side:THREE.DoubleSide}),
    material(0xd9b277, {side:THREE.DoubleSide}),
  ];
  const pale = material(0xf7edcf, {side:THREE.DoubleSide});
  const pores = material(0xd5b875, {side:THREE.DoubleSide});
  const spots = material(0xfffaea, {side:THREE.DoubleSide});

  // One tapered cylinder shared by stems of every species (different scales).
  const stemGeometry = new THREE.CylinderGeometry(.66, 1, 1, 8);
  // Top half of a sphere: the bright, rounded fly-agaric silhouette.
  const flyCapGeometry = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI*2, 0, Math.PI/2);
  const profile = points => new THREE.LatheGeometry(
    points.map(([radius, height]) => new THREE.Vector2(radius, height)), 12,
  );
  // Profiles are bottom-to-top, closing the underside without expensive meshes.
  const boleteCapGeometry = profile([
    [0,-.10],[.33,-.10],[.56,-.08],[.64,0],[.62,.12],
    [.48,.26],[.27,.35],[0,.37],
  ]);
  const deathCapGeometry = profile([
    [0,-.09],[.24,-.09],[.43,-.07],[.46,0],
    [.35,.24],[.16,.48],[0,.57],
  ]);
  const milkCapGeometry = profile([
    [0,-.09],[.29,-.09],[.55,-.07],[.68,-.015],[.68,.10],
    [.59,.20],[.39,.16],[.20,.05],[0,-.045],
  ]);
  const undersideGeometry = new THREE.CircleGeometry(1, 12);
  const ringGeometry = new THREE.TorusGeometry(.16, .035, 4, 10);

  // All the white spots are baked into ONE shared small mesh (not 10 draw calls).
  // Each flattened polygon follows the ellipsoid's upper surface, slightly raised.
  const positions = [];
  const points = [
    [0,0,.085],[.31,.06,.080],[-.29,.16,.075],
    [.10,-.31,.078],[-.24,-.28,.064],
    [.38,-.23,.058],[-.42,-.06,.061],
    [-.10,.39,.060],[.20,.38,.057],
  ];
  function surface(x,z) {
    const radius = (x/.58)**2+(z/.58)**2;
    return .74+.42*Math.sqrt(Math.max(0,1-radius))+.012;
  }
  for(const [cx,cz,r] of points){
    const count=7;
    const vertices=[];
    for(let k=0;k<count;k++){
      const angle=k*2*Math.PI/count;
      const x=cx+r*Math.cos(angle),z=cz+r*Math.sin(angle);
      vertices.push([x,surface(x,z),z]);
    }
    for(let k=0;k<count;k++){
      positions.push(cx,surface(cx,cz),cz,
        ...vertices[k],...vertices[(k+1)%count]);
    }
  }
  const spotsGeometry=new THREE.BufferGeometry();
  spotsGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  spotsGeometry.computeVertexNormals();

  const geometries=[
    stemGeometry,flyCapGeometry,boleteCapGeometry,deathCapGeometry,
    milkCapGeometry,undersideGeometry,ringGeometry,spotsGeometry,
  ];
  const materials=[...stems,...caps,pale,pores,spots];

  function part(group, geometry, mat, x, y, z, sx=1, sy=1, sz=1, role='') {
    const mesh=new THREE.Mesh(geometry,mat);
    mesh.receiveShadow=true;
    mesh.position.set(x,y,z);
    mesh.scale.set(sx,sy,sz);
    mesh.userData.mushroomPart=role;
    group.add(mesh);
    return mesh;
  }

  function create(speciesIndex) {
    const index=Number.isInteger(speciesIndex) && speciesIndex>=0 &&
      speciesIndex<MUSHROOM_SPECIES.length ? speciesIndex : 0;
    const group=new THREE.Group();
    group.userData.mushroomSpecies=MUSHROOM_SPECIES[index];

    const heights=[.74,.69,.91,.50];
    const widths=[.15,.25,.11,.18];
    part(group,stemGeometry,stems[index],0,heights[index]/2,0,
      widths[index],heights[index],widths[index],'stem');

    if(index===0) { // Fly agaric: recognisable red dome with nine off-white spots.
      part(group,flyCapGeometry,caps[index],0,.74,0,.58,.42,.58,'cap');
      const under=part(group,undersideGeometry,pale,0,.725,0,.57,.57,1,'gills');
      under.rotation.x=Math.PI/2;
      part(group,spotsGeometry,spots,0,0,0,1,1,1,'spots');
    }else if(index===1) { // Boletus: fat stem, broad brown bun, ochre pores.
      part(group,boleteCapGeometry,caps[index],0,.68,0,1,1,1,'cap');
      const under=part(group,undersideGeometry,pores,0,.59,0,.55,.55,1,'pores');
      under.rotation.x=Math.PI/2;
    }else if(index===2) { // Death cap: pale green bell and an unmistakable white ring.
      part(group,deathCapGeometry,caps[index],0,.87,0,1,1,1,'cap');
      const under=part(group,undersideGeometry,pale,0,.78,0,.42,.42,1,'gills');
      under.rotation.x=Math.PI/2;
      const ring=part(group,ringGeometry,pale,0,.66,0,1,1,1,'ring');
      ring.rotation.x=Math.PI/2;
    }else { // Milkcap: warm broad cap with a depressed funnel centre.
      part(group,milkCapGeometry,caps[index],0,.50,0,1,1,1,'cap');
      const under=part(group,undersideGeometry,pale,0,.405,0,.52,.52,1,'gills');
      under.rotation.x=Math.PI/2;
    }
    return group;
  }

  return {create,geometries,materials};
}
