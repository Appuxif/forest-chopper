"""Create a three-actor animation workbench, preserving each actor's own Actions.

Run (from repo root):
  blender -b characters/humanoid/animation/humanoid_animation_workbench.blend \
    --python characters/humanoid/animation/prepare_lumberjack_workbench.py

THIS SCRIPT RUNS ONCE against a workbench that has no Lumberjack_Rig53.
It never modifies runtime body_male.glb / body_female.glb or lumberjack.glb.

Meshes of the classic character were rigidly weighted to one of 13 bones.
Transfer them analytically into the 53-bone rest pose, then bake a dedicated
'lumberjack__' Action bank from the original GLB's unique animation tracks.
This maintains the original appearance and animation poses as accurately as
possible without fabricating 40 anatomical joints / finger geometry.

Additional backwards / fall / secondary idle clips are explicitly DERIVED
starting points for manual polish; not replacements copied from the male rig.
"""
import bpy
import math
import shutil
from pathlib import Path
from collections import defaultdict
from mathutils import Vector,Matrix
from datetime import datetime

ROOT=Path(__file__).resolve().parents[3]
ANIMATION_DIR=ROOT/'characters/humanoid/animation'
WORKBENCH=ANIMATION_DIR/'humanoid_animation_workbench.blend'
LEGACY=ROOT/'lumberjack/lumberjack.glb'
FEMALE=ROOT/'characters/humanoid/game/body_female.glb'
LITE=ROOT/'characters/humanoid/lite'
TARGET_NAMES=[
 'idle','idle_breathe','idle_fidget','idle_look','walk','walk_backward',
 'run','run_backward','strafe_left','strafe_right','jump','fall','land','Chop',
]
BASE_MOTION={
 'idle':('Idle',None),'idle_breathe':('Idle',None),'idle_fidget':('Idle',None),
 'idle_look':('Idle',None),'walk':('Walk',None),'walk_backward':('Walk','reverse'),
 'run':('Run',None),'run_backward':('Run','reverse'),
 'strafe_left':('StrafeLeft',None),'strafe_right':('StrafeRight',None),
 'jump':('Jump',None),'fall':('Jump','fall'),'land':('Jump','land'),'Chop':('Chop2',None),
}
MAIN_BONE_SOURCE={
 'Root':'Root','pelvis':'Hips','spine_03':'Spine','head':'Head',
 'upperarm_l':'UpperArm.L','lowerarm_l':'Forearm.L',
 'upperarm_r':'UpperArm.R','lowerarm_r':'Forearm.R','hand_r':'Hand.R',
 'thigh_l':'Thigh.L','calf_l':'Shin.L',
 'thigh_r':'Thigh.R','calf_r':'Shin.R',
}
# New bones without a legacy counterpart follow the nearest old bone delta.
EXTRA_BONE_SOURCE={
 'spine_01':'Spine','spine_02':'Spine','neck_01':'Head',
 'clavicle_l':'UpperArm.L','clavicle_r':'UpperArm.R',
 'hand_l':'Forearm.L','foot_l':'Shin.L','ball_l':'Shin.L',
 'foot_r':'Shin.R','ball_r':'Shin.R',
}
for side,src in [('l','Forearm.L'),('r','Hand.R')]:
 for digit in ('index','middle','pinky','ring','thumb'):
  for i in (1,2,3):
   EXTRA_BONE_SOURCE[f'{digit}_{i:02}_{side}']=src
SOURCE_BONE_FOR={**MAIN_BONE_SOURCE,**EXTRA_BONE_SOURCE}
assert len(SOURCE_BONE_FOR)==53

def relocate(obj,coll):
 for old in tuple(obj.users_collection):
  old.objects.unlink(obj)
 coll.objects.link(obj)

def ensure_collection(name,parent):
 child=bpy.data.collections.get(name)
 if child is None:child=bpy.data.collections.new(name)
 if child.name not in parent.children:parent.children.link(child)
 return child

def imported(path):
 old_objs=set(bpy.data.objects)
 old_actions=set(bpy.data.actions)
 print('IMPORT_ASSET',path,flush=True)
 bpy.ops.import_scene.gltf(filepath=str(path))
 objs=[o for o in bpy.data.objects if o not in old_objs]
 actions=[a for a in bpy.data.actions if a not in old_actions]
 return objs,actions

