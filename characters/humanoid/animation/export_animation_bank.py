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
# Imported locomotion loops begin at Blender frame 1.25, not at t=0.
# Rebase them in this disposable Blender export process, so GLB loop time
# starts exactly at 0. Every loop must include its final pose and full Root
# travel, otherwise the seam causes a tiny hitch/dropped displacement.
# Strafe: authored 1.25..27.5 (26.25 Blender frames) -> export 0..26
# (27 samples at 30 FPS), a <1% retiming required for integer glTF samples.
# Walk: authored 1.25..31.25 -> export 0..30 (31 samples).
# Run backward: authored 1..21 -> export 0..20 (21 samples), so there
# is no extra frozen 1/30-second lead-in at each new loop.
# The user's source .blend is NEVER written.
for name in ('walk','walk_backward','strafe_left','strafe_right','run_backward'):
 action=bpy.data.actions.get(name)
 if not action:raise AssertionError(f'Missing production locomotion Action: {name}')
 start=float(action.frame_range[0])
 final=float(action.frame_range[1])
 end_frame=26 if name.startswith('strafe_') else 20 if name=='run_backward' else 30
 scale=end_frame/(final-start)
 for layer in action.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for curve in bag.fcurves:
     for key in curve.keyframe_points:
      shifted=(key.co.x-start)*scale
      # Blender stores walk frame 31.25 as 31.249998. Snap only near
      # integer frames to preserve the final sample precisely.
      if abs(shifted-round(shifted))<1e-3:
       shifted=float(round(shifted))
      dx=shifted-key.co.x
      key.co.x=shifted
      key.handle_left.x+=dx
      key.handle_right.x+=dx
     curve.update()
 assert abs(action.frame_range[0])<1e-4 and abs(action.frame_range[1]-end_frame)<1e-3,(name,action.frame_range)
 print('NORMALIZED_LOCOMOTION_LOOP',name,'source_start',start,'source_end',final,
       'export_frames',end_frame,'export_duration_s',end_frame/30)
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
