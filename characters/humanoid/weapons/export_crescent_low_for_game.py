"""Export the CURRENT saved LOW crescent-axe variant for Forest Chopper.

Only the LOW hierarchy is selected; the detailed HIGH hierarchy remains
untouched. All Blender axis helpers stay inside the GLB to preserve the
original AXE_GRIP_CRESCENT_LOW socket transform in the character hand.

Run from repo root:
 blender -b -t 3 characters/humanoid/weapons/crescent_axe.blend \
  --python-exit-code 1 --python characters/humanoid/weapons/export_crescent_low_for_game.py
"""
import bpy
import json
import struct
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
BLEND=ROOT/'characters/humanoid/weapons/crescent_axe.blend'
OUTPUT=ROOT/'characters/humanoid/game/axe_crescent_low.glb'
assert Path(bpy.data.filepath).resolve()==BLEND, bpy.data.filepath

low=bpy.data.objects['AXE_GRIP_CRESCENT_LOW']
high=bpy.data.objects['AXE_GRIP_CRESCENT']
assert len(high.children)==1 and len(low.children)==1, 'Expected axis helper beneath each grip'
assert len(low.children[0].children)==34 and len(high.children[0].children)==34
assert low.get('geometry_axis_aligned_v1'), 'LOW must be authored from aligned .blend'
assert abs(low.scale.x-.81/1.06)<1e-5
assert (low.matrix_world.translation-high.matrix_world.translation).length<1e-6
assert all(abs(low.matrix_world[i][j]-high.matrix_world[i][j])<1e-5
           for i in range(4) for j in range(4)), 'Grip transform must match high model'

# Deselect even hidden collection objects, never risk exporting HIGH.
for obj in bpy.data.objects:
    obj.select_set(False)
selected=[low]
def descendants(o):
    for child in o.children:
        selected.append(child)
        descendants(child)
descendants(low)
assert len(selected)==36,(len(selected),[obj.name for obj in selected])
for obj in selected:
    obj.hide_set(False)
    obj.select_set(True)
bpy.context.view_layer.objects.active=low
bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT),export_format='GLB',use_selection=True,
    export_yup=True,export_normals=True,export_materials='EXPORT',
    export_animations=False,export_skins=False,
    export_cameras=False,export_lights=False,
)

blob=OUTPUT.read_bytes()
assert blob[:4]==b'glTF'
length=struct.unpack_from('<I',blob,12)[0]
gltf=json.loads(blob[20:20+length])
triangles=sum(gltf['accessors'][part['indices']]['count']//3
              for mesh in gltf['meshes'] for part in mesh['primitives'])
names={node.get('name') for node in gltf['nodes']}
assert 'AXE_GRIP_CRESCENT_LOW' in names
assert any(name and 'GEOMETRY_AXES_Y_HANDLE_X_BLADE_LOW' in name for name in names)
assert 'AXE_GRIP_CRESCENT' not in names
assert len(gltf['meshes'])==34
assert 1000 <= triangles <= 2000, triangles
assert not gltf.get('animations') and not gltf.get('skins')
assert all('Blade | sweeping razor edge' not in (name or '') for name in names)
grip=next(node for node in gltf['nodes'] if node.get('name')=='AXE_GRIP_CRESCENT_LOW')
assert all(abs(s-.81/1.06)<1e-5 for s in grip['scale']),grip
print('GAME_LOW_EXPORT',OUTPUT,'triangles',triangles,
      'meshes',len(gltf['meshes']),'nodes',len(gltf['nodes']),
      'bytes',len(blob),'grip',grip,flush=True)
