#!/usr/bin/env python3
"""Snapshot the shared humanoid finger pose from frame 1 of the user-authored Chop file.

Usage:
    blender -b characters/humanoid/animation/humanoid_animation_workbench.blend \\
      --python characters/humanoid/tools/extract_chop_finger_pose.py

This reads the final .blend but never saves or modifies it.
"""
import bpy
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
SOURCE_NAME = 'Chop'
RIG_NAME = 'Humanoid_Rig53'
FINGERS = ('thumb', 'index', 'middle', 'ring', 'pinky')
BONES = [
    f'{finger}_{segment:02d}_{side}'
    for side in ('l', 'r')
    for finger in FINGERS
    for segment in (1, 2, 3)
]

rig = bpy.data.objects[RIG_NAME]
assert rig.animation_data.action.name == SOURCE_NAME, rig.animation_data.action
scene = bpy.context.scene
scene.frame_set(1)
bpy.context.view_layer.update()

pose = {}
for name in BONES:
    bone = rig.pose.bones[name]
    assert bone.rotation_mode == 'QUATERNION', (name, bone.rotation_mode)
    pose[name] = {
        'rotation_quaternion': [round(float(x), 9) for x in bone.rotation_quaternion],
        'location': [round(float(x), 9) for x in bone.location],
    }

grip = next(o for o in bpy.data.objects if o.name.startswith('AXE_GRIP'))
assert grip.parent == rig and grip.parent_bone == 'hand_r'
data = {
    'source': 'animation/humanoid_animation_workbench.blend',
    'action': SOURCE_NAME,
    'frame': 1,
    'finger_bones': pose,
    'axe_reference_only': {
        'parent_bone': grip.parent_bone,
        'location': [round(float(x), 9) for x in grip.location],
        'rotation_euler_xyz': [round(float(x), 9) for x in grip.rotation_euler],
        'scale': [round(float(x), 9) for x in grip.scale],
    },
}
out = HERE / 'animation/chop_finger_pose.json'
out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
print('EXTRACTED_POSE', out, 'finger bones:', len(pose), 'axe grip parent:', grip.parent_bone)
