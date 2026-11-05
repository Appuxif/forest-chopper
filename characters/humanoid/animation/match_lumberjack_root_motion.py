"""Match Lumberjack horizontal Root Motion to male/female locomotion Actions.

Works on the artist's EXISTING humanoid_animation_workbench.blend.
Never regenerates rigs or animation banks, never retimes the user's Actions.

Copies only the X/Y Root.location trajectories from male__* clips, sampled by
normalized clip phase at every destination Blender frame. All other curves
(including Root Z bobbing, joint poses and timing) stay byte-for-byte equal
at the keyframe data level.

Commands (from repo root):
  blender -b characters/humanoid/animation/humanoid_animation_workbench.blend \
    --python-exit-code 1 \
    --python characters/humanoid/animation/match_lumberjack_root_motion.py

Destinations and their reference clips:
  walk, walk_backward, run, run_backward, strafe_left, strafe_right
"""

import bpy
import hashlib
import math
from pathlib import Path

WORKBENCH = Path(__file__).resolve().parent / 'humanoid_animation_workbench.blend'
MOVEMENTS = (
    'walk',
    'walk_backward',
    'run',
    'run_backward',
    'strafe_left',
    'strafe_right',
)
ROOT = 'pose.bones["Root"].location'
REWRITTEN = frozenset((ROOT, axis) for axis in (0, 1))


def curves(action):
    result = {}
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fcurve in bag.fcurves:
                    key = (fcurve.data_path, fcurve.array_index)
                    assert key not in result, (action.name, key, 'duplicate')
                    result[key] = fcurve
    return result


def curve_fingerprint(curve_map, excluded=frozenset()):
    """Verify no other action keys, handles, or interpolation are modified."""
    h = hashlib.sha256()
    for key, fcurve in sorted(curve_map.items()):
        if key in excluded:
            continue
        h.update(repr((key, fcurve.extrapolation, fcurve.mute)).encode())
        for point in fcurve.keyframe_points:
            h.update(repr((
                tuple(point.co), point.interpolation,
                tuple(point.handle_left), tuple(point.handle_right),
                point.handle_left_type, point.handle_right_type,
            )).encode())
    return h.hexdigest()


def sample_frames(start, end):
    """Integer frames plus exact source/target action boundary frames."""
    assert end > start, (start, end)
    frames = [float(start)]
    frames.extend(float(n) for n in range(math.floor(start) + 1,
                                          math.ceil(end)) if start < n < end)
    frames.append(float(end))
    assert len(frames) >= 2
    return frames


def set_linear_samples(fcurve, frames, values):
    """Replace just one Root FCurve; keep its existing group and channel path."""
    points = fcurve.keyframe_points
    # Reuse existing points where possible. Iterating a saved list of RNA
    # keyframe references and removing them invalidates the other refs in
    # Blender 5.2, hence adjust the collection size by index instead.
    while len(points) > len(frames):
        points.remove(points[-1], fast=True)
    if len(points) < len(frames):
        points.add(len(frames) - len(points))
    for i, (frame, value) in enumerate(zip(frames, values)):
        point = points[i]
        point.co = (frame, value)
        point.interpolation = 'LINEAR'
    fcurve.update()


def copy_motion(movement):
    male = bpy.data.actions['male__' + movement]
    female = bpy.data.actions['female__' + movement]
    target = bpy.data.actions['lumberjack__' + movement]
    reference = curves(male)
    other_gender = curves(female)
    output = curves(target)
    assert REWRITTEN <= reference.keys() & other_gender.keys() & output.keys()

    source_start, source_end = male.frame_range
    girl_start, girl_end = female.frame_range
    target_start, target_end = target.frame_range
    assert source_end > source_start and target_end > target_start

    # Female and male are independent banks, but currently agree on the
    # locomotion contract. Refuse to silently choose one if they diverge.
    for axis in (0, 1):
        m = reference[(ROOT, axis)]
        f = other_gender[(ROOT, axis)]
        for phase in (0, .25, .5, .75, 1):
            time_m = source_start + phase * (source_end - source_start)
            time_f = girl_start + phase * (girl_end - girl_start)
            ref_m = m.evaluate(time_m) - m.evaluate(source_start)
            ref_f = f.evaluate(time_f) - f.evaluate(girl_start)
            assert abs(ref_m - ref_f) <= .0001, (
                movement, axis, 'male/female root differs', ref_m, ref_f,
            )

    non_root_before = curve_fingerprint(output, REWRITTEN)
    original_range = tuple(target.frame_range)
    frames = sample_frames(target_start, target_end)
    delta = []

    for axis, label in ((0, 'X'), (1, 'Y')):
        src = reference[(ROOT, axis)]
        start_value = src.evaluate(source_start)
        distances = []
        for frame in frames:
            phase = (frame - target_start) / (target_end - target_start)
            source_time = source_start + phase * (source_end - source_start)
            distances.append(src.evaluate(source_time) - start_value)

        dst = output[(ROOT, axis)]
        assert dst.group is not None, (target.name, axis, 'ungrouped Root')
        set_linear_samples(dst, frames, distances)
        assert abs(dst.evaluate(target_start)) < .0001
        total = src.evaluate(source_end) - start_value
        assert abs(dst.evaluate(target_end) - total) < .0001

        for frame, expected in zip(frames, distances):
            actual = dst.evaluate(frame)
            assert abs(actual - expected) < .0001, (
                target.name, label, frame, actual, expected,
            )
        delta.append(total)

    assert tuple(target.frame_range) == original_range, (
        target.name, 'user-authored duration changed',
    )
    assert curve_fingerprint(output, REWRITTEN) == non_root_before, (
        target.name, 'a non-horizontal-Root animation key was changed',
    )
    assert len(frames) >= 2
    target['fc_root_motion'] = 'matches_male_female'
    target['fc_root_motion_source'] = male.name
    print(
        'MATCHED_ROOT_MOTION', target.name,
        'start_end_frames', tuple(round(v, 4) for v in original_range),
        'duration_s', round((target_end - target_start) *
                            bpy.context.scene.render.fps_base /
                            bpy.context.scene.render.fps, 5),
        'distance_xy', tuple(round(d, 5) for d in delta),
        'samples', len(frames),
        flush=True,
    )


def main():
    assert Path(bpy.data.filepath).resolve() == WORKBENCH
    for movement in MOVEMENTS:
        copy_motion(movement)
    bpy.ops.wm.save_as_mainfile(filepath=str(WORKBENCH),
                               check_existing=False, compress=True)
    print('ALL_LUMBERJACK_ROOT_MOTION_MATCHED', len(MOVEMENTS), flush=True)


if __name__ == '__main__':
    main()