def release_import_actions(actions):
 # Imported glTF animations are used only for the drow's source rig.
 for action in actions:
  if action.users==0:bpy.data.actions.remove(action)

def clear_actions(rig):
 if rig.animation_data:rig.animation_data_clear()
 rig.animation_data_create()

def assign_action(rig,action):
 rig.animation_data.action=action
 rig.animation_data.action_slot=action.slots[0]

def mute_nla(rig):
 if not rig.animation_data:return
 for t in rig.animation_data.nla_tracks:t.mute=True

def female_variant(male):
 parent=ensure_collection('CHARACTER · female',bpy.context.scene.collection)
 rig_coll=ensure_collection('Rig · female',parent)
 body_coll=ensure_collection('Body · female',parent)
 outfit_coll=ensure_collection('Clothes · female',parent)
 objs,acts=imported(FEMALE)
 rigs=[o for o in objs if o.type=='ARMATURE']
 assert len(rigs)==1,('female rig not unique',rigs)
 female=rigs[0]
 female.name='Female_Rig53'
 assert len(female.data.bones)==53
 relocate(female,rig_coll)
 clear_actions(female)
 for obj in objs:
  if obj.type=='MESH' and any(v.groups for v in obj.data.vertices):
   obj.name='Female.'+obj.name
   relocate(obj,body_coll)
  elif obj!=female:
   bpy.data.objects.remove(obj,do_unlink=True)
 release_import_actions(acts)
 # Clothing from authored female assets; use the same 53 bone names and rest.
 # Selected imports contain their own disposable armatures.
 for asset in ('clothing_shirt_female.glb','clothing_jeans_female.glb',
               'clothing_shoes_female.glb','hair_short02_female.glb'):
  new_objs,new_actions=imported(LITE/asset)
  for obj in new_objs:
   if obj.type!='MESH' or not any(v.groups for v in obj.data.vertices):continue
   world=obj.matrix_world.copy()
   obj.parent=female
   obj.parent_type='OBJECT'
   obj.parent_bone=''
   obj.matrix_world=world
   for mod in obj.modifiers:
    if mod.type=='ARMATURE':mod.object=female
   obj.name='Female.'+obj.name
   relocate(obj,outfit_coll)
  for obj in new_objs:
   if obj.name not in outfit_coll.objects and obj!=female:
    bpy.data.objects.remove(obj,do_unlink=True)
  release_import_actions(new_actions)
 # Same reference axe the male already has, but attached to the female
 # hand_r bone. Independent objects, shared mesh datablocks, no extra rig.
 axe_coll=ensure_collection('Axe · female (reference only)',parent)
 male_grip=bpy.data.objects['AXE_GRIP · rotate here to adjust handle']
 female_grip=male_grip.copy()
 female_grip.name='AXE_GRIP · Female'
 axe_coll.objects.link(female_grip)
 female_grip.parent=female
 female_grip.parent_type='BONE'
 female_grip.parent_bone='hand_r'
 for original in male_grip.children:
  copy=original.copy()
  copy.name=original.name.replace('· Male','· Female')
  axe_coll.objects.link(copy)
  copy.parent=female_grip
  copy.parent_type='OBJECT'
  copy.parent_bone=''
 print('FEMALE_RIG_READY',len(female.data.bones),
       'body',len(body_coll.objects),'outfit',len(outfit_coll.objects),
       'axe',len(female_grip.children),flush=True)
 return female

def legacy_bone_for_mesh(obj,src_group):
 name=obj.name
 if name=='Hand L':return 'hand_l'
 if name=='Neck':return 'neck_01'
 if name.startswith(('Boot L','Boot R','Boot lace')):
  return 'foot_l' if name.endswith('L') or (name.startswith('Boot lace.') and name[-1] in '345') else 'foot_r'
 return {
  'Root':'Root','Hips':'pelvis','Spine':'spine_03','Head':'head',
  'UpperArm.L':'upperarm_l','UpperArm.R':'upperarm_r',
  'Forearm.L':'lowerarm_l','Forearm.R':'lowerarm_r',
  'Hand.R':'hand_r','Thigh.L':'thigh_l','Thigh.R':'thigh_r',
  'Shin.L':'calf_l','Shin.R':'calf_r',
 }[src_group]

