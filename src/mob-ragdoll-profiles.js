import {HEN_RAGDOLL_PROFILE} from './hen-ragdoll.js';
// Bootstrap registers species data; the ragdoll engine knows no species names.
export function createMobRagdollProfiles(entries={chicken:HEN_RAGDOLL_PROFILE}){
 const profiles=new Map(Object.entries(entries));
 return {get:id=>profiles.get(id),register(id,profile){if(profiles.has(id)||!profile?.segments?.length)throw new Error('Invalid or duplicate ragdoll profile');profiles.set(id,profile);}};
}
