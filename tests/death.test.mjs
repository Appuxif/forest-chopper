import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeathSystem,deathDropPosition,DEATH_MARKER_TTL,validDeathMarker} from '../src/death.js';
import {createInventoryModel} from '../src/inventory.js';
import {MAX_GROUND_DROPS} from '../src/ground-boxes.js';

function fixture({online=false,capacity=0}={}){
 let now=1000,nowMs=0;
 const records=new Map(),sent=[],notices=[],saved=[],screenEvents=[],physics=[];
 const screen={
  begin(fn){this.callback=fn;screenEvents.push('begin');},
  show(enabled){screenEvents.push(['show',enabled]);},
  enable(enabled){screenEvents.push(['enable',enabled]);},
  end(){screenEvents.push('end');},
 };
 const inventory=createInventoryModel();
 inventory.addItem({id:'stone',count:8});
 inventory.addItem({id:'mushroom:boletus',count:3});
 const bed={id:-12,kind:'bed',x:40,z:-11};
 const camp=new Map([[-12,bed]]);
 const ctx={
  px:8,pz:9,feetY:0,wood:0,verticalSpeed:0,onGround:true,buildMode:false,
  isOnline:()=>online,sendNet:packet=>sent.push(packet),
  campStructures:{items:camp},
  terrain:{heightAt:()=>1.5},
  inventory:{state:inventory,render(){},close(){}},
  groundBoxes:{
   get count(){return records.size+capacity;},
   get boxes(){return records.values();},
   add(box){if(records.size+capacity>=MAX_GROUND_DROPS)return false;records.set(box.id,{...box});return true;},
   remove:id=>records.delete(id),
  },
  vitals:{health:0,restore(data){this.health=data.health;this.restored=data;return true;}},
  offlineSave:{markDirty(){saved.push('dirty')},save(){saved.push('save')}},
  notify:(...args)=>notices.push(args),disposePreview(){},
  keys:{KeyW:true},ragdoll:{
    active:false,
    async trigger(){this.active=true;physics.push('start');},
    reset(){this.active=false;physics.push('reset');return true;},
  },
 };
 const death=createDeathSystem(ctx,{epoch:()=>now,clock:()=>nowMs,screen});
 ctx.deathSystem=death;
 return {death,ctx,inventory,records,notices,sent,saved,bed,screenEvents,physics,
   set now(t){now=t},set nowMs(t){nowMs=t}};
}

test('death spreads one-hour pickup boxes without dropping or duplicating a stack',()=>{
 const f=fixture();
 assert.equal(f.death.onDeath(),true);
 assert.equal(f.records.size,3,'axe, stone and boletus get separate boxes');
 assert.deepEqual([...f.records.values()].map(b=>b.item.id),['axe','stone','mushroom:boletus']);
 const positions=[...f.records.values()].map(b=>[b.x,b.z]);
 assert.equal(new Set(positions.map(x=>x.join(','))).size,3,'no boxes on one spot');
 assert.deepEqual(positions[0],[8.8,9]);
 assert.ok([...f.records.values()].every(b=>b.expires_at===1000+DEATH_MARKER_TTL));
 assert.equal(f.inventory.slots.filter(Boolean).length,0);
 assert.equal(f.ctx.px,8);assert.equal(f.ctx.pz,9,'no teleport during death fall');
 assert.equal(f.ctx.vitals.health,0);
 assert.equal(f.death.phase,'falling');
 assert.equal(f.death.snapshot().pending,true);
 assert.equal(f.death.respawn(),false,'respawn stays locked for the first five seconds');
 f.death.tick(4999);
 assert.equal(f.death.phase,'falling');
 f.death.tick(5000);
 assert.equal(f.death.phase,'ready');
 assert.deepEqual(f.screenEvents.at(-1),['show',true]);
 assert.equal(f.death.respawn(),true);
 assert.equal(f.ctx.px,0);assert.equal(f.ctx.pz,0);
 assert.equal(f.ctx.vitals.health,5);
 assert.equal(f.ctx.vitals.restored.hunger,3);
 assert.equal(f.death.snapshot().pending,undefined);
 assert.equal(f.death.respawn(),false);
 assert.equal(f.death.marker.expires_at,4600);
 assert.ok(f.saved.includes('save'));
 f.now=4601;
 assert.equal(f.death.marker,null,'the minimap marker expires independently of boxes');
});

