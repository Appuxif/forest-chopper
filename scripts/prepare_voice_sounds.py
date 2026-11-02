#!/usr/bin/env python3
"""Rebuild reviewed Forest Chopper voices from downloaded OpenGameArt originals.

Usage:
  python3 scripts/prepare_voice_sounds.py \
    --source-dir /path/to/downloads/with/4/original/files

Required: male-pain-sounds.zip, male-death-sounds.zip,
FEMALE_Gruntwork_1.mp3, 1_dying.ogg, JumpSoundsMan.zip. Requires ffmpeg and ffprobe.

Only user-approved female takes are retained. Their original numbers are
preserved for identification: hurt 3/4/5/20, jump 24–28. The script removes
previously rejected female clips so they cannot return on regeneration.
"""
from __future__ import annotations
import argparse
import json
import re
import subprocess
import zipfile
from pathlib import Path

FEMALE_SOURCE = 'FEMALE_Gruntwork_1.mp3'
FEMALE_HURT = (3,4,5,20)
FEMALE_JUMP = (24,25,26,27,28)
ORIGINALS = {
    'male_hurt': 'male-pain-sounds.zip',
    'female_hurt': FEMALE_SOURCE,
    'male_death': 'male-death-sounds.zip',
    'female_death': '1_dying.ogg',
    'male_jump': 'JumpSoundsMan.zip',
}
URLS = {
    'male_hurt': 'https://opengameart.org/content/7-male-pain-voices',
    'female_hurt': 'https://opengameart.org/content/female-gruntwork-1',
    'male_death': 'https://opengameart.org/content/2-male-death-voices',
    'female_death': 'https://opengameart.org/content/deathdying-female-fighterwarrior-voice-over-vocal-sound-for-character',
    'male_jump': 'https://opengameart.org/content/jumping-man-sounds',
}


def ffmpeg(*args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *map(str,args)],check=True)


def duration(file):
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
        'format=duration','-of','default=nw=1:nk=1',str(file)],
        check=True,capture_output=True,text=True)
    return float(result.stdout)


def transcode(source, out, start, end):
    padding = 0.035
    start=max(0,start-padding)
    end=min(duration(source),end+padding)
    length=round(end-start,4)
    fade=min(.025,length/5)
    ffmpeg('-ss',round(start,4),'-i',source,'-t',length,
        '-af',f'afade=t=in:st=0:d={fade:.3f},afade=t=out:st={max(0,length-fade):.4f}:d={fade:.3f}',
        '-ar',24000,'-ac',1,'-codec:a','libmp3lame','-b:a','56k',out)
    return {'start':round(start,3),'end':round(end,3),'duration':round(length,3)}