def fix_lumberjack_left_wrist_rest(rig):
 """Put actual hand_l pivot at lowerarm_l wrist instead of the male offset.

 Move the whole hand/finger rest subtree by the same amount, so the fingers
 retain their relative placement. This changes ONLY the lumberjack armature.
 The old Forearm.L drove the old solid left hand, so its skin and action
 retargeting must use the correct lowerarm_l space (below).
 """
 bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode!='OBJECT' else None
 bpy.ops.object.select_all(action='DESELECT')
 bpy.context.view_layer.objects.active=rig
 rig.select_set(True)
 bpy.ops.object.mode_set(mode='EDIT')
 eb=rig.data.edit_bones
 wrist=eb['hand_l']
 delta=eb['lowerarm_l'].tail-wrist.head
 subtree={wrist.name}
 for bone in eb:
  ancestor=bone.parent
  while ancestor:
   if ancestor.name==wrist.name:
    subtree.add(bone.name)
    break
   ancestor=ancestor.parent
 for name in subtree:
  bone=eb[name]
  bone.head+=delta
  bone.tail+=delta
 # Keep independent pose/translation channels like the standard rig;
 # head-tail positions coincide, so no positional gap remains.
 bpy.ops.object.mode_set(mode='OBJECT')
 print('LUMBERJACK_LEFT_WRIST_REST_FIXED',tuple(round(v,5) for v in delta),
       'moved_bones',len(subtree),flush=True)

def fix_lumberjack_ankle_rests(rig):
 """Join ankle and toe pivots on the old single-piece, shin-driven boots.

 Only the Lumberjack armature receives these adjustments. Both foot and ball
 joints exist in the 53-bone schema but had no independent old bone tracks.
 Their children retain their original relative rest geometry.
 """
 if bpy.context.object and bpy.context.object.mode!='OBJECT':
  bpy.ops.object.mode_set(mode='OBJECT')
 bpy.ops.object.select_all(action='DESELECT')
 bpy.context.view_layer.objects.active=rig
 rig.select_set(True)
 bpy.ops.object.mode_set(mode='EDIT')
 eb=rig.data.edit_bones
 def translate_subtree(name,delta):
  descendants={name}
  for bone in eb:
   ancestor=bone.parent
   while ancestor:
    if ancestor.name==name:
     descendants.add(bone.name)
     break
    ancestor=ancestor.parent
  for child in descendants:
   eb[child].head+=delta
   eb[child].tail+=delta
  return len(descendants)
 for side in ('l','r'):
  ankle='foot_'+side
  toe='ball_'+side
  shift_foot=eb['calf_'+side].tail-eb[ankle].head
  moved_foot=translate_subtree(ankle,shift_foot)
  shift_ball=eb[ankle].tail-eb[toe].head
  moved_ball=translate_subtree(toe,shift_ball)
  assert (eb['calf_'+side].tail-eb[ankle].head).length<1e-7
  assert (eb[ankle].tail-eb[toe].head).length<1e-7
  print('LUMBERJACK_ANKLE_REST_FIXED',side,
        'foot_shift',tuple(round(x,5) for x in shift_foot),
        'ball_shift',tuple(round(x,5) for x in shift_ball),
        'moved',moved_foot,moved_ball,flush=True)
 bpy.ops.object.mode_set(mode='OBJECT')

