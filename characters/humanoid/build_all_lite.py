#!/usr/bin/env python3
"""Rebuild TWO unified gender GLBs with all workbench Actions and common gear.

Usage: python3 characters/humanoid/build_all_lite.py [--jobs 4] [--force]
The six intermediate lite/body*.glb files are deleted after successful packing;
only game/body_male.glb and game/body_female.glb are distributed as bodies.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor,as_completed
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--jobs',type=int,default=4)
parser.add_argument('--force',action='store_true')
parser.add_argument('--bodies-only',action='store_true',
                    help='Rebuild only the 2 gender body GLBs from the workbench')
args=parser.parse_args()
OUT=HERE/'lite'
if args.jobs<1 or args.jobs>8:
 parser.error('--jobs must be 1..8 to avoid memory pressure')
garments=json.loads((HERE/'source/clothing.json').read_text())['items']
hair=json.loads((HERE/'source/hair.json').read_text())['styles']
files=sorted({x['file'] for x in garments+hair})
body_jobs=[]
gear_jobs=[]
body_intermediates=[OUT/('body_'+gender+(('' if face=='default' else '_'+face))+'.glb')
                    for gender in ('male','female') for face in ('default','angular','soft')]
rebuild_bodies=args.force or args.bodies_only or any(not (HERE/'game'/f'body_{g}.glb').exists() for g in ('male','female'))
if rebuild_bodies:
 for gender in ('male','female'):
  for face in ('default','angular','soft'):
   output=OUT/('body_'+gender+(('' if face=='default' else '_'+face))+'.glb')
   body_jobs.append((output,['--kind','body','--gender',gender,'--face',face]))
for gender in ('male','female'):
 for file in files:
  output=OUT/(file.removesuffix('.glb')+'_'+gender+'.glb')
  if not args.bodies_only and (args.force or not output.exists()):
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
def pack_unified_bodies():
 with tempfile.TemporaryDirectory(prefix='fc-character-bank-') as directory:
  bank=Path(directory)/'workbench-animations.glb'
  commands=[
   ['blender','-b',str(HERE/'animation/humanoid_animation_workbench.blend'),
    '--python-exit-code','1','--python',str(HERE/'animation/export_animation_bank.py'),
    '--',str(bank)],
   [sys.executable,str(HERE/'build_game_bodies.py'),
    '--animations',str(bank),'--body-dir',str(OUT)],
  ]
  for cmd in commands:
   result=subprocess.run(cmd,capture_output=True,text=True,timeout=150)
   if result.returncode:
    raise RuntimeError('Unified body build failed:\n'+(result.stdout+result.stderr)[-3000:])
   print(result.stdout[-500:].strip(),flush=True)

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
 if phase=='body' and rebuild_bodies:
  pack_unified_bodies()
  # Only after BOTH gender outputs validate: do not leave stale body variants.
  for temporary in body_intermediates:temporary.unlink(missing_ok=True)
print('DONE: rebuilt',len(body_jobs)+len(gear_jobs),'intermediate/body/gear tasks;',
      '2 distributed gender body GLBs + shared clothing/hair assets')
