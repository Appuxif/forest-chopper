"""Turn the forged head of the crescent axe 180° around its wooden handle.

Authoring edit only. Does not turn the handle, AXE_GRIP_CRESCENT or the
character's hand socket. Keeps the currently saved user's mesh edits.
Idempotent: a custom property prevents accidental double rotation.

Run from project root:
  blender -b characters/humanoid/weapons/crescent_axe.blend \
    --python-exit-code 1 --python characters/humanoid/weapons/flip_crescent_head.py
"""
from pathlib import Path
from math import pi
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[3]
BLEND = ROOT / 'characters/humanoid/weapons/crescent_axe.blend'
GLB = ROOT / 'characters/humanoid/game/axe_crescent.glb'
GRIP = 'AXE_GRIP_CRESCENT'
HANDLE_PREFIXES = ('Handle |', 'Ash grain', 'Grip |', 'Pommel |')

root = bpy.data.objects[GRIP]
assert Path(bpy.data.filepath).resolve() == BLEND
assert not any('Blade | sweeping razor edge' in obj.name for obj in bpy.data.objects)
handle = next(obj for obj in root.children if obj.name.startswith('Handle |'))
blade = next(obj for obj in root.children if obj.name.startswith('Crescent blade |'))
assert len(root.children) > 20

def points_in_grip(obj):
    to_grip = root.matrix_world.inverted() @ obj.matrix_world
    if obj.type != 'MESH':
        return []
    return np.array([tuple(to_grip @ vertex.co) for vertex in obj.data.vertices])

before_handle = handle.matrix_world.copy()
before_root = root.matrix_world.copy()
old_blade = points_in_grip(blade)
blade_center_before = Vector(old_blade.mean(axis=0))

if not root.get('crescent_head_flipped_180'):
    # Shaft's longest principal component, with the positive side pointing
    # towards the steel head. No hard-coded world-space Euler angles.
    sample = points_in_grip(handle)
    center = sample.mean(axis=0)
    _, _, vh = np.linalg.svd(sample-center, full_matrices=False)
    shaft = Vector(vh[0]).normalized()
    head_socket = next(obj for obj in root.children
                       if obj.name.startswith('Head | blackened forged socket'))
    socket_center = Vector(points_in_grip(head_socket).mean(axis=0))
    if shaft.dot(socket_center-Vector(center)) < 0:
        shaft.negate()
    pivot = Vector(center) + shaft*(socket_center-Vector(center)).dot(shaft)

    flip = (Matrix.Translation(pivot)
            @ Quaternion(shaft, pi).to_matrix().to_4x4()
            @ Matrix.Translation(-pivot))

    head_parts = [obj for obj in root.children
                  if not obj.name.startswith(HANDLE_PREFIXES)]
    assert len(head_parts) >= 12, [obj.name for obj in head_parts]
    assert all(obj.parent == root for obj in head_parts)
    assert all(
        max(abs(v) for row in obj.matrix_parent_inverse for v in row[i:i+1]) < 2
        for obj in head_parts for i in range(4)
    )
    for obj in head_parts:
        # Every head mesh/curve is already parented to AXE_GRIP_CRESCENT,
        # so we rotate in grip-local space, not around the global origin.
        assert all(abs(obj.matrix_parent_inverse[r][c] - (1 if r == c else 0)) < 1e-6
                   for r in range(4) for c in range(4)), obj.name
        obj.matrix_basis = flip @ obj.matrix_basis

    root['crescent_head_flipped_180'] = True
    print('FLIPPED_HEAD_180',len(head_parts),'objects; shaft',tuple(round(v,5) for v in shaft),
          'pivot',tuple(round(v,5) for v in pivot),flush=True)
else:
    print('HEAD_ALREADY_FLIPPED, no second rotation',flush=True)

bpy.context.view_layer.update()
assert all(abs(before_root[r][c]-root.matrix_world[r][c]) < 1e-6
           for r in range(4) for c in range(4))
assert all(abs(before_handle[r][c]-handle.matrix_world[r][c]) < 1e-6
           for r in range(4) for c in range(4)), 'Handle must stay fixed'
new_blade = points_in_grip(blade)
new_center = Vector(new_blade.mean(axis=0))
print('BLADE_CENTER',tuple(round(v,5) for v in blade_center_before),
      '=>',tuple(round(v,5) for v in new_center),flush=True)

bpy.ops.object.select_all(action='DESELECT')
for obj in [root,*root.children]:
    obj.hide_set(False)
    obj.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.export_scene.gltf(
    filepath=str(GLB),export_format='GLB',use_selection=True,
    export_yup=True,export_normals=True,export_materials='EXPORT',
    export_animations=False,export_skins=False,
    export_cameras=False,export_lights=False)
print('EXPORTED',GLB,flush=True)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND),compress=True)
print('SAVED',BLEND,flush=True)
