// Spatial hash for pickup candidates and a lazy, expiry-ordered min heap.
// Each fallen-log segment is indexed independently, preserving its original
// segment number when other segments are collected.
import {fallenLogSegments} from './fallen-log-layout.js';

export const BOX_CELL_SIZE=24;
const key=(x,z)=>Math.floor(x/BOX_CELL_SIZE)+','+Math.floor(z/BOX_CELL_SIZE);
export class GroundBoxIndex {
  constructor(){this.cells=new Map();this.members=new Map();this.queue=[];this.versions=new Map();}
  _swap(i,j){const q=this.queue;[q[i],q[j]]=[q[j],q[i]];}
  _push(entry){
    const q=this.queue;q.push(entry);let i=q.length-1;
    while(i){const p=(i-1)>>1;if(q[p][0]<=entry[0])break;this._swap(i,p);i=p;}
  }
  _pop(){
    const q=this.queue,head=q[0],last=q.pop();
    if(q.length){q[0]=last;let i=0;while(true){
      const l=i*2+1,r=l+1;if(l>=q.length)break;
      const j=r<q.length&&q[r][0]<q[l][0]?r:l;
      if(q[i][0]<=q[j][0])break;this._swap(i,j);i=j;
    }}
    return head;
  }
  remove(id){
    for(const cell of this.members.get(id)??[]){
      const bucket=this.cells.get(cell);
      bucket?.delete(id);if(bucket?.size===0)this.cells.delete(cell);
    }
    this.members.delete(id);
    this.versions.delete(id);
  }
  set(box){
    this.remove(box.id);
    const nodes=box.kind==='fallen_logs'
      ?fallenLogSegments(box).map(s=>({...s,id:box.id,segment:s.index,item:box.item,kind:box.kind,expires_at:box.expires_at}))
      :[box];
    const used=new Set();
    for(const node of nodes){
      const cell=key(node.x,node.z);
      if(!this.cells.has(cell))this.cells.set(cell,new Map());
      if(!this.cells.get(cell).has(box.id))this.cells.get(cell).set(box.id,[]);
      this.cells.get(cell).get(box.id).push(node);
      used.add(cell);
    }
    this.members.set(box.id,used);
    const version=(this._nextVersion=(this._nextVersion??0)+1);
    this.versions.set(box.id,version);
    this._push([box.expires_at,box.id,version]);
    // Rebuild occasionally when repeated partial log pickups produce stale heap entries.
    if(this.queue.length>Math.max(128,this.versions.size*4))this.rebuild();
  }
  rebuild(){
    this.queue=[];const seen=new Set();
    for(const bucket of this.cells.values())for(const nodes of bucket.values()){
      const box=nodes[0],version=this.versions.get(box.id);
      if(version&&!seen.has(box.id))
        {this._push([box.expires_at,box.id,version]);seen.add(box.id);}
    }
  }
  *near(x,z,radius){
    const minX=Math.floor((x-radius)/BOX_CELL_SIZE),maxX=Math.floor((x+radius)/BOX_CELL_SIZE);
    const minZ=Math.floor((z-radius)/BOX_CELL_SIZE),maxZ=Math.floor((z+radius)/BOX_CELL_SIZE);
    for(let cx=minX;cx<=maxX;cx++)for(let cz=minZ;cz<=maxZ;cz++){
      const bucket=this.cells.get(cx+','+cz);
      if(!bucket)continue;
      for(const nodes of bucket.values())for(const node of nodes)
        if(Math.abs(node.x-x)<=radius&&Math.abs(node.z-z)<=radius)yield node;
    }
  }
  expired(now){
    const ids=[];
    while(this.queue.length&&this.queue[0][0]<=now){
      const [expiry,id,version]=this._pop();
      if(this.versions.get(id)===version){this.versions.delete(id);ids.push(id);}
    }
    return ids;
  }
  clear(){this.cells.clear();this.members.clear();this.queue.length=0;this.versions.clear();}
}
