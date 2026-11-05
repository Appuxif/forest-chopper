import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const source=html.match(/<script id="audio-core">([\s\S]*?)<\/script>/)[1];
const C=vm.runInNewContext(source+';AudioCutterCore',{TextEncoder});
const pcm=buffer=>Array.from({length:(buffer.byteLength-44)/2},(_,i)=>new DataView(buffer).getInt16(44+i*2,true));

test('millisecond cuts map to exact frames and retain the final source sample',()=>{
 const r=C.range(44100,44100,100,350);assert.equal(r.start,4410);assert.equal(r.end,15435);assert.equal(r.frames,11025);assert.equal(r.durationMs,250);
 const last=C.range(44101,44100,1000,44101/44100*1000);assert.equal(last.frames,1);assert.equal(last.end,44101);
});
test('invalid, reversed, out-of-file or sub-sample ranges cannot export',()=>{
 for(const [a,b] of [[-1,2],[2,1],[1,1],[0,1001],[NaN,1],[0,Infinity],[.001,.002]])assert.throws(()=>C.range(44100,44100,a,b));
});
test('mono WAV has valid PCM header and contains only the requested samples',()=>{
 const data=C.wav([new Float32Array([-1,-.5,0,.5,1])],1000,1,4),v=new DataView(data);
 assert.equal(Buffer.from(data).subarray(0,4).toString(),'RIFF');assert.equal(Buffer.from(data).subarray(8,12).toString(),'WAVE');
 assert.equal(v.getUint16(20,true),1);assert.equal(v.getUint16(22,true),1);assert.equal(v.getUint32(24,true),1000);assert.equal(v.getUint16(34,true),16);
 assert.equal(v.getUint32(4,true),data.byteLength-8);assert.equal(v.getUint32(40,true),6);assert.deepEqual(pcm(data),[-16384,0,16384]);
});
test('stereo export interleaves channels without downmixing',()=>{
 const data=C.wav([new Float32Array([1,-1]),new Float32Array([.25,-.25])],1000,0,2),v=new DataView(data);
 assert.equal(v.getUint16(22,true),2);assert.equal(v.getUint16(32,true),4);assert.equal(v.getUint32(28,true),4000);
 assert.deepEqual(pcm(data),[32767,8192,-32768,-8192]);
});
test('edge fade preserves the middle level and never changes the decoded source',()=>{
 const values=new Float32Array(8).fill(1),data=C.wav([values],1000,0,8,3);
 assert.deepEqual(pcm(data),[0,16384,32767,32767,32767,32767,16384,0]);assert.ok(values.every(v=>v===1));
 assert.deepEqual(pcm(C.wav([values],1000,0,8,0)),Array(8).fill(32767));
});
test('WAV export clips extremes and validates channel shape and fade',()=>{
 assert.deepEqual(pcm(C.wav([new Float32Array([-2,2,NaN])],1000,0,3)),[-32768,32767,0]);
 assert.throws(()=>C.wav([new Float32Array(3),new Float32Array(2)],1000,0,2));
 assert.throws(()=>C.wav([new Float32Array(3)],1000,0,2,-1));
});
test('waveform buckets preserve peaks in every channel',()=>{
 const p=C.peaks([new Float32Array([-.8,-.4,.2,.9]),new Float32Array([.7,0,-1,0])],2);
 assert.ok(Math.abs(p[0].min+.8)<1e-6);assert.ok(Math.abs(p[0].max-.7)<1e-6);assert.equal(p[1].min,-1);assert.ok(Math.abs(p[1].max-.9)<1e-6);
});
test('download names stay local, readable and valid on common platforms',()=>{
 assert.equal(C.filename('кура.mp3'),'кура');assert.equal(C.filename('CON'),'_CON');assert.equal(C.filename('...'),'fragment');
 assert.doesNotMatch(C.filename('../chicken:take/one?.wav'),/[<>:"/\\|?*]/);
});
test('ZIP CRC matches the standard check vector',()=>{
 assert.equal(C.crc32(new TextEncoder().encode('123456789')),0xcbf43926);
});
test('Python zipfile and wave can read every exported WAV in the batch ZIP',()=>{
 const temp=mkdtempSync(join(tmpdir(),'forest-audio-cutter-'));
 try{
  const a=C.wav([new Float32Array([0,.5,1,-.5])],1000,1,4),b=C.wav([new Float32Array([-.5,0,.5])],1000,0,3);
  const zip=C.zip([{name:'01_крик.wav',data:a},{name:'02_cluck.wav',data:b}]);writeFileSync(join(temp,'cuts.zip'),Buffer.from(zip));
  const run=spawnSync('python3',['-c',`import io,sys,wave,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert z.namelist()==['01_крик.wav','02_cluck.wav']
 for name in z.namelist():
  with wave.open(io.BytesIO(z.read(name))) as w:
   assert w.getnchannels()==1 and w.getsampwidth()==2 and w.getframerate()==1000 and w.getnframes()==3
`,join(temp,'cuts.zip')],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
