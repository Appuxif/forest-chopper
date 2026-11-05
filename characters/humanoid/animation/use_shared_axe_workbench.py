"""Use the same detailed axe mesh for male/female/lumberjack in Blender.

Only changes Lumberjack's visual reference under Socket.handRight. It
copies the five already-present mesh OBJECTS from male, sharing their mesh
datablocks/materials. No rig, Actions, bone tracks or body geometry change.

Run:
 blender -b characters/humanoid/animation/humanoid_animation_workbench.blend \
   --python-exit-code 1 \
   --python characters/humanoid/animation/use_shared_axe_workbench.py
"""
from pathlib import Path

import bpy

WORKBENCH = Path(__file__).resolve().parent / 'humanoid_animation_workbench.blend'
OLD_SOCKET = 'Socket.handRight · Lumberjack'
GRIP_NAME = 'AXE_GRIP · Lumberjack'
MALE_GRIP = 'AXE_GRIP · rotate here to adjust handle'


def use_shared_axe_reference():
    socket = bpy.data.objects[OLD_SOCKET]
    male_grip = bpy.data.objects[MALE_GRIP]
    assert socket.parent == bpy.data.objects['Lumberjack_Rig53']
    assert socket.parent_bone == 'hand_r'
    assert len(male_grip.children) == 5
    old_children = list(socket.children)
    if len(old_children) == 1 and old_children[0].name == GRIP_NAME:
        assert len(old_children[0].children) == 5
        print('SHARED_AXE_WORKBENCH_ALREADY_APPLIED', flush=True)
        return

    assert {obj.name for obj in old_children} == {
        'Lumberjack.Axe blade', 'Lumberjack.Axe handle'
    }, [obj.name for obj in old_children]

    collection = socket.users_collection[0]
    assert collection.name == 'Axe · lumberjack (reference only)'

    # The original two rigid pieces remain recoverable from the unchanged
    # lumberjack/lumberjack.glb source. Remove only their reference copies.
    for old in old_children:
        bpy.data.objects.remove(old, do_unlink=True)

    grip = male_grip.copy()
    grip.name = GRIP_NAME
    collection.objects.link(grip)
    grip.parent = socket
    grip.parent_type = 'OBJECT'
    grip.parent_bone = ''
    grip.matrix_parent_inverse.identity()
    grip.matrix_basis = male_grip.matrix_basis.copy()
    grip['fc_shared_axe'] = 'characters/humanoid/game/axe_shared.glb'

    for part in male_grip.children:
        copy = part.copy()             # shares exact same mesh & materials
        copy.name = part.name.replace('· Male', '· Lumberjack')
        collection.objects.link(copy)
        copy.parent = grip
        copy.parent_type = 'OBJECT'
        copy.parent_bone = ''
        copy.matrix_parent_inverse.identity()
        copy.matrix_basis = part.matrix_basis.copy()

    assert {obj.data for obj in grip.children} == {
        obj.data for obj in male_grip.children
    }
    assert len(socket.children) == 1 and len(grip.children) == 5
    print('SHARED_AXE_WORKBENCH_APPLIED',
          'socket', socket.name, 'grip', grip.name,
          'mesh_count', len(grip.children), flush=True)


def main():
    assert Path(bpy.data.filepath).resolve() == WORKBENCH
    use_shared_axe_reference()
    bpy.ops.wm.save_as_mainfile(filepath=str(WORKBENCH),
                               check_existing=False, compress=True)
    print('SHARED_AXE_WORKBENCH_SAVED', WORKBENCH, flush=True)


if __name__ == '__main__':
    main()