def voice_bounds(src):
    result=subprocess.run(['ffmpeg','-hide_banner','-nostats','-i',str(src),
       '-af','silencedetect=noise=-32dB:d=0.12','-f','null','-'],
       stderr=subprocess.PIPE,text=True,check=True)
    silence_starts=[float(x) for x in re.findall(r'silence_start: ([\d.]+)',result.stderr)]
    silence_ends=[float(x) for x in re.findall(r'silence_end: ([\d.]+)',result.stderr)]
    assert len(silence_starts)==len(silence_ends)
    intervals=[(0.0,silence_starts[0])] if silence_starts[0]>.07 else []
    intervals += [(silence_ends[i],silence_starts[i+1]) for i in range(len(silence_starts)-1)]
    if duration(src)-silence_ends[-1]>.07:intervals.append((silence_ends[-1],duration(src)))
    # Short silencedetect glitches (<80ms) are merged with their next utterance.
    kept=[]
    for a,b in intervals:
        if b-a<.08:
            if kept:kept[-1]=(kept[-1][0],b)
            else:continue
        else:kept.append((a,b))
    return kept


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-dir',type=Path,required=True)
    p.add_argument('--output-dir',type=Path,default=Path(__file__).resolve().parents[1]/'assets/audio',
                   help='Audio asset root (outputs in voices/ and metadata/)')
    args=p.parse_args()
    args.output_dir.mkdir(parents=True,exist_ok=True)
    (args.output_dir/'metadata').mkdir(parents=True,exist_ok=True)
    sources={k:args.source_dir/name for k,name in ORIGINALS.items()}
    for file in sources.values():
        if not file.is_file():raise FileNotFoundError(file)
    manifest={'method':'ffmpeg silencedetect -32dB / 0.12s; 35ms padding; 25ms fades',
       'source_pages':URLS,'clips':{'hurt_male':[],'hurt_female':[],
                                'death_male':[],'death_female':[], 'jump_female':[], 'jump_male':[]}}
    with zipfile.ZipFile(sources['male_hurt']) as archive:
        files=sorted((n for n in archive.namelist() if n.lower().endswith('.wav')),key=lambda x:int(Path(x).stem))
        for i,name in enumerate(files,1):
            with archive.open(name) as r:
                temp=args.output_dir/f'.voice_source_male_{i}.wav'
                temp.write_bytes(r.read())
            try:
                sound=f'voices/male/hurt/hurt_male_{i}.mp3'
                (args.output_dir/'voices/male/hurt').mkdir(parents=True,exist_ok=True)
                bounds=transcode(temp,args.output_dir/sound,0,duration(temp))
                manifest['clips']['hurt_male'].append({'file':sound,'original':name,**bounds})
            finally:temp.unlink(missing_ok=True)
    female_bounds=voice_bounds(sources['female_hurt'])
    assert len(female_bounds)>=max(FEMALE_JUMP), 'Female sound track unexpectedly changed'
    # Remove rejected samples from previous generations before writing selections.
    for folder,pattern in (('voices/female/hurt','hurt_female_*.mp3'),
                           ('voices/female/jump','jump_female_*.mp3')):
        out_dir=args.output_dir/folder
        out_dir.mkdir(parents=True,exist_ok=True)
        for old in out_dir.glob(pattern):old.unlink()
    for kind,ids in (('hurt',FEMALE_HURT),('jump',FEMALE_JUMP)):
        for i in ids:
            a,b=female_bounds[i-1]
            sound=f'voices/female/{kind}/{kind}_female_{i}.mp3'
            bounds=transcode(sources['female_hurt'],args.output_dir/sound,a,b)
            manifest['clips'][f'{kind}_female'].append({
                'file':sound,'original':FEMALE_SOURCE,'source_take':i,**bounds})
    with zipfile.ZipFile(sources['male_jump']) as archive:
        files=sorted((n for n in archive.namelist() if n.lower().endswith('.ogg')))
        assert len(files)==2, 'Expected both male jump sounds'
        (args.output_dir/'voices/male/jump').mkdir(parents=True,exist_ok=True)
        for old in (args.output_dir/'voices/male/jump').glob('jump_male_*.mp3'):old.unlink()
        for i,name in enumerate(files,1):
            temp=args.output_dir/f'.voice_source_jump_{i}.ogg'
            with archive.open(name) as r:temp.write_bytes(r.read())
            try:
                sound=f'voices/male/jump/jump_male_{i}.mp3'
                bounds=transcode(temp,args.output_dir/sound,0,duration(temp))
                manifest['clips']['jump_male'].append({'file':sound,'original':name,**bounds})
            finally:temp.unlink(missing_ok=True)
    with zipfile.ZipFile(sources['male_death']) as archive:
        first='15.wav' # First of two original sounds; leave 16.wav unused.
        temp=args.output_dir/'.voice_source_death_male.wav'
        with archive.open(first) as r:temp.write_bytes(r.read())
        try:
            sound='voices/male/death/death_male_1.mp3'
            (args.output_dir/'voices/male/death').mkdir(parents=True,exist_ok=True)
            bounds=transcode(temp,args.output_dir/sound,0,duration(temp))
            manifest['clips']['death_male'].append({'file':sound,'original':first,**bounds})
        finally:temp.unlink(missing_ok=True)
    sound='voices/female/death/death_female_1.mp3'
    (args.output_dir/'voices/female/death').mkdir(parents=True,exist_ok=True)
    bounds=transcode(sources['female_death'],args.output_dir/sound,.395,2.35)
    manifest['clips']['death_female'].append({'file':sound,'original':'1_dying.ogg',**bounds})
    (args.output_dir/'metadata/VOICE_CUTS.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print('voice clip counts:',{key:len(value) for key,value in manifest['clips'].items()})

if __name__=='__main__':main()
