#!/usr/bin/env python3
"""Rebuild the entire morph-free two-body humanoid library with Blender 5.2+.

Usage: python3 characters/humanoid/build_all_lite.py [--jobs 4] [--force]
Creates body_male*.glb/body_female*.glb and every compatible garment/hair GLB.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor,as_completed
import json
import subprocess
from pathlib import Path

HERE=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--jobs',type=int,default=4)
parser.add_argument('--force',action='store_true')
args=parser.parse_args()
OUT=HERE/'lite'
if args.jobs<1 or args.jobs>8:
 parser.error('--jobs must be 1..8 to avoid memory pressure')
garments=json.loads((HERE/'source/clothing.json').read_text())['items']
hair=json.loads((HERE/'source/hair.json').read_text())['styles']
files=sorted({x['file'] for x in garments+hair})
body_jobs=[]
gear_jobs=[]
for gender in ('male','female'):
 for face in ('default','angular','soft'):
  output=OUT/('body_'+gender+(('' if face=='default' else '_'+face))+'.glb')
  if args.force or not output.exists():
   body_jobs.append((output,['--kind','body','--gender',gender,'--face',face]))
 for file in files:
  output=OUT/(file.removesuffix('.glb')+'_'+gender+'.glb')
  if args.force or not output.exists():
   gear_jobs.append((output,['--kind','gear','--gender',gender,'--asset',file]))
def build(item):
 output,options=item
 command=['blender','-b','--factory-startup','-t','2','--python-exit-code','1',
          '-P',str(HERE/'build_lite.py'),'--',*options]
 result=subprocess.run(command,timeout=90,capture_output=True,text=True)
 report=next((x for x in result.stdout.splitlines() if x.startswith('BUILD_OK ')),None)
 if result.returncode or not report:
  raise RuntimeError(output.name+': '+(result.stdout+' '+result.stderr)[-1200:])
 return report
for phase,jobs in [('body',body_jobs),('equipment',gear_jobs)]:
 # Cloth seam baking reads lite/body_{gender}.glb, so bodies must be
 # fully built first when --force is used; never rebuild them concurrently.
 failed=[]
 with ThreadPoolExecutor(max_workers=args.jobs) as pool:
  for future in as_completed([pool.submit(build,x) for x in jobs]):
   try:print(future.result(),flush=True)
   except Exception as ex:failed.append(str(ex));print('FAILED:',ex,flush=True)
 if failed:
  raise SystemExit(f'{len(failed)} {phase} assets failed')
print('DONE: rebuilt',len(body_jobs)+len(gear_jobs),'assets, 50 expected total')
