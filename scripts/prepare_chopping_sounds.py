#!/usr/bin/env python3
"""Rebuild user-selected tree fall and individual axe hits from choppingtree.ogg.

Usage: python3 scripts/prepare_chopping_sounds.py [--source /path/to/choppingtree.ogg]
Source: https://opengameart.org/content/chopping-tree (kurt, CC BY 3.0)

The actual impact transients in the 16–25 s region begin at ~18.12 s, not
16.3 s. Cuts include ~55 ms before the strike and its natural short decay;
the long quiet gaps between strikes are excluded. Peaks are normalized to
-8 dBFS before MP3 encoding, keeping impact levels consistent.
"""
from pathlib import Path
import argparse
import json
import re
import subprocess
import urllib.request

URL='https://opengameart.org/sites/default/files/choppingtree.ogg'
# New approved fall sound: remove the first second of the old 9–15s cut,
# then speed the remaining 10–15s sample up by 30% without changing pitch.
TREE_FALL_START=10
TREE_FALL_END=15
TREE_FALL_SPEED=1.3
TREE_FALL_DURATION=(TREE_FALL_END-TREE_FALL_START)/TREE_FALL_SPEED
# Verified with 10ms PCM RMS bins, not with silence-only guessing.
# (start, end, actual impact peak) seconds in the original recording.
HITS=(
    (18.055,18.535,18.120),
    (19.115,19.555,19.180),
    (20.055,20.515,20.130),
    (21.025,21.465,21.090),
    (21.975,22.405,22.050),
    (22.975,23.415,23.060),
    (23.925,24.365,23.990),
)


def export(source,output,start,end,normalize=False,speed=1):
    length=(end-start)/speed
    fade_in=0.015 if normalize else 0.035
    fade_out=0.13 if normalize else 0.035
    filters=[]
    if speed != 1:
        filters.append(f'atempo={speed:.4f}')
    if normalize:
        probe=subprocess.run(['ffmpeg','-hide_banner','-nostats',
            '-ss',str(start),'-i',str(source),'-t',str(length),
            '-af','volumedetect','-f','null','-'],capture_output=True,text=True,check=True)
        m=re.search(r'max_volume:\s*([-\d.]+) dB',probe.stderr)
        if not m:raise ValueError('Cannot determine peak volume of '+str(output))
        adjustment=max(-12,min(12,-8-float(m.group(1))))
        filters.append(f'volume={adjustment:.2f}dB')
    filters.extend((
      f'afade=t=in:st=0:d={fade_in:.3f}',
      f'afade=t=out:st={length-fade_out:.3f}:d={fade_out:.3f}',
    ))
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',
      '-ss',str(start),'-t',str(end-start),'-i',str(source),
      '-af',','.join(filters),'-ar','24000','-ac','1',
      '-b:a','56k','-codec:a','libmp3lame',str(output)],check=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=None)
    parser.add_argument('--output-dir',type=Path,default=Path(__file__).resolve().parents[1]/'assets/audio',
                        help='Audio asset root (outputs in chopping/ and metadata/)')
    args=parser.parse_args()
    chopping_dir=args.output_dir/'chopping'
    metadata_dir=args.output_dir/'metadata'
    chopping_dir.mkdir(parents=True,exist_ok=True)
    metadata_dir.mkdir(parents=True,exist_ok=True)
    source=args.source
    if source is None:
        source=Path('/tmp/forest-choppingtree-original.ogg')
        if not source.exists():urllib.request.urlretrieve(URL,source)
    export(source,chopping_dir/'tree_fall.mp3',TREE_FALL_START,TREE_FALL_END,speed=TREE_FALL_SPEED)
    for i,(start,end,peak) in enumerate(HITS,1):
        export(source,chopping_dir/f'axe_chop_{i}.mp3',start,end,normalize=True)
    # Clean up stale takes: changing the number of cuts must not leave dead assets.
    active={f'axe_chop_{i}.mp3' for i in range(1,len(HITS)+1)}
    for old in chopping_dir.glob('axe_chop_*.mp3'):
        if old.name not in active:old.unlink()
    manifest={
      'source':URL,
      'license':'CC BY 3.0',
      'author':'kurt',
      'cut_method':'10ms RMS transient onset; 55–85ms lead; full short impact tail; 15ms attack and 130ms release; peaks normalized to -8dBFS',
      'cuts':{
        'chopping/tree_fall.mp3':{'start':TREE_FALL_START,'end':TREE_FALL_END,
                                  'speed':TREE_FALL_SPEED,
                                  'playback_duration':round(TREE_FALL_DURATION,6)},
        **{f'chopping/axe_chop_{i}.mp3':{'start':start,'end':end,'peak':peak}
           for i,(start,end,peak) in enumerate(HITS,1)},
      },
    }
    (metadata_dir/'CHOP_CUTS.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'tree_fall.mp3: {TREE_FALL_START}–{TREE_FALL_END}s at x{TREE_FALL_SPEED} ({TREE_FALL_DURATION:.3f}s); axe_chop_1–{len(HITS)}.mp3: '+
          'actual impact transients within 18.12–24.37 s')

if __name__=='__main__':main()