def transferred_body(src,tgt,meshes,body_coll):
 src_rest={b.name:src.matrix_world@b.matrix_local for b in src.data.bones}
 tgt_rest={b.name:tgt.matrix_world@b.matrix_local for b in tgt.data.bones}
 vertices_count=0
 for ob in meshes:
  if ob.name.startswith('Axe '):continue
  matrix=ob.matrix_world.copy()
  old_groups={g.index:g.name for g in ob.vertex_groups}
  weights=[]
  for v in ob.data.vertices:
   pairs=[(old_groups[g.group],g.weight) for g in v.groups if g.weight>0]
   assert len(pairs)==1,(ob.name,v.index,'unexpected vertex weights',pairs)
   weights.append((legacy_bone_for_mesh(ob,pairs[0][0]),pairs[0][0]))
  transforms={}
  for target,old in set(weights):
   # Old Hand L was 100% bound to Forearm.L. Its newly introduced hand_l
   # MUST follow lowerarm_l with no extra source-rest displacement. Baking
   # its vertices in lowerarm_l bind space preserves the original hand-to-
   # sleeve contact for Idle, Run and Chop while hand_l remains a real bone.
   # The original boot/laces were rigidly skinned to Shin.L/Shin.R.
   # To move foot bones without tearing the boot from the calf, bind the
   # mesh into its new foot group through the *calf* rest transform.
   bind_name={'hand_l':'lowerarm_l','foot_l':'calf_l','foot_r':'calf_r'}.get(target,target)
   bind=tgt_rest[bind_name]
   transforms[(target,old)]=tgt.matrix_world.inverted() @ bind @ src_rest[old].inverted() @ matrix
  for v,(target,old) in zip(ob.data.vertices,weights):
   v.co=transforms[(target,old)] @ v.co
  for mod in ob.modifiers:
   if mod.type=='ARMATURE':mod.object=tgt
  # Explicitly keep the original 58 separate meshes and materials: no art
  # simplification or geometry decimation during this fidelity-first stage.
  for group in tuple(ob.vertex_groups):ob.vertex_groups.remove(group)
  for target in sorted(set(t for t,_ in weights)):
   group=ob.vertex_groups.new(name=target)
   group.add([idx for idx,(t,_) in enumerate(weights) if t==target],1.0,'REPLACE')
  ob.parent=tgt
  ob.parent_type='OBJECT'
  ob.parent_bone=''
  ob.matrix_parent_inverse=Matrix.Identity(4)
  ob.matrix_world=tgt.matrix_world.copy()
  ob.name='Lumberjack.'+ob.name
  relocate(ob,body_coll)
  vertices_count+=len(ob.data.vertices)
 print('LUMBERJACK_TRANSFERRED',len(meshes)-2,'body parts,',vertices_count,
       'vertices, same 53-bone rig + original materials',flush=True)

def separate_axe(src,tgt,meshes,axe_coll):
 # Original axe is a 100% rigid skin to Hand.R. Convert to socket-local
 # static geometry; meshes can be visible for Chop editing and separately
 # exported as a two-piece GLB when needed.
 # Clear the duplicated male's last animated pose; otherwise the new
 # socket's parent world matrix is sampled in a non-rest pose and the
 # reference axe inherits a permanent ~1m offset throughout Chop2.
 for pb in tgt.pose.bones:
  pb.rotation_mode='QUATERNION'
  pb.matrix_basis.identity()
 bpy.context.view_layer.update()
 src_bone=src.matrix_world @ src.data.bones['Hand.R'].matrix_local
 bpy.context.scene.frame_set(0)
 bpy.context.view_layer.update()
 socket=bpy.data.objects.new('Socket.handRight · Lumberjack',None)
 axe_coll.objects.link(socket)
 socket.empty_display_type='ARROWS'
 socket.empty_display_size=.09
 socket.parent=tgt
 socket.parent_type='BONE'
 socket.parent_bone='hand_r'
 socket.matrix_parent_inverse=Matrix.Identity(4)
 socket.location=(0,0,0)
 bpy.context.view_layer.update()
 bone_rest=tgt.matrix_world@tgt.data.bones['hand_r'].matrix_local
 correction=bone_rest.inverted() @ socket.matrix_world
 for obj in meshes:
  if not obj.name.startswith('Axe '):continue
  transform=correction.inverted() @ src_bone.inverted() @ obj.matrix_world
  for v in obj.data.vertices:v.co=transform@v.co
  for mod in tuple(obj.modifiers):
   if mod.type=='ARMATURE':obj.modifiers.remove(mod)
  for group in tuple(obj.vertex_groups):obj.vertex_groups.remove(group)
  obj.parent=socket
  obj.parent_type='OBJECT'
  obj.matrix_parent_inverse=Matrix.Identity(4)
  obj.matrix_basis.identity()
  obj.name='Lumberjack.'+obj.name
  relocate(obj,axe_coll)
 print('AXE_SOCKET_READY',socket.name,'meshes',len(socket.children),flush=True)
 return socket

