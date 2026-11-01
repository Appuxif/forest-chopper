"""Give all Male animation clips the same finger-only pose as frame 1 of Chop.

The wrist/hand, forearm, upper arm, pelvis, and locomotion tracks are unchanged.
The preview axe stays an external prop parented to hand_r, never embedded in GLB.
"""

import json
from pathlib import Path

FINGERS = ('thumb', 'index', 'middle', 'ring', 'pinky')
SIDES = ('l', 'r')
FINGER_BONES = tuple(
    f'{finger}_{joint:02d}_{side}'
    for side in SIDES
    for finger in FINGERS
    for joint in (1, 2, 3)
)


def load_finger_pose(path):
    data = json.loads(Path(path).read_text())
    assert data['frame'] == 1 and data['action'] == 'FC_Male_Chop'
    assert set(data['finger_bones']) == set(FINGER_BONES), 'Expected exactly 30 finger bones'
    assert data['axe_reference_only']['parent_bone'] == 'hand_r'
    for bone in data['finger_bones'].values():
        assert len(bone['location']) == 3
        assert len(bone['rotation_quaternion']) == 4
    return data


def apply_finger_pose_to_actions(rig, source):
    """Bake constant Chop pose into each imported NLA action without touching non-fingers."""
    actions = {}
    for track in rig.animation_data.nla_tracks:
        for strip in track.strips:
            actions[strip.action.name] = (strip.action, strip.action_slot)
    assert len(actions) == 12, f'Expected exactly 12 source game clips: {list(actions)}'
    count = 0
    for action, slot in actions.values():
        start, end = map(float, action.frame_range)
        assert start < end, (action.name, start, end)
        for name, pose in source['finger_bones'].items():
            assert rig.pose.bones.get(name), name
            channelbag = action.layers[0].strips[0].channelbag(slot, ensure=True)
            for prop in ('location', 'rotation_quaternion'):
                path = f'pose.bones["{name}"].{prop}'
                for axis, value in enumerate(pose[prop]):
                    curve = channelbag.fcurves.find(path, index=axis)
                    if curve is None:
                        curve = channelbag.fcurves.new(path, index=axis, group_name=name)
                    for key in list(curve.keyframe_points):
                        curve.keyframe_points.remove(key)
                    for frame in (start, end):
                        point = curve.keyframe_points.insert(frame, float(value), options={'FAST'})
                        point.interpolation = 'LINEAR'
                    curve.update()
                    count += 1
        print('FINGER_POSE_BAKED', action.name, 'finger bones', len(FINGER_BONES), 'range', start, end, flush=True)
    return count
