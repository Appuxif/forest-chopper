"""Scale a single-variant crescent axe to match an 0.81m original handle.

The grip's position and orientation stay unchanged, so every humanoid
continues holding the same attachment point. Uniform scaling takes place
only within the AXE_GRIP_CRESCENT hierarchy and is NOT cumulative: reruns
keep scale at the requested handle length, rather than scaling a second time.

Run from the repository root:
 blender -b characters/humanoid/weapons/crescent_axe.blend \
   --python-exit-code 1 --python characters/humanoid/weapons/scale_crescent_axe.py
"""
import bpy
from mathutils import Vector
from pathlib import Path
import json
import struct

root = Path(__file__).resolve().parents[3]
source = root / 'characters/humanoid/weapons/crescent_axe.blend'
output = root / 'characters/humanoid/game/axe_crescent.glb'
assert Path(bpy.data.filepath).resolve() == source
grip = bpy.data.objects['AXE_GRIP_CRESCENT']
handle = bpy.data.objects['Handle | sculpted dark ash']
blade = bpy.data.objects['Crescent blade | one-piece forged steel']
assert handle.parent == grip and blade.parent == grip
if bpy.data.objects.get('AXE_GRIP_CRESCENT_LOW'):
    raise RuntimeError('This blend contains High + Low variants: rerun create_crescent_lowpoly.py instead to resize both.')
assert grip.get('crescent_head_flipped_180')
assert not any('Blade | sweeping razor edge' in o.name for o in bpy.data.objects)

old_position = grip.location.copy()
old_rotation = grip.rotation_euler.copy()
old_child_count = len(grip.children)
assert old_child_count == 34, old_child_count

# Origin of the grip is the correct attachment pivot, not the midpoint of
# the handle. Root location and quaternion are preserved exactly.
target_scale = .81 / 1.06
grip.scale = Vector((target_scale,)*3)
grip['original_scale_fraction'] = target_scale
bpy.context.view_layer.update()
assert (grip.location - old_position).length < 1e-6
assert (Vector(grip.rotation_euler) - Vector(old_rotation)).length < 1e-6
assert len(grip.children) == old_child_count

bpy.ops.object.select_all(action='DESELECT')
for obj in (grip, *grip.children):
    obj.hide_set(False)
    obj.select_set(True)
bpy.context.view_layer.objects.active = grip
bpy.ops.export_scene.gltf(
    filepath=str(output), export_format='GLB', use_selection=True,
    export_yup=True, export_normals=True, export_materials='EXPORT',
    export_animations=False, export_skins=False,
    export_cameras=False, export_lights=False,
)
raw = output.read_bytes()
length = struct.unpack_from('<I', raw, 12)[0]
gltf = json.loads(raw[20:20+length])
assert len(gltf['meshes']) == 34
assert not gltf.get('skins') and not gltf.get('animations')
grips = [node for node in gltf['nodes']
         if node.get('name') == 'AXE_GRIP_CRESCENT']
assert len(grips) == 1
assert all(abs(x-target_scale) < 2e-6 for x in grips[0]['scale']), grips[0]
assert not any('Blade | sweeping razor edge' in node.get('name', '')
               for node in gltf['nodes'])
triangles = sum(
    gltf['accessors'][primitive['indices']]['count']//3
    for mesh in gltf['meshes'] for primitive in mesh['primitives'])
assert triangles == 21156, triangles

# Preserve the independent studio scene and every authored object/action.
# Backup is created by the calling shell before overwriting this file.
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
print('CRESCENT_SCALED', source, 'handle length ~0.81m',
      'pivot', tuple(round(v, 6) for v in old_position),
      'triangles', triangles, 'meshes', len(gltf['meshes']),
      'glb_bytes', len(raw), flush=True)
