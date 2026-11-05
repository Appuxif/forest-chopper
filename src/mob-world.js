import {createMobPopulation} from './mob-population.js';
import {createMobTypeRegistry} from './mob-types.js';
import {createMobBehaviorRegistry} from './mob-ai.js';
import {applyEntityDamage} from './entity-combat.js';

// Populations share the same lifecycle, clocks, damage and loot APIs. Species
// add data/behavior plugins, not another copy of world/death/inventory logic.
export function createMobWorld({seed=0,registry=createMobTypeRegistry(),behaviors=createMobBehaviorRegistry(),...environment}={}){
 const build=()=>new Map(registry.list().map(definition=>[definition.id,createMobPopulation({...environment,canStand:(x,z)=>environment.canStand?.(x,z,definition)??true,seed,definition,behaviors})]));
 let populations=build(),records=new Map();
 const populationFor=id=>{if(typeof id!=='string')return null;const def=registry.list().find(d=>id.startsWith(d.spawn.idPrefix+':'));return def?populations.get(def.id):null;};
 function tick(dt,observers,options){const values=[...populations.values()].flatMap(p=>p.tick(dt,observers,options));records=new Map(values.map(r=>[r.id,r]));return values;}
 function damage(id,amount,source=null,policy={}){
  const record=records.get(id),population=populationFor(id);if(!record||!population)return false;
  const target={id:record.id,kind:'mob',type:record.type,faction:record.faction,health:record.hp,alive:record.hp>0,
   receiveDamage:(n,attacker)=>population.damage(id,n,attacker)};
  return applyEntityDamage(source,target,amount,policy);
 }
 function snapshot(){return {version:1,seed,populations:Object.fromEntries([...populations].map(([id,p])=>[id,p.snapshot()]))};}
 function restore(value){
  if(!value||value.version!==1||value.seed!==seed)return false;
  const states=value.populations??(registry.get('chicken')?{chicken:value}:null);
  if(!states||typeof states!=='object'||Array.isArray(states)||Object.keys(states).some(id=>!registry.get(id)))return false;
  const next=build();for(const [id,state] of Object.entries(states))if(!next.get(id).restore(state))return false;
  populations=next;records.clear();return true;
 }
 function clear(){for(const p of populations.values())p.clear();records.clear();}
 return {registry,tick,damage,spawnTransient(type,x,z,options){const value=populations.get(type)?.spawnTransient(x,z,options);if(value)records.set(value.id,value);return value;},
  clearTransient(){const ids=[...populations.values()].flatMap(p=>p.clearTransient());for(const id of ids)records.delete(id);return ids;},
  hit:(id,source)=>damage(id,1,source),take:(id,...args)=>populationFor(id)?.take(id,...args)??0,snapshot,restore,clear,reset:clear,
  setClipDurations(type,durations){const p=populations.get(type);p?.setClipDurations?.(durations);},
  getRecord:id=>records.get(id)};
}
export function validateMobSnapshot(value,seed=value?.seed,registry=createMobTypeRegistry()){
 return !!value&&createMobWorld({seed,registry}).restore(value);
}
