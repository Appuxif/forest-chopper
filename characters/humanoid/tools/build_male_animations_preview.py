#!/usr/bin/env python3
"""Prepare an optional inspection-only workbench with Male clips and the Chop axe.

Open via:
 blender -b characters/humanoid/animation/male_chop_workbench_final.blend \\
   --python characters/humanoid/tools/build_male_animations_preview.py

Does not modify the original Chop workbench or game GLBs.
"""
import bpy
from pathlib import Path

BASE=Path(__file__).resolve().parents[1]
source=BASE/'lite/body_male.glb'
output=BASE/'animation/male_animations_with_axe_preview.blend'
rig=bpy.data.objects['Male_Rig53']
chop=rig.animation_data.action
assert chop and chop.name=='FC_Male_Chop'
grip=next(o for o in bpy.data.objects if o.name.startswith('AXE_GRIP'))
assert grip.parent==rig and grip.parent_bone=='hand_r'

original_objects=set(bpy.data.objects)
bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode!='OBJECT' else None
bpy.ops.import_scene.gltf(filepath=str(source))
new_objects=set(bpy.data.objects)-original_objects
imported_rigs=[o for o in new_objects if o.type=='ARMATURE']
assert len(imported_rigs)==1,[o.name for o in imported_rigs]
imported=imported_rigs[0]
actions={}
for track in imported.animation_data.nla_tracks:
 for strip in track.strips:
  actions[strip.action.name]=strip.action
assert len(actions)==12,actions.keys()

# Delete the duplicate imported armature and body, retaining only actions.
for ob in new_objects:
 bpy.data.objects.remove(ob,do_unlink=True)

# New file has accessible animations in the NLA editor. Keep tracks muted by
# default; choose an Action in the Action Editor to inspect it independently.
for track in list(rig.animation_data.nla_tracks):
 rig.animation_data.nla_tracks.remove(track)
for name,action in actions.items():
 action.use_fake_user=True
 track=rig.animation_data.nla_tracks.new()
 track.name='Preview · '+name
 strip=track.strips.new(name,1,action)
 track.mute=True

rig.animation_data.action=chop
rig.animation_data.action_slot=chop.slots[0]
bpy.context.scene.frame_set(1)
text=bpy.data.texts.get('PREVIEW - All Male Animations') or bpy.data.texts.new('PREVIEW - All Male Animations')
text.clear()
text.write('''MALE ANIMATIONS + AXE PREVIEW
=============================
This is a separate inspection copy, not the source Chop workbench.
The 12 stock Male clips are loaded from the production body_male.glb
and already contain the exact 30-finger pose from frame 1 of FC_Male_Chop.
Their wrist/elbow/arm motion is otherwise unmodified.

To preview another animation:
1. Select Male_Rig53 (Pose Mode).
2. In the Dope Sheet / Action Editor choose 'walk', 'run', etc.
3. Set the timeline range to the clip's frame range.
4. Press Space to preview. AXE_GRIP follows the right hand.

NLA tracks are muted by default to avoid blending multiple animations.
Source Chop file: animation/male_chop_workbench_final.blend
The axe is a prop only and is NOT in any exported GLB.
''')
bpy.ops.wm.save_as_mainfile(filepath=str(output),compress=True)
print('AXE_ALL_ANIMATIONS_PREVIEW_OK',output,'clips',len(actions),'axe',grip.parent_bone,'bytes',output.stat().st_size)
