"""Export the saved Humanoid animation workbench as a game-ready GLB.

Usage:
 blender -b /path/to/humanoid_animation_workbench.blend \
   --python characters/humanoid/export_game_glb.py -- characters/humanoid/game/humanoid-game.glb

The original .blend is NEVER modified. Include the preview outfit and attached
axe, but export animations from the workbench's own 53-bone rig only.
"""
import bpy
from pathlib import Path
import sys

if '--' not in sys.argv:
    raise SystemExit('Expected GLB destination after --')
output = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
rig = bpy.data.objects.get('Humanoid_Rig53')
assert rig and rig.type == 'ARMATURE' and len(rig.data.bones) == 53
assert 'Root' in rig.data.bones
required = {'idle', 'walk', 'run', 'Chop', 'jump'}
action_names = {a.name for a in bpy.data.actions}
assert required.issubset(action_names), required - action_names

# No viewport preview/NLA action should override an exported Action.
ad = rig.animation_data
if ad:
    ad.action = None
    for track in ad.nla_tracks:
        track.mute = True

if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
for ob in bpy.context.scene.objects:
    ob.select_set(False)
for ob in bpy.context.scene.objects:
    if ob == rig or ob.type == 'MESH' or ob.name.startswith('AXE_GRIP'):
        ob.hide_set(False)
        ob.select_set(True)
bpy.context.view_layer.objects.active = rig
print('EXPORT_SELECTION', [(o.name, o.select_get()) for o in bpy.context.scene.objects])
bpy.ops.export_scene.gltf(
    filepath=str(output), export_format='GLB', use_selection=False,
    export_skins=True, export_animations=True,
    export_animation_mode='ACTIONS', export_merge_animation='NONE',
    export_force_sampling=True, export_yup=True, export_apply=False,
)
assert output.is_file() and output.stat().st_size > 100_000
print('GAME_HUMANOID_EXPORT_OK', output, 'bytes', output.stat().st_size)
