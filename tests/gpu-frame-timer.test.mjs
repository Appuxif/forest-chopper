import test from 'node:test';
import assert from 'node:assert/strict';
import {createGpuFrameTimer} from '../src/gpu-frame-timer.js';

function webgl2(){
  let next=0,disjoint=false,available=false,nanoseconds=7_250_000;
  const events=[],ext={TIME_ELAPSED_EXT:35007,GPU_DISJOINT_EXT:36795};
  const gl={
    QUERY_RESULT_AVAILABLE:34919,QUERY_RESULT:34918,
    getExtension:name=>name==='EXT_disjoint_timer_query_webgl2'?ext:null,
    getParameter:name=>name===ext.GPU_DISJOINT_EXT?disjoint:null,
    createQuery:()=>({id:++next}),
    beginQuery:(target,q)=>events.push(['begin',target,q.id]),
    endQuery:target=>events.push(['end',target]),
    getQueryParameter:(q,parameter)=>{
      events.push(['poll',parameter,q.id]);
      return parameter===gl.QUERY_RESULT_AVAILABLE?available:nanoseconds;
    },
    deleteQuery:q=>events.push(['delete',q.id]),
  };
  return {gl,events,setAvailable:value=>available=value,
    setDisjoint:value=>disjoint=value,
    setNanoseconds:value=>nanoseconds=value};
}

test('WebGL2 timer measures GPU elapsed time without blocking on unavailable results',()=>{
  const fake=webgl2(),timer=createGpuFrameTimer({getContext:()=>fake.gl});
  assert.equal(timer.supported,null,'WebGL extension is loaded only on demand');
  assert.equal(timer.begin(1000),true);
  assert.equal(timer.begin(1001),false,'only one active GPU query');
  timer.end();
  assert.deepEqual(fake.events.slice(0,2),[['begin',35007,1],['end',35007]]);
  assert.equal(timer.begin(1200),false,'pending queries cannot be overwritten');
  assert.equal(timer.poll(1005),null,'unready query is not read');
  assert.deepEqual(fake.events.filter(e=>e[1]===fake.gl.QUERY_RESULT),[]);
  assert.equal(timer.poll(1020),null,'polling is throttled');
  fake.setAvailable(true);
  assert.deepEqual(timer.poll(1060),{status:'ready',ms:7.25});
  assert.deepEqual(fake.events.filter(e=>e[0]==='delete'),[['delete',1]]);
  assert.equal(timer.begin(1249),false,'GPU sampling is rate limited');
  assert.equal(timer.begin(1250),true);
  timer.end();
  timer.reset();
  assert.deepEqual(fake.events.filter(e=>e[0]==='delete'),[['delete',1],['delete',2]]);
  assert.equal(timer.begin(1250),true,'reset frees the outstanding slot');
  timer.end();
});

test('WebGL2 timer discards disjoint and invalid results',()=>{
  const fake=webgl2(),timer=createGpuFrameTimer({getContext:()=>fake.gl});
  timer.begin(0);timer.end();
  fake.setDisjoint(true);
  assert.deepEqual(timer.poll(50),{status:'invalid'});
  assert.equal(timer.begin(300),true,'a disjoint sample does not block later queries');
  timer.end();
  fake.setDisjoint(false);
  fake.setAvailable(true);
  fake.setNanoseconds(-1);
  assert.deepEqual(timer.poll(350),{status:'invalid'},'negative samples are not shown');
});

test('WebGL1 EXT_disjoint_timer_query uses extension-specific operations',()=>{
  const events=[],ext={
    TIME_ELAPSED_EXT:35007,GPU_DISJOINT_EXT:36795,
    QUERY_RESULT_AVAILABLE_EXT:34919,QUERY_RESULT_EXT:34918,
    createQueryEXT:()=>({id:42}),
    beginQueryEXT:(target,q)=>events.push(['begin',target,q.id]),
    endQueryEXT:target=>events.push(['end',target]),
    getQueryObjectEXT:(q,property)=>property===34919?true:6_900_000,
    deleteQueryEXT:q=>events.push(['delete',q.id]),
  };
  const gl={
    getExtension:name=>name==='EXT_disjoint_timer_query'?ext:null,
    getParameter:()=>false,
  };
  const timer=createGpuFrameTimer({getContext:()=>gl});
  assert.equal(timer.begin(100),true);
  timer.end();
  assert.deepEqual(timer.poll(200),{status:'ready',ms:6.9});
  assert.deepEqual(events,[['begin',35007,42],['end',35007],['delete',42]]);
});

test('unsupported and lost contexts do not throw or fabricate GPU timings',()=>{
  const none=createGpuFrameTimer({getContext:()=>({getExtension:()=>null})});
  assert.equal(none.begin(0),false);
  assert.equal(none.supported,false);
  assert.equal(none.poll(100),null);
  none.reset();
  const lost=createGpuFrameTimer({getContext:()=>({isContextLost:()=>true})});
  assert.equal(lost.begin(0),false);
  assert.equal(lost.supported,false);
  const broken=createGpuFrameTimer({getContext(){throw Error('lost')}});
  assert.equal(broken.begin(0),false);
  assert.equal(broken.supported,false);
});

test('reset ends and discards an active GPU query safely',()=>{
  const fake=webgl2(),timer=createGpuFrameTimer({getContext:()=>fake.gl});
  assert.equal(timer.begin(0),true);
  timer.reset();
  assert.deepEqual(fake.events.slice(-2),[['end',35007],['delete',1]]);
  assert.equal(timer.begin(10),true);
  timer.end();
});
