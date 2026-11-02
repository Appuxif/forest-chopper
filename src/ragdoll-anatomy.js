// Geometric calibration for a *real* three-point limb, not a zero-angle
// assumption. At the instant the joint is created its motor angle is zero;
// the upper and lower segment directions may already differ by ~40 degrees.
// A target of zero would simply restore that original bend.
export const RAGDOLL_LIMB_END_BONES=Object.freeze({
 'Forearm.L':'hand_l',
 'Forearm.R':'hand_r',
 'Shin.L':'foot_l',
 'Shin.R':'foot_r',
});
const diff=(a,b)=>({x:b.x-a.x,y:b.y-a.y,z:b.z-a.z});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const norm=a=>Math.hypot(a.x,a.y,a.z);
const cross=(a,b)=>({
 x:a.y*b.z-a.z*b.y,
 y:a.z*b.x-a.x*b.z,
 z:a.x*b.y-a.y*b.x,
});
const unit=a=>{const len=norm(a);return {x:a.x/len,y:a.y/len,z:a.z/len};};
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));

// The hinge rotates in the plane of the limb. Its world-space axis points
// along upper x lower, so increasing Rapier angle bends the limb *further*.
// The joint is born at angle=0; the straight target must compensate for the
// measured bend at creation, including different animation/rest poses.
export function calibrateLimbJoint(upperStart,pivot,lowerEnd,{
  relaxedBend=.12,maxBend=2.45,hyperextension=.12,
}={}){
 if(!upperStart||!pivot||!lowerEnd)return null;
 const upper=diff(upperStart,pivot),lower=diff(pivot,lowerEnd);
 if(norm(upper)<.03||norm(lower)<.03)return null;
 const up=unit(upper),lo=unit(lower);
 const normal=cross(up,lo);
 const bend=Math.atan2(norm(normal),Math.max(-1,Math.min(1,dot(up,lo))));
 // Nearly collinear directions have an ambiguous hinge plane, and nearly
 // reversed limbs should never be corrected by guessing an axis.
 if(norm(normal)<.02||bend>2.7)return null;
 const axis=unit(normal);
 const limits=[-bend-hyperextension,Math.max(.08,maxBend-bend)];
 const target=Math.max(limits[0],Math.min(limits[1],relaxedBend-bend));
 return {axis,bend,limits,target};
}
