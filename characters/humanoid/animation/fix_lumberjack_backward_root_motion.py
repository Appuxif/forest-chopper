"""Backwards-compatible entrypoint for matching backward Root Motion.

The former generator reversed the Lumberjack's own forward clip and produced
incorrect distances (1.10/1.42 m). The shared locomotion contract requires
male/female backward distances (1.32/1.16 m). Keep all user-edited Actions.
"""
import bpy
from pathlib import Path
from match_lumberjack_root_motion import WORKBENCH, copy_motion

if __name__ == '__main__':
    assert Path(bpy.data.filepath).resolve()==WORKBENCH
    for clip in ('walk_backward','run_backward'):
        copy_motion(clip)
    bpy.ops.wm.save_as_mainfile(filepath=str(WORKBENCH),
                               check_existing=False,compress=True)
    print('BACKWARD_ROOT_MOTION_MATCHED_AND_SAVED',flush=True)