def make_action(name,rig,frames,samples):
 act=bpy.data.actions.new(name)
 slot=act.slots.new(id_type='OBJECT',name=rig.name)
 layer=act.layers.new('Retargeted from original Lumberjack')
 strip=layer.strips.new(type='KEYFRAME')
 bag=strip.channelbags.new(slot)
 order=['location','rotation_quaternion','scale']
 channels={'location':3,'rotation_quaternion':4,'scale':3}
 for bone in rig.data.bones:
  bone_name=bone.name
  for property in order:
   n=channels[property]
   data=samples[bone_name][property]
   assert len(data)==len(frames)
   for axis in range(n):
    fc=bag.fcurves.new(
     data_path=f'pose.bones["{bone_name}"].{property}',
     index=axis,group_name=bone_name)
    fc.keyframe_points.add(len(frames))
    coords=[v for frame,val in zip(frames,data) for v in (float(frame),float(val[axis]))]
    fc.keyframe_points.foreach_set('co',coords)
    for key in fc.keyframe_points:
     key.interpolation='LINEAR'
    fc.update()
 # Match male/female Action Editor presentation: one collapsible group
 # per bone instead of 530 ungrouped Location/Rotation/Scale channels.
 for group in bag.groups:
  group.show_expanded=False
  group.show_expanded_graph=False
 act.use_fake_user=True
 return act

def retarget_action(src,rig,source_action,destination,mode=None,
                    prefix='lumberjack__'):
 assert source_action and source_action.slots,(destination,'missing action slot')
 assign_action(src,source_action)
 # Sample at 30fps without changing the author's original duration yet.
 a,b=source_action.frame_range
 if mode=='fall':a=a+(b-a)*.35;b=source_action.frame_range[1]
 if mode=='land':a=a+(b-a)*.72;b=source_action.frame_range[1]
 steps=max(2,round(b-a))
 frames=list(range(1,steps+2))
 output={n:{'location':[],'rotation_quaternion':[],'scale':[]}
         for n in SOURCE_BONE_FOR}
 source_basis={k:v.matrix_local.copy() for k,v in src.data.bones.items()}
 target_basis={k:v.matrix_local.copy() for k,v in rig.data.bones.items()}
 bpy.context.view_layer.update() # flush changed action at the first frame
 # Source old GLB tracks are in global Blender bone coordinates.
 # A primary bone copies its full old matrix. For missing joints, pose it
 # with the transform of its closest old bone while retaining its new
 # standard rest offset. Geometry then follows the old mesh piece exactly.
 rest_root=None
 for i,out_frame in enumerate(frames):
  u=i/steps
  t=a+(b-a)*(1-u if mode=='reverse' else u)
  base=math.floor(t)
  bpy.context.scene.frame_set(base,subframe=t-base)
  bpy.context.view_layer.update()
  oldpose={name:bone.matrix.copy() for name,bone in src.pose.bones.items()}
  if rest_root is None:rest_root=oldpose['Root'].translation.copy()
  # Reverse clips must start at horizontal Root (0,0) and advance in the
  # opposite direction; an old implementation used -delta_root per frame
  # and accidentally cancelled all Root Motion while keeping Root at the
  # *end* of the forward clip. Use a fixed initial rebasing offset instead.
  offset=Matrix.Translation(Vector((-rest_root.x,-rest_root.y,0)))
  desired={}
  for bone in rig.data.bones:
   name=bone.name
   old=SOURCE_BONE_FOR[name]
   from_corrected_parent=False
   if name in ('hand_l','foot_l','foot_r','ball_l','ball_r'):
    # Original left hand: Forearm.L drives it. Original boots: Shin.L/R
    # drives the entire boot, including the sole; no independent ball
    # geometry exists. Compute all new child joints from the moving
    # parent in *target* rest space, not from a mismatched old pivot.
    parent=bone.parent.name
    assert parent in desired,(name,parent)
    pose=desired[parent]@target_basis[parent].inverted()@target_basis[name]
    from_corrected_parent=True
   elif bone.parent and bone.parent.name in desired and (
        name.startswith(('index_','middle_','pinky_','ring_','thumb_')) and
        name.endswith('_l')):
    parent=bone.parent.name
    pose=desired[parent]@target_basis[parent].inverted()@target_basis[name]
    from_corrected_parent=True
   elif name in MAIN_BONE_SOURCE:
    pose=oldpose[old].copy()
   else:
    pose=oldpose[old]@source_basis[old].inverted()@target_basis[name]
   # The new wrist/fingers already inherit the reverse-motion offset
   # through desired[parent]. Applying it twice shifts the hand 1+ meters.
   if mode=='reverse' and not from_corrected_parent:pose=offset@pose
   desired[name]=pose
  # Derive matrix_basis explicitly from desired WORLD armature-space poses.
  # Never assign pb.matrix while baking: cached Blender parent transforms
  # would leak previous-frame locations into the next key (10m arm glitches).
  for bone in rig.data.bones:
   name=bone.name
   if bone.parent:
    parent=bone.parent.name
    rest_parent_to_child=target_basis[parent].inverted()@target_basis[name]
    basis=(desired[parent]@rest_parent_to_child).inverted()@desired[name]
   else:
    basis=target_basis[name].inverted()@desired[name]
   loc,quat,scale=basis.decompose()
   previous=output[name]['rotation_quaternion']
   if previous and sum(a*b for a,b in zip(previous[-1],quat))<0:
    quat.negate() # slerp across the short arc, never 360-degree arm flips
   output[name]['location'].append(tuple(loc))
   output[name]['rotation_quaternion'].append(tuple(quat))
   output[name]['scale'].append(tuple(scale))
 act=make_action(prefix+destination,rig,frames,output)
 act['fc_source']='lumberjack.glb / '+source_action.name
 act['fc_retarget']='absolute-pose and standard-rest binding'
 act['fc_derived']=mode in {'reverse','fall','land'} or destination.startswith('idle_')
 print('LUMBERJACK_ACTION',destination,'frames',len(frames),'source',
       source_action.name,'mode',mode or 'original',flush=True)
 return act

