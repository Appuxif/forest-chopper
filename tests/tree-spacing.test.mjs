import test from 'node:test';
import assert from 'node:assert/strict';
import {TREE_MIN_DISTANCE,TREES_PER_CHUNK,treeCandidate,treeCanSpawn} from '../src/tree-spacing.js';

function randomFor(seed){
  return (x,z,n=0)=>{
    const value=Math.sin(x*127.1+z*311.7+n*78.233+seed)*43758.5453;
    return value-Math.floor(value);
  };
}
function generate(seed,reverse=false){
  const rand=randomFor(seed),points=[];
  const cxValues=Array.from({length:13},(_,i)=>i-6);
  const czValues=Array.from({length:13},(_,i)=>i-6);
  if(reverse){cxValues.reverse();czValues.reverse();}
  for(const cx of cxValues)for(const cz of czValues){
    const indices=Array.from({length:TREES_PER_CHUNK},(_,i)=>i);
    if(reverse)indices.reverse();
    for(const i of indices){
      if(!treeCanSpawn(cx,cz,i,rand))continue;
      const pos=treeCandidate(cx,cz,i,rand);
      points.push({id:`${cx},${cz}:${i}`,...pos,cx,cz});
    }
  }
  return points;
}

test('at least 4m between all accepted trunks across negative and positive chunk boundaries',()=>{
  assert.equal(TREE_MIN_DISTANCE,4);
  let checked=0,boundaryPairs=0;
  for(const seed of [1,321,3428,780001]){
    const points=generate(seed);
    for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
      const a=points[i],b=points[j];
      const squared=(a.x-b.x)**2+(a.z-b.z)**2;
      assert.ok(squared>=TREE_MIN_DISTANCE**2-1e-8,
        `seed ${seed}: ${a.id} and ${b.id} only ${Math.sqrt(squared)}m apart`);
      if(a.cx!==b.cx||a.cz!==b.cz)boundaryPairs++;
      checked++;
    }
  }
  assert.ok(checked>200_000);
  assert.ok(boundaryPairs>0);
});

test('thinning is deterministic, independent of chunk load order, and keeps original candidates',()=>{
  const points=generate(3428);
  const reversed=generate(3428,true);
  assert.deepEqual(points.map(p=>p.id).sort(),reversed.map(p=>p.id).sort());
  const rand=randomFor(3428);
  assert.ok(points.length>500);
  for(const {cx,cz,id,x,z} of points){
    const i=Number(id.slice(id.lastIndexOf(':')+1));
    assert.deepEqual(treeCandidate(cx,cz,i,rand),{x,z});
    assert.ok(treeCanSpawn(cx,cz,i,rand));
  }
});

test('a real close pair crossing adjacent chunk boundary is deterministically thinned',()=>{
  let pair=null;
  for(const seed of [321,3428,78123,910123]){
    const rand=randomFor(seed);
    for(let cx=-3;cx<=3 && !pair;cx++)for(let cz=-3;cz<=3 && !pair;cz++)
      for(let i=0;i<TREES_PER_CHUNK && !pair;i++){
        const a=treeCandidate(cx,cz,i,rand);
        if(!a)continue;
        for(const [nx,nz] of [[cx+1,cz],[cx,cz+1]]){
          for(let j=0;j<TREES_PER_CHUNK;j++){
            const b=treeCandidate(nx,nz,j,rand);
            if(!b)continue;
            if((a.x-b.x)**2+(a.z-b.z)**2<TREE_MIN_DISTANCE**2){
              pair={seed,a:{cx,cz,i},b:{cx:nx,cz:nz,i:j}};
              break;
            }
          }
          if(pair)break;
        }
      }
    if(pair)break;
  }
  assert.ok(pair,'test must actually cover a too-close pair on a chunk boundary');
  const rand=randomFor(pair.seed);
  assert.ok(!treeCanSpawn(pair.a.cx,pair.a.cz,pair.a.i,rand)
    ||!treeCanSpawn(pair.b.cx,pair.b.cz,pair.b.i,rand),
    'at least one of the two colliding trees must be removed');
});
