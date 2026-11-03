import test from 'node:test';
import assert from 'node:assert/strict';
import {formatProfilerReport} from '../src/debug-profiler-ui.js';

test('profiler report copy includes FPS, CPU, GPU, batch size and both geometry and shadow tables',()=>{
  const report=formatProfilerReport({
    status:'Кадров: 300',
    fps:'Render FPS 80 · Physics FPS 96\nCPU Frame Time 3.30 ms · GPU Frame Time 8.50 ms',
    regionSize:2,
    geometry:'Декор 40 draws',
    inventory:'Декор 100 instances',
    shadow:'За период: 1000 draws',
    lights:'Солнце ближний каскад',
    notes:['GPU time is asynchronous'],
  });
  for(const value of ['Кадров: 300','Render FPS 80','Physics FPS 96',
    'CPU Frame Time 3.30','GPU Frame Time 8.50',
    '2×2 чанков','Декор 40 draws','Декор 100 instances',
    'За период: 1000 draws','Солнце ближний каскад','GPU time is asynchronous']){
    assert.ok(report.includes(value),value);
  }
});