def collect_legacy_actions(added):
 mapping={}
 for name in ('Idle','Walk','Run','StrafeLeft','StrafeRight','Jump','Chop2','Death','Chop.001'):
  found=[a for a in added if a.name==name]
  assert len(found)==1,('Old GLB action missing',name,[a.name for a in added])
  mapping[name]=found[0]
 return mapping

def variant_banks(male,female):
 copied=0
 for name in TARGET_NAMES:
  base=bpy.data.actions.get(name)
  source=name
  if name=='walk_backward':source='walk_backward'
  base=bpy.data.actions.get(source)
  assert base,('Cannot build independent male/female action',source)
  for gender in ('male','female'):
   key=gender+'__'+name
   assert not bpy.data.actions.get(key),('Duplicate',key)
   action=base.copy()
   action.name=key
   action.use_fake_user=True
   action['fc_source']='original shared workbench '+name
   copied+=1
 mute_nla(male)
 assign_action(male,bpy.data.actions['male__idle'])
 assign_action(female,bpy.data.actions['female__idle'])
 print('INDEPENDENT_MALE_FEMALE_ACTIONS',copied,flush=True)

def organize_view_layers():
 scene=bpy.context.scene
 male_container=ensure_collection('CHARACTER · male',scene.collection)
 # Preserve the original editable male rig, clothing and axe collections.
 for name in ('01 - RIG · animate bones only',
              '02 - Worn outfit · do not animate separately',
              '03 - Axe · follows hand_r'):
  coll=bpy.data.collections[name]
  if coll.name in scene.collection.children:scene.collection.children.unlink(coll)
  if coll.name not in male_container.children:male_container.children.link(coll)
 containers=['CHARACTER · male','CHARACTER · female','CHARACTER · lumberjack']
 original=scene.view_layers[0]
 original.name='EDIT · male'
 for gender in ['male','female','lumberjack']:
  view=original if gender=='male' else scene.view_layers.new(name='EDIT · '+gender)
  def traverse(layer_collection):
   if layer_collection.collection.name in containers:
    layer_collection.exclude=(layer_collection.collection.name != 'CHARACTER · '+gender)
   for child in layer_collection.children:traverse(child)
  traverse(view.layer_collection)
 print('VIEW_LAYERS',[v.name for v in scene.view_layers],flush=True)

