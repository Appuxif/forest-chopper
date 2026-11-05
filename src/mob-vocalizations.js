import {MOB_VOICE_PROFILES} from './sound-rules.js?v=20261105-mob-hit-audio1';

// Client presentation only. Timers are bounded per visible entity; neither
// simulation/save clocks nor WebAudio sources belong to this scheduler.
export function createMobVocalizations({definitionFor,emit,random=Math.random,profiles=MOB_VOICE_PROFILES}){
 const states=new Map();let clock=0;
 const unit=()=>{const n=random();return Math.max(0,Math.min(1-Number.EPSILON,Number.isFinite(n)?n:0));};
 const between=([min,max])=>min+(max-min)*unit();
 function cluck(state,profile,mob){
  const count=profile.clucks.length;
  let index=Math.floor(unit()*Math.max(1,count-(state.last>=0&&count>1?1:0)));
  if(count>1&&state.last>=0&&index>=state.last)index++;
  index=Math.min(count-1,index);state.last=index;emit(profile.clucks[index],mob);
 }
 function tick(dt,records){
  clock+=Math.min(.5,Math.max(0,Number(dt)||0));const seen=new Set();
  for(const mob of records){
   const definition=definitionFor(mob.type),profile=profiles[definition?.voiceProfile];
   if(!profile)continue;
   if(mob.hp<=0){
    // Only a live-to-dead transition is audible: loading an existing corpse
    // or receiving the same authoritative snapshot must stay silent.
    if(states.has(mob.id)&&profile.death)emit(profile.death,mob);
    states.delete(mob.id);continue;
   }
   seen.add(mob.id);let state=states.get(mob.id);
   if(!state){state={fleeing:false,next:clock+between(profile.idleGap),remaining:0,last:-1,alarmUntil:0,alarmPending:false};states.set(mob.id,state);}
   const fleeing=definition.behavior.id==='wary'&&mob.state===definition.animations.run&&!mob.flockFollowing;
   if(fleeing!==state.fleeing){
    state.fleeing=fleeing;state.remaining=0;
    state.alarmPending=fleeing;state.alarmUntil=fleeing?clock+1:0;
    state.next=clock+(fleeing?profile.alarmPause:between(profile.idleGap));
   }
   if(state.alarmPending){
    // Briefly allow the already user-unlocked mixer to finish loading. Never
    // replay a stale alarm later or schedule it as a loop.
    if(emit(profile.alarm,mob)){state.alarmPending=false;state.next=clock+profile.alarmPause;}
    else if(clock>=state.alarmUntil)state.alarmPending=false;
    continue;
   }
   if(clock<state.next)continue;
   if(fleeing){cluck(state,profile,mob);state.next=clock+between(profile.panicGap);continue;}
   if(!state.remaining){const [min,max]=profile.burstCount;state.remaining=min+Math.floor(unit()*(max-min+1));}
   cluck(state,profile,mob);state.remaining--;
   state.next=clock+between(state.remaining?profile.burstGap:profile.idleGap);
  }
  for(const id of states.keys())if(!seen.has(id))states.delete(id);
 }
 return {tick,clear(){states.clear();clock=0;},get size(){return states.size;}};
}
