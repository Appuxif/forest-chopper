"""Normalize authored Lumberjack animation durations to the male/female game bank.

This acts on the EXISTING Blender workbench and preserves manual poses.
It never regenerates characters, meshes, materials or other Actions.

The standard is the actual runtime body_male/body_female GLB durations.
A custom-authored action is retimed by scaling all of its keyframe X and
Bezier handle X coordinates around the first frame. Channel values,
keyframe interpolation, bone poses and existing Root-motion distances
are unchanged. This deliberately does NOT quantize the male/female
fractional keyframes, which are part of their existing authored actions.

Run:
  blender -b characters/humanoid/animation/humanoid_animation_workbench.blend \
    --python-exit-code 1 \
    --python characters/humanoid/animation/normalize_lumberjack_clip_timing.py
"""
import bpy
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKBENCH = ROOT / 'characters/humanoid/animation/humanoid_animation_workbench.blend'
MOTIONS = ('idle_breathe', 'idle_fidget', 'idle_look', 'jump', 'fall', 'land')
RUNTIME = ROOT / 'characters/humanoid/game'


def game_durations(gender):
    glb = (RUNTIME / ('body_' + gender + '.glb')).read_bytes()
    assert glb[:4] == b'glTF'
    size = struct.unpack_from('<I', glb, 12)[0]
    gltf = json.loads(glb[20:20 + size])
    result = {}
    for action in gltf['animations']:
        inputs = [gltf['accessors'][s['input']] for s in action['samplers']]
        result[action['name']] = (
            max(a['max'][0] for a in inputs) -
            min(a['min'][0] for a in inputs)
        )
    return result


def all_curves(action):
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


def normalize(name, target_seconds):
    action = bpy.data.actions['lumberjack__' + name]
    initial_start, initial_end = action.frame_range
    initial_duration = initial_end - initial_start
    fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    target_frames = target_seconds * fps
    assert initial_duration > 0 and target_frames > 0
    if abs(initial_duration - target_frames) < 1e-3:
        print('CLIP_DURATION_ALREADY_MATCHED', name, target_seconds, flush=True)
        return
    scale = target_frames / initial_duration
    assert .1 <= scale <= 7, (name,scale)
    count = 0
    for curve in all_curves(action):
        for key in curve.keyframe_points:
            key.co.x = initial_start + (key.co.x - initial_start) * scale
            key.handle_left.x = initial_start + (key.handle_left.x - initial_start) * scale
            key.handle_right.x = initial_start + (key.handle_right.x - initial_start) * scale
            count += 1
        curve.update()
    start,end = action.frame_range
    assert abs(start - initial_start) < 1e-4 and abs((end - start)-target_frames)<1e-3
    action['fc_duration_normalized_to'] = 'body_male.glb'
    print('CLIP_DURATION_NORMALIZED',name,'from_seconds',round(initial_duration/fps,5),
          'to_seconds',round((end-start)/fps,5),'keys',count,flush=True)


def main():
    assert Path(bpy.data.filepath).resolve() == WORKBENCH
    male=game_durations('male')
    female=game_durations('female')
    for motion in MOTIONS:
        assert abs(male[motion]-female[motion])<1e-5,(
            motion,male[motion],female[motion]
        )
        normalize(motion,male[motion])
    bpy.ops.wm.save_as_mainfile(filepath=str(WORKBENCH),
                               check_existing=False,compress=True)
    print('LUMBERJACK_DURATIONS_NORMALIZED',len(MOTIONS),flush=True)


if __name__=='__main__':
    main()
