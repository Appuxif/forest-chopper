"""Group each Lumberjack animation channel by bone, like male/female Actions.

Usage:
  blender -b characters/humanoid/animation/humanoid_animation_workbench.blend \
    --python-exit-code 1 \
    --python characters/humanoid/animation/group_lumberjack_action_channels.py

Only updates F-Curve groups in lumberjack__* and REF_Lumberjack_*.
No pose, keyframe, rig or animation data is modified. Safe to rerun.
"""
import bpy
import hashlib
import re
from pathlib import Path


WORKBENCH = Path(__file__).resolve().parent / 'humanoid_animation_workbench.blend'
BONE_PATH = re.compile(r'^pose\.bones\["([^"]+)"\]\.')
PREFIXES = ('lumberjack__', 'REF_Lumberjack_')


def channel_bags(action):
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield bag


def key_signature(action):
    """Deterministic fingerprint of exact key locations/values and handles."""
    h = hashlib.sha256()
    for bag in channel_bags(action):
        for curve in bag.fcurves:
            h.update(repr((curve.data_path, curve.array_index,
                           curve.extrapolation, curve.mute)).encode())
            for key in curve.keyframe_points:
                h.update(repr((
                    tuple(key.co), key.interpolation,
                    tuple(key.handle_left), tuple(key.handle_right),
                    key.handle_left_type, key.handle_right_type
                )).encode())
    return h.hexdigest()


def group_action(action):
    old_sig = key_signature(action)
    total = 0
    for bag in channel_bags(action):
        names = {
            bone
            for curve in bag.fcurves
            for matched in [BONE_PATH.match(curve.data_path)]
            if matched
            for bone in [matched.group(1)]
        }
        assert len(names) == 53, (action.name, len(names))
        groups = {g.name: g for g in bag.groups}
        for curve in bag.fcurves:
            match = BONE_PATH.match(curve.data_path)
            assert match, (action.name, curve.data_path)
            bone = match.group(1)
            if bone not in groups:
                groups[bone] = bag.groups.new(bone)
            curve.group = groups[bone]
            total += 1
        assert len(bag.groups) == 53, (action.name, len(bag.groups))
        assert all(len(group.channels) == 10 for group in bag.groups), action.name
        for group in bag.groups:
            group.show_expanded = False
            group.show_expanded_graph = False
    assert old_sig == key_signature(action), f'Action keys changed: {action.name}'
    print('GROUPED_ACTION', action.name, 'bones', len(names), 'curves', total,
          'key_sha256', old_sig, flush=True)


def main():
    assert Path(bpy.data.filepath).resolve() == WORKBENCH
    actions = [a for a in bpy.data.actions if a.name.startswith(PREFIXES)]
    assert len(actions) == 16, (len(actions), [a.name for a in actions])
    for action in actions:
        group_action(action)
    bpy.ops.wm.save_as_mainfile(filepath=str(WORKBENCH),
                               check_existing=False, compress=True)
    print('GROUPS_SAVED', WORKBENCH, 'actions', len(actions), flush=True)


if __name__ == '__main__':
    main()
