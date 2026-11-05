"""Match Lumberjack strafe Action durations to the male/female workbench.

Only retime keyframe X coordinates and handle X coordinates of the two
Lumberjack Actions. Never regenerate the scene or modify any animation
values, Root Motion distances, bone transforms or other Actions.

In the workbench: male/female 1.25..27.5 = 26.25 frames (0.875s at 30 FPS).
Keep Lumberjack start=1; rescale its range 1..28 -> 1..27.25.

The game's export samples a separate disposable copy at 0..26 frames,
matching the male/female glTF duration 26/30 = 0.866667 seconds.
"""
from pathlib import Path

import bpy

WORKBENCH = Path(__file__).resolve().parent / "humanoid_animation_workbench.blend"
MOTIONS = ("strafe_left", "strafe_right")


def all_curves(action):
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


def retime(motion):
    male = bpy.data.actions["male__" + motion]
    female = bpy.data.actions["female__" + motion]
    lumberjack = bpy.data.actions["lumberjack__" + motion]
    m_start, m_end = male.frame_range
    f_start, f_end = female.frame_range
    start, end = lumberjack.frame_range
    target_length = m_end - m_start
    assert abs(target_length - (f_end - f_start)) < 1e-4, (
        motion, "male/female duration mismatch"
    )
    assert target_length > 0 and end > start
    scale = target_length / (end - start)
    if abs(scale - 1.0) < 1e-8:
        print("STRAFE_TIMING_ALREADY_MATCHED", motion, flush=True)
        return
    assert .8 < scale < 1.2, (motion, scale, "unexpected retime ratio")
    count = 0
    for curve in all_curves(lumberjack):
        for key in curve.keyframe_points:
            key.co.x = start + (key.co.x - start) * scale
            key.handle_left.x = start + (key.handle_left.x - start) * scale
            key.handle_right.x = start + (key.handle_right.x - start) * scale
            count += 1
        curve.update()

    first, last = lumberjack.frame_range
    assert abs(first - start) < 1e-4
    assert abs((last - first) - target_length) < 1e-4, (
        motion, (first, last), target_length
    )
    print(
        "STRAFE_TIMING_MATCHED", motion,
        "old_frames", round(end - start, 5),
        "new_frames", round(last - first, 5),
        "seconds", round((last - first) / bpy.context.scene.render.fps, 5),
        "keyframes_retimed", count,
        flush=True,
    )


def main():
    assert Path(bpy.data.filepath).resolve() == WORKBENCH
    for motion in MOTIONS:
        retime(motion)
    bpy.ops.wm.save_as_mainfile(
        filepath=str(WORKBENCH), check_existing=False, compress=True
    )
    print("STRAFE_TIMING_SAVED", WORKBENCH, flush=True)


if __name__ == "__main__":
    main()
