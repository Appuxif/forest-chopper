"""Export isolated 53-bone Lumberjack preview and separate socket-ready axe.

Run from the repository root:
 blender -b characters/humanoid/animation/humanoid_animation_workbench.blend \
   --python-exit-code 1 \
   --python characters/humanoid/animation/export_lumberjack_preview.py

This runs in a disposable Blender process and NEVER saves/modifies .blend.
The preview is for validating bone/Action layout; timing and Root Motion will
be standardized in the later asset-normalization stage.
"""
from pathlib import Path
import bpy,json,struct

ROOT=Path(__file__).resolve().parents[3]
PREVIEW=ROOT/'characters/humanoid/animation/preview/body_lumberjack_retarget.glb'
AXE=ROOT/'lumberjack/lumberjack_axe.glb'
RIG='Lumberjack_Rig53'
PREFIX='lumberjack__'

def deselect():
 for o in bpy.context.selected_objects:o.select_set(False)

def export(path,objects,animated=True):
 path.parent.mkdir(parents=True,exist_ok=True)
 deselect()
 for ob in objects:
  assert ob.name in bpy.context.view_layer.objects,('Hidden object',ob.name)
  ob.select_set(True)
 bpy.context.view_layer.objects.active=objects[0]
 bpy.ops.export_scene.gltf(
  filepath=str(path),export_format='GLB',use_selection=True,
  export_skins=animated,export_animations=animated,
  export_animation_mode='ACTIONS',export_merge_animation='NONE',
  export_force_sampling=True,export_yup=True,
 )
 assert path.exists() and path.stat().st_size>1000,path
 with path.open('rb') as f:
  assert f.read(4)==b'glTF'
  f.seek(12)
  size,tag=struct.unpack('<II',f.read(8))
  gltf=json.loads(f.read(size))
 print('ASSET_EXPORTED',path,'bytes',path.stat().st_size,
  'skins',[(len(s.get('joints',[]))) for s in gltf.get('skins',[])],
  'meshes',len(gltf.get('meshes',[])),
  'animations',[a['name'] for a in gltf.get('animations',[])],flush=True)
 return gltf

def normalize_strafe_export_samples():
 """Export strafe at the same 26/30s as male/female runtime GLB.

 Workbench strafe Actions are 26.25 frames = 0.875s (same as the other
 variants' authoring files). The male/female exporter compresses this to
 exactly 26 *integer* frames, because glTF animation sampling uses 30Hz.
 Do so only in this disposable exporter process; never save the workbench.
 """
 for name in ('strafe_left','strafe_right'):
  action=bpy.data.actions[name]
  start,end=action.frame_range
  assert abs((end-start)-26.25)<1e-3,(name,action.frame_range)
  scale=26/(end-start)
  for layer in action.layers:
   for strip in layer.strips:
    for bag in strip.channelbags:
     for curve in bag.fcurves:
      for key in curve.keyframe_points:
       key.co.x=(key.co.x-start)*scale
       key.handle_left.x=(key.handle_left.x-start)*scale
       key.handle_right.x=(key.handle_right.x-start)*scale
      curve.update()
  assert abs(action.frame_range[0])<1e-3 and abs(action.frame_range[1]-26)<1e-3
  print('NORMALIZED_STRAFE_EXPORT',name,'duration_s',26/30,flush=True)


def main():
 scene=bpy.context.scene
 if bpy.context.window:
  bpy.context.window.view_layer=scene.view_layers['EDIT · lumberjack']
 rig=bpy.data.objects[RIG]
 # Only export this actor's Action bank. Workbench Actions stay untouched on disk.
 for action in list(bpy.data.actions):
  if not action.name.startswith(PREFIX):bpy.data.actions.remove(action)
 for action in bpy.data.actions:action.name=action.name.removeprefix(PREFIX)
 normalize_strafe_export_samples()
 for track in rig.animation_data.nla_tracks:track.mute=True
 action=bpy.data.actions['idle']
 rig.animation_data.action=action
 rig.animation_data.action_slot=action.slots[0]
 scene.frame_set(1)
 body=[o for o in bpy.context.view_layer.objects
       if o.type=='MESH' and o.name.startswith('Lumberjack.') and
       not o.name.startswith(('Lumberjack.Axe blade','Lumberjack.Axe handle'))]
 assert len(body)==56,len(body)
 result=export(PREVIEW,[rig,*body],animated=True)
 bones={result['nodes'][i]['name'] for i in result['skins'][0]['joints']}
 assert len(bones)==53,len(bones)
 assert len(result['animations'])==14,[a['name'] for a in result['animations']]
 # Isolate static axe geometry under a neutral pivot, not a 53-joint
 # skeleton; its local axes match Socket.handRight in the workbench.
 socket=bpy.data.objects['Socket.handRight · Lumberjack']
 pivot=bpy.data.objects.new('AXE_GRIP',None)
 scene.collection.objects.link(pivot)
 pivot.location=(0,0,0)
 copies=[]
 for original in socket.children:
  clone=original.copy()
  clone.data=original.data.copy()
  clone.name=original.name.replace('Lumberjack.','')
  scene.collection.objects.link(clone)
  clone.parent=pivot
  clone.parent_type='OBJECT'
  clone.parent_bone=''
  clone.matrix_parent_inverse.identity()
  clone.matrix_basis.identity()
  copies.append(clone)
 axe_result=export(AXE,[pivot,*copies],animated=False)
 assert len(axe_result.get('skins',[]))==0
 assert len(axe_result.get('animations',[]))==0
 assert len(axe_result.get('meshes',[]))==2
 print('PREVIEW_SUCCESS: 53 bones, 14 own Actions, independent static axe',flush=True)

if __name__=='__main__':main()
