// Shared targeting/damage contract: callers adapt mobs or players to entities.
// AI intent, input, and network authority remain outside this small policy.
export function entityRelation(source,target){
 if((source&&source===target)||(source?.id!=null&&source.id===target?.id))return 'self';
 if(source?.faction&&source.faction===target?.faction)return 'friendly';
 return 'neutral';
}
export function canDamageEntity(source,target,{relation=entityRelation,friendlyFire=false}={}){
 if(!target||target.alive===false||!Number.isFinite(target.health)||target.health<=0)return false;
 const attitude=relation(source,target);
 return attitude!=='self'&&(friendlyFire||attitude!=='friendly');
}
export function applyEntityDamage(source,target,amount,policy={}){
 if(!Number.isFinite(amount)||amount<=0||typeof target?.receiveDamage!=='function'||!canDamageEntity(source,target,policy))return false;
 return target.receiveDamage(amount,source);
}