def main():
 assert Path(bpy.data.filepath).resolve()==WORKBENCH,('Open the intended workbench first',bpy.data.filepath)
 assert bpy.data.objects.get('Lumberjack_Rig53') is None,('Already prepared. Restore previous .blend to rerun.')
 scene=bpy.context.scene
 male=bpy.data.objects['Humanoid_Rig53']
 assert len(male.data.bones)==53
 female=female_variant(male)
 legacy_parent=ensure_collection('CHARACTER · lumberjack',scene.collection)
 rig_coll=ensure_collection('Rig · lumberjack',legacy_parent)
 body_coll=ensure_collection('Body · lumberjack',legacy_parent)
 axe_coll=ensure_collection('Axe · lumberjack (reference only)',legacy_parent)
 added,oldacts=imported(LEGACY)
 source=next(o for o in added if o.type=='ARMATURE')
 source_actions=collect_legacy_actions(oldacts)
 body_parts=[o for o in added if o.type=='MESH' and any(v.groups for v in o.data.vertices)]
 ignored=[o for o in added if o.type=='MESH' and o not in body_parts]
 print('IGNORED_NON_SKINNED_GLTF_HELPERS',[o.name for o in ignored],flush=True)
 assert len(body_parts)==58,len(body_parts)
 assert sum(o.name.startswith('Axe ') for o in body_parts)==2
 rig=male.copy()
 rig.data=male.data.copy()
 rig.name='Lumberjack_Rig53'
 rig_coll.objects.link(rig)
 clear_actions(rig)
 assert len(rig.data.bones)==53
 fix_lumberjack_left_wrist_rest(rig)
 fix_lumberjack_ankle_rests(rig)
 # Correctly transfer old rigid mesh pieces into standard rest coordinates.
 transferred_body(source,rig,body_parts,body_coll)
 socket=separate_axe(source,rig,body_parts,axe_coll)
 assert len(body_coll.objects)==len(body_parts)-2
 assert len(socket.children)==2
 for name in TARGET_NAMES:
  origin,mode=BASE_MOTION[name]
  retarget_action(source,rig,source_actions[origin],name,mode)
 # Both other original Lumberjack Actions remain available as editable
 # reference clips; they are not part of the 14-clip runtime contract.
 for source_name,reference in [('Death','Death_original'),
                               ('Chop.001','Chop_alternative_original')]:
  retarget_action(source,rig,source_actions[source_name],reference,
                  prefix='REF_Lumberjack_')
 mute_nla(rig)
 assign_action(rig,bpy.data.actions['lumberjack__idle'])
 # Source rig is no longer needed for editing; imported original actions
 # remain in the source GLB and in git, never in the current workbench.
 for obj in added:
  if obj.type=='ARMATURE' or (obj.type!='MESH') or obj in ignored:
   bpy.data.objects.remove(obj,do_unlink=True)
 # Imported old Actions are kept fake-less and removed if no longer used.
 for act in oldacts:
  if act.users==0:bpy.data.actions.remove(act)
 variant_banks(male,female)
 organize_view_layers()
 scene.render.fps=30
 # Workbench starts on male in a neutral editing pose.
 scene.frame_set(1)
 bpy.context.view_layer.objects.active=male
 for obj in bpy.context.selected_objects:obj.select_set(False)
 male.select_set(True)
 assert [len(bpy.data.objects[n].data.bones) for n in
         ('Humanoid_Rig53','Female_Rig53','Lumberjack_Rig53')]==[53,53,53]
 assert all(bpy.data.actions.get('lumberjack__'+n) for n in TARGET_NAMES)
 assert all(bpy.data.actions.get('female__'+n) and bpy.data.actions.get('male__'+n) for n in TARGET_NAMES)
 # Git keeps source GLBs. A date-specific backup of the source workbench
 # remains outside the repository and is never overwritten.
 backup=Path.home()/'.local/share/forest-chopper/blender-backups'
 backup.mkdir(parents=True,exist_ok=True)
 snapshot=backup/(WORKBENCH.stem+'_before_lumberjack_20261105.blend')
 if not snapshot.exists():shutil.copy2(WORKBENCH,snapshot)
 bpy.ops.wm.save_as_mainfile(filepath=str(WORKBENCH),check_existing=False,compress=True)
 print('SAVED_SINGLE_WORKBENCH',WORKBENCH,'backup',snapshot,flush=True)
 print('COUNTS','rigs',len([ob for ob in bpy.data.objects if ob.type=='ARMATURE']),
       'lumberjack_clips',len(TARGET_NAMES),
       'view_layers',len(scene.view_layers),flush=True)

if __name__=='__main__':
 main()
