#!/usr/bin/env python3
"""Generate the manual item-drop sound by time-reversing the pickup sound.

Run from the project root: python3 scripts/prepare_drop_sound.py
Requires FFmpeg. The pickup effect is derived from Cozy Farm SFX's
scythe-swish.wav, CC BY 4.0; see assets/audio/ATTRIBUTION.md.
"""
from pathlib import Path
import subprocess

base=Path(__file__).resolve().parents[1]/'assets'/'audio'/'inventory'
pickup=base/'pickup.mp3'
if not pickup.is_file():raise FileNotFoundError(pickup)
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',
 '-i',str(pickup),'-af','areverse','-ar','24000','-ac','1',
 '-codec:a','libmp3lame','-b:a','56k',str(base/'drop.mp3')],check=True)
