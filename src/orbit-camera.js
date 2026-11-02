import {logHalfExtents} from './log-grid.js';
// Third-person camera rig. Pure orbit geometry plus a cheap, collider-based
// spring arm; never raycast the 30k-triangle spruce GLB each frame.
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const smooth=(speed,dt)=>1-Math.exp(-speed*Math.max(0,dt));

// Angles are the same pitch/yaw used by the controls and crosshair.
// Elliptical orbit: reduced vertical radius keeps the camera near shoulder
// height even at the extremes of the vertical look range.
export function orbitOffset(yaw,pitch,distance,side){
  const horizontal=distance*Math.cos(pitch*.75);
  // Looking down (negative pitch) lifts the orbit. Above ~30 degrees the
  // boom starts arcing forward, ending just ahead of the torso at -80°.
  // Smoothstep avoids a snap where this forward adjustment begins.
  const down=clamp((-pitch-Math.PI/6)/(Math.PI*5/18),0,1);
  const advance=(horizontal+.2)*down*down*(3-2*down);
  const back=horizontal-advance;
  // On a strong upward look the elliptical orbit continues downward along
  // a soft arc. By +80° the camera tucks closer to the ground without
  // changing its look direction or the existing downward-look behaviour.
  const up=clamp((pitch-Math.PI/4)/(Math.PI*35/180),0,1);
  const tuck=up*up*(3-2*up);
  const vertical=-distance*.55*Math.sin(pitch)-Math.min(.65,distance*.32)*tuck;
  return {
    x:Math.sin(yaw)*back+Math.cos(yaw)*side,
    y:vertical,
    z:Math.cos(yaw)*back-Math.sin(yaw)*side,
  };
}

// A segment from pivot to camera intersects a tree/rock approximated by an
// upright cylinder. Return its entrance fraction, or 1 when unobstructed.
export function cylinderHit(a,b,x,z,r,bottom,top){
  const dx=b.x-a.x,dz=b.z-a.z;
  const ox=a.x-x,oz=a.z-z;
  const aa=dx*dx+dz*dz;
  if(aa<1e-9)return 1;
  const cc=ox*ox+oz*oz-r*r;
  if(cc<=0)return 1; // Pivot is near this object; do not pin the camera there.
  const bb=2*(ox*dx+oz*dz);
  const discriminant=bb*bb-4*aa*cc;
  if(discriminant<0)return 1;
  const t=(-bb-Math.sqrt(discriminant))/(2*aa);
  if(t<0||t>=1)return 1;
  const y=a.y+(b.y-a.y)*t;
  return y>=bottom && y<=top?t:1;
}

// Logs are horizontal; an expanded box is plenty accurate for a camera boom.
export function boxHit(a,b,mins,maxs){
  let near=0,far=1;
  for(const axis of ['x','y','z']){
    const delta=b[axis]-a[axis];
    if(Math.abs(delta)<1e-9){
      if(a[axis]<mins[axis]||a[axis]>maxs[axis])return 1;
      continue;
    }
    const u=(mins[axis]-a[axis])/delta;
    const v=(maxs[axis]-a[axis])/delta;
    near=Math.max(near,Math.min(u,v));
    far=Math.min(far,Math.max(u,v));
    if(near>far)return 1;
  }
  return near>0&&near<1?near:1;
}

export function springArmFraction(start,end,ctx){
  let fraction=1;
  // Floor is a real obstacle, even with the camera-height slider at minimum.
  const floor=.32;
  if(end.y<floor && start.y>floor)
    fraction=Math.min(fraction,(start.y-floor)/(start.y-end.y));
  for(const t of ctx.trees.values()){
    // Trees have independent logical objects even when their visuals are instanced.
    if(t.position.x<Math.min(start.x,end.x)-1 ||
       t.position.x>Math.max(start.x,end.x)+1 ||
       t.position.z<Math.min(start.z,end.z)-1 ||
       t.position.z>Math.max(start.z,end.z)+1)continue;
    fraction=Math.min(fraction,cylinderHit(start,end,t.position.x,t.position.z,
      .69,0,t.userData.h??12));
  }
  // The rock collider map is already spatially indexed by world chunk.
  const rocks=ctx.rockColliders;
  if(rocks?.size){
    const chunkSize=ctx.chunkSize||24;
    const cx=Math.floor(start.x/chunkSize),cz=Math.floor(start.z/chunkSize);
    for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)
      for(const rock of rocks.get((cx+i)+','+(cz+j))??[])
        fraction=Math.min(fraction,cylinderHit(start,end,rock.x,rock.z,
          rock.radius+.25,rock.bottom,rock.top+.25));
  }
  for(const log of ctx.placed??[]){
    const ext=logHalfExtents(log,ctx.logRadius??.29);
    fraction=Math.min(fraction,boxHit(start,end,{
      x:log.x-ext.x-.3,y:log.y-ext.y-.27,z:log.z-ext.z-.3,
    },{
      x:log.x+ext.x+.3,y:log.y+ext.y+.27,z:log.z+ext.z+.3,
    }));
  }
  return fraction;
}

export function createOrbitCamera(ctx){
  const THREE=ctx.THREE;
  const pivot=new THREE.Vector3();
  const desired=new THREE.Vector3();
  const offset=new THREE.Vector3();
  let initialized=false,armFactor=1;
  function reset(){initialized=false;armFactor=1;}
  function update(dt,follow=null,extraDistance=0){
    const {yaw,pitch,settings,camera}=ctx;
    const px=follow?.px??ctx.px,pz=follow?.pz??ctx.pz;
    const feetY=follow?.feetY??ctx.feetY;
    const distance=settings.cameraDistance+extraDistance;
    // Keep the exact same orbit geometry and collision spring arm for
    // walking and ragdoll. Only the target position follows ragdoll physics.
    const forward=.12+.10*Math.max(0,-Math.sin(pitch));
    const targetX=px-Math.sin(yaw)*forward;
    const targetZ=pz-Math.cos(yaw)*forward;
    const targetY=feetY+1.45+.12*Math.sin(pitch);
    if(!initialized){pivot.set(targetX,targetY,targetZ);initialized=true;}
    else{
      const alpha=smooth(18,dt);
      pivot.x+=(targetX-pivot.x)*alpha;
      pivot.y+=(targetY-pivot.y)*alpha;
      pivot.z+=(targetZ-pivot.z)*alpha;
    }
    const p=orbitOffset(yaw,pitch,distance,settings.cameraSide);
    offset.set(p.x,p.y+settings.cameraHeight-1.45,p.z);
    desired.copy(pivot).add(offset);

    // Pull in immediately on obstruction; ease out after the obstacle clears.
    const length=offset.length();
    const hit=springArmFraction(pivot,desired,ctx);
    const available=hit<1?clamp(hit-.25/Math.max(.01,length),.08,1):1;
    armFactor=available<armFactor?available:
      armFactor+(available-armFactor)*smooth(7,dt);
    camera.position.copy(pivot).addScaledVector(offset,armFactor);
    // Pitch remains a true look angle for the crosshair, not a pitch induced by
    // the spring arm shortening or a separate lookAt that jumps at obstacles.
    camera.rotation.set(pitch,yaw,0);
  }
  return {update,reset};
}