test('bed selects and persists a respawn position; dismantling reverts to the world origin',()=>{
 const f=fixture();
 assert.equal(f.death.setBed(-12),true);
 assert.equal(f.death.bedId,-12);
 const state=f.death.snapshot();
 const second=fixture();
 second.death.restore(state);
 assert.equal(second.death.bedId,-12);
 assert.equal(second.death.onDeath(),true);
 assert.equal(second.ctx.px,8);
 second.death.tick(5000);assert.equal(second.death.respawn(),true);
 assert.equal(second.ctx.px,42.5);assert.equal(second.ctx.pz,-11);
 second.death.onStructureRemoved(-12);
 assert.equal(second.death.bedId,null);
 const last=fixture();
 last.death.restore({bedId:-999,marker:null});
 assert.equal(last.death.bedId,null);
});
test('online bed action sends intent; only server acknowledgement sets local spawn',()=>{
 const f=fixture({online:true});
 assert.equal(f.death.setBed(-12),true);
 assert.deepEqual(f.sent,[{type:'bed_spawn',id:-12}]);
 assert.equal(f.death.bedId,null);
 f.death.acceptBed(-12);
 assert.equal(f.death.bedId,-12);
 f.death.receive({x:42.5,z:-11,marker:{x:8,z:9,expires_at:4600}});
 assert.equal(f.death.marker.x,8);
 assert.equal(f.ctx.px,8,'server packet is deferred until the player clicks respawn');
 f.death.tick(5000);
 assert.equal(f.death.phase,'ready');
 assert.equal(f.death.respawn(),true);
 assert.equal(f.ctx.px,42.5);
 f.death.acceptBed(null);
 assert.equal(f.death.bedId,null);
});
test('box cap failure never clears player inventory or respawns',()=>{
 const f=fixture({capacity:MAX_GROUND_DROPS-2});
 assert.equal(f.death.onDeath(),false);
 assert.equal(f.records.size,0);
 assert.equal(f.inventory.slots.filter(Boolean).length,3);
 assert.equal(f.ctx.vitals.health,0);
 assert.equal(f.ctx.px,8);
 const g=fixture();
 const original=g.ctx.groundBoxes.add;
 let calls=0;
 g.ctx.groundBoxes.add=box=>++calls===2?false:original(box);
 assert.equal(g.death.onDeath(),false);
 assert.equal(g.records.size,0,'partial box creation is rolled back');
 assert.equal(g.inventory.slots.filter(Boolean).length,3);
});
test('stale death marker is not displayed; spread is deterministic',()=>{
 const at=deathDropPosition(-14,2,5);
 assert.deepEqual(at,deathDropPosition(-14,2,5));
 assert.notDeepEqual(at,deathDropPosition(-14,2,6));
 assert.equal(validDeathMarker({x:1,z:2,expires_at:4600},1000),true);
 assert.equal(validDeathMarker({x:1,z:2,expires_at:4600},4600),false);
 assert.equal(validDeathMarker({x:1,z:2,expires_at:90000},1000),false);
});


test('offline reload while dead resumes death screen without duplicating drops',()=>{
 const f=fixture();
 f.death.onDeath();
 const saved=f.death.snapshot();
 assert.equal(saved.pending,true);
 const g=fixture();
 g.ctx.vitals.health=0;
 g.death.restore(saved);
 assert.equal(g.death.active,true);
 assert.equal(g.records.size,0);
 assert.equal(g.death.marker.x,8);
 assert.equal(g.death.onDeath(),false);
 g.death.tick(5000);
 assert.equal(g.death.respawn(),true);
 assert.equal(g.ctx.vitals.health,5);
 assert.equal(g.death.active,false);
});

test('server-deferred respawn cannot be used until the authoritative packet arrives',()=>{
 const f=fixture({online:true});
 assert.equal(f.death.onDeath(),true);
 assert.equal(f.records.size,0,'online client must never drop authoritative items');
 f.death.tick(5000);
 assert.equal(f.death.respawn(),false);
 assert.deepEqual(f.screenEvents.at(-1),['show',false]);
 f.death.receive({x:21,z:10,marker:{x:8,z:9,expires_at:4600}});
 assert.deepEqual(f.screenEvents.at(-1),['enable',true]);
 assert.equal(f.death.respawn(),true);
 assert.equal(f.ctx.px,21);assert.equal(f.ctx.pz,10);
 assert.equal(f.death.phase,'alive');
 assert.equal(f.saved.includes('save'),false,'online respawn must not overwrite offline save');
});
