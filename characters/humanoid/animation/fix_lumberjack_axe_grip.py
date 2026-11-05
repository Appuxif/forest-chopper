"""Restore the classic lumberjack's original upright axe grip.

The new detailed axe has the SAME geometry for male, female and lumberjack,
but the classic lumberjack's own retargeted hand pose is rotated. Inserting
the unmodified male axe grip beneath its hand_r bone therefore points the
shaft almost horizontally.

Calibrated against original lumberjack/lumberjack.glb, Idle frame 1:
- original shaft: (-0.04060, +0.16389, +0.98564) in Blender world Z-up
- original blade radial: (+0.14494, -0.97506, +0.16810)
- lower shaft endpoint: (-0.42360, -0.29550, +1.18360) meters
The socket correction below aligns BOTH shaft + blade within 0.001 degrees
and lower shaft endpoint within 1mm; it does not edit the shared axe,
any of the 77 Actions, rig bones, or the 56 body meshes.

The equivalent runtime bone-local delta is authored in CHARACTER_PROFILES
under legacy.handRight (glTF / Three.js Y-up coordinate system).
"""
from pathlib import Path
import bpy
from mathutils import Quaternion, Vector

WORKBENCH = Path(__file__).resolve().parent / 'humanoid_animation_workbench.blend'
SOCKET_NAME = 'Socket.handRight · Lumberjack'
SOCKET_POSITION = (-0.00539657, 0.04869420, -0.08178335)
SOCKET_QUATERNION_WXYZ = (
    0.42880425, 0.07184082, 0.59831154, 0.67304474,
)


def apply_fix():
    rig = bpy.data.objects['Lumberjack_Rig53']
    socket = bpy.data.objects[SOCKET_NAME]
    assert socket.parent == rig
    assert socket.parent_type == 'BONE' and socket.parent_bone == 'hand_r'
    assert len(socket.children) == 1
    grip = socket.children[0]
    assert grip.name == 'AXE_GRIP · Lumberjack'
    assert len(grip.children) == 5
    assert len(rig.data.bones) == 53
    socket.rotation_mode = 'QUATERNION'
    socket.rotation_quaternion = Quaternion(SOCKET_QUATERNION_WXYZ)
    socket.location = Vector(SOCKET_POSITION)
    assert (socket.location - Vector(SOCKET_POSITION)).length < 1e-6
    assert socket.rotation_quaternion.rotation_difference(
        Quaternion(SOCKET_QUATERNION_WXYZ)).angle < 1e-6
    print('LUMBERJACK_AXE_GRIP_ALIGNED',SOCKET_NAME,
          'position',tuple(socket.location),
          'quaternion_wxyz',tuple(socket.rotation_quaternion),flush=True)


def main():
    assert Path(bpy.data.filepath).resolve() == WORKBENCH
    apply_fix()
    bpy.ops.wm.save_as_mainfile(filepath=str(WORKBENCH),
                               check_existing=False, compress=True)
    print('LUMBERJACK_AXE_GRIP_WORKBENCH_SAVED',flush=True)


if __name__ == '__main__':
    main()
