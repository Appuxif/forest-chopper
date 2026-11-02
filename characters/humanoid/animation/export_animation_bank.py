"""Export production Actions only; leave REF_* in the workbench .blend.

Optional gender-specific Action overrides use `male__run` / `female__run` names;
those become the corresponding named clips when packed into their body's GLB.
"""
import bpy
from pathlib import Path
import sys,json,struct
if '--' not in sys.argv:raise SystemExit('Expected destination after --')
out=Path(sys.argv[sys.argv.index('--')+1]).resolve()
out.parent.mkdir(parents=True,exist_ok=True)
rig=bpy.data.objects['Humanoid_Rig53']
assert len(rig.data.bones)==53
all_names={a.name for a in bpy.data.actions}
assert {'idle','walk','run','Chop'}<=all_names
# Workbench REF_* motions are experiments, not production assets. Removing
# them from this disposable Blender session prevents glTF from serializing
# their curves/bytes at all; the input .blend is never written or changed.
references=[a for a in bpy.data.actions if a.name.startswith('REF_')]
for action in references:
 bpy.data.actions.remove(action)
names={a.name for a in bpy.data.actions}
assert all(not name.startswith('REF_') for name in names)
assert len(names)>=13,('Expected game Actions',names)
print('OMITTED_WORKBENCH_REFERENCES',len(references))
if rig.animation_data:
 rig.animation_data.action=None
 for track in rig.animation_data.nla_tracks:track.mute=True
for ob in bpy.context.scene.objects:ob.select_set(ob==rig)
rig.hide_set(False)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,
 export_skins=True,export_animations=True,export_animation_mode='ACTIONS',
 export_merge_animation='NONE',export_force_sampling=True,export_yup=True)
with out.open('rb') as f:
 assert f.read(4)==b'glTF';f.seek(12);size,_=struct.unpack('<II',f.read(8));obj=json.loads(f.read(size))
actual={a['name'] for a in obj['animations']}
assert names==actual,(names^actual)
assert not obj.get('meshes')
print('PRODUCTION_ANIMATION_BANK',len(actual),'actions',out)
