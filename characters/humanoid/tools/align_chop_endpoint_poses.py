#!/usr/bin/env python3
"""Align rest/end frames of selected humanoid Actions to frame 1 of Chop.

Run from the canonical file (never creates an alternate .blend):
    blender -b characters/humanoid/animation/humanoid_animation_workbench.blend \\
        --python characters/humanoid/tools/align_chop_endpoint_poses.py

Authoring and build pipelines share the exported JSON channel snapshot.
Only the requested first/last keyframe values are changed, not interior keys.
"""
import json
import re
from pathlib import Path

IDLE_PREFIX = "idle"
ENDPOINT_RULES = {
    "jump": ("first", "last"),
    "land": ("last",),
}
FIRST_FRAME = 1


def channel_curves(action):
    return {
        (curve.data_path, curve.array_index): curve
        for layer in action.layers
        for strip in layer.strips
        for bag in strip.channelbags
        for curve in bag.fcurves
    }


def extract_chop_pose(chop):
    data = channel_curves(chop)
    assert len(data) == 530, f"Expected complete 53-bone / 530-channel Chop, got {len(data)}"
    result = [
        {"path": path, "index": index, "value": round(float(curve.evaluate(FIRST_FRAME)), 10)}
        for (path, index), curve in sorted(data.items())
    ]
    assert len(result) == 530
    return {"action": "Chop", "frame": FIRST_FRAME, "channels": result}


def target_rules(actions):
    names = [action.name for action in actions]
    rules = {
        name: ("first", "last")
        for name in names
        if name == IDLE_PREFIX or name.startswith(IDLE_PREFIX + "_")
    }
    rules.update({name: rule for name, rule in ENDPOINT_RULES.items() if name in names})
    expected = {"idle", "idle_breathe", "idle_fidget", "idle_look", "jump", "land"}
    assert set(rules) == expected, f"Unexpected Action names: {set(rules)}"
    return rules


def apply_endpoints(actions, pose, rig=None, skip=()):
    """Change requested endpoint keys only. Preserve all interior animation."""
    source = {(row["path"], row["index"]): row["value"] for row in pose["channels"]}
    assert len(source) == 530
    rules = target_rules(actions)
    for name in skip:
        assert name in rules, name
        del rules[name]
    changed = {}
    for action in actions:
        selected = rules.get(action.name)
        if not selected:
            continue
        curves = channel_curves(action)
        assert set(curves) <= set(source), f"Unexpected channels in {action.name}"
        first, last = action.frame_range
        # Original upstream GLB omits static bone tracks. Preserve their
        # unanimated rest pose between endpoints when adding an override.
        for key in sorted(set(source) - set(curves)):
            assert rig is not None, f"Authoring Action {action.name} lost {key}"
            path, index = key
            match = re.fullmatch(r'pose.bones\["([^"]+)"\]\.(location|rotation_quaternion|scale)', path)
            assert match, path
            bone_name, prop = match.groups()
            baseline = float(getattr(rig.pose.bones[bone_name], prop)[index])
            bag = action.layers[0].strips[0].channelbag(action.slots[0], ensure=True)
            curve = bag.fcurves.new(path, index=index, group_name=bone_name)
            # Keep the prior default value throughout the clip interior.
            samples = ((first, baseline), (first + 1, baseline),
                       (last - 1, baseline), (last, baseline))
            for frame, value in samples:
                point = curve.keyframe_points.insert(float(frame), value, options={'FAST'})
                point.interpolation = 'LINEAR'
            curve.update()
            curves[key] = curve
        assert set(curves) == set(source), f"Missing channels in {action.name}"
        for key, curve in curves.items():
            points = curve.keyframe_points
            assert len(points) >= 2, f"Expected distinct endpoint keys for {action.name} {key}"
            assert abs(points[0].co.x - first) < 1e-3, (action.name, key, points[0].co.x, first)
            assert abs(points[-1].co.x - last) < 1e-3, (action.name, key, points[-1].co.x, last)
            for where in selected:
                point = points[0] if where == "first" else points[-1]
                delta = source[key] - point.co.y
                # For LINEAR/CONSTANT these are ignored. Moving both handles
                # too also safely retains correct offsets for BEZIER keys.
                point.co.y += delta
                point.handle_left.y += delta
                point.handle_right.y += delta
            curve.update()
        changed[action.name] = list(selected)
        print("CHOP_POSE_ENDPOINT", action.name, f"{first:g}..{last:g}", ",".join(selected), "530 channels", flush=True)
    assert set(changed) == set(rules)
    return changed


def pin_fractional_land_export_frame(actions, pose):
    """Ensure the last *exported* glTF sample matches the last land key.

    Blender's glTF exporter samples NLA at integer scene frames. Upstream land
    ends at a fractional action frame (25.6). Its last sampled frame is 25,
    before the real final key at 25.6. Pin the corresponding values on frame
    25 too, only in the disposable Blender build (never in the authored .blend).
    """
    import math

    action = next(a for a in actions if a.name == "land")
    end = float(action.frame_range[1])
    last_sample = math.floor(end + 1e-6)
    if abs(end - last_sample) < 1e-5:
        return
    source = {(entry["path"], entry["index"]): entry["value"] for entry in pose["channels"]}
    curves = channel_curves(action)
    assert set(curves) == set(source)
    for key, curve in curves.items():
        point = next((p for p in curve.keyframe_points if abs(p.co.x - last_sample) < 1e-5), None)
        if point is None:
            point = curve.keyframe_points.insert(last_sample, source[key], options={'FAST'})
        else:
            point.co.y = source[key]
        point.interpolation = 'LINEAR'
        curve.update()
    print("PINNED_LAND_GLTF_END_SAMPLE", last_sample, "of", end, "channels", len(source), flush=True)


if __name__ == "__main__":
    import bpy

    base = Path(__file__).resolve().parents[1]
    filepath = base / "animation/humanoid_animation_workbench.blend"
    assert Path(bpy.data.filepath).resolve() == filepath.resolve(), bpy.data.filepath
    rig = bpy.data.objects["Humanoid_Rig53"]
    assert len(rig.pose.bones) == 53
    chop = bpy.data.actions["Chop"]
    assert len(bpy.data.actions) == 13, len(bpy.data.actions)

    pose = extract_chop_pose(chop)
    rules = apply_endpoints(list(bpy.data.actions), pose)

    snapshot = base / "animation/chop_pose_endpoints.json"
    snapshot.write_text(json.dumps(pose, indent=2, ensure_ascii=False) + "\n")
    # This is the ONE working animation .blend. Git stores past versions.
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(filepath), compress=True)
    print("CHOP_POSE_WORKBENCH_UPDATED", filepath, "rules", rules, "snapshot", snapshot, flush=True)
