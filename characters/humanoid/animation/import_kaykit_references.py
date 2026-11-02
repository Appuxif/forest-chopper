"""Retarget KayKit CC0 animation references onto Humanoid_Rig53 without altering authored actions.

Usage:
 blender -b humanoid_animation_workbench.blend --python import_kaykit_references.py -- \
   --output /path/to/preview.blend --cache /tmp/forest-mocap-source

Source: https://kaylousberg.itch.io/kaykit-character-animations (CC0)
Mirror: https://github.com/NoLimitNexus/game-models/tree/main/library/animations
The downloaded third-party clips are input data; only the retargeted actions are saved.
"""
import argparse
import hashlib
import math
import sys
import urllib.request
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector, Matrix

BASE_URL = 'https://raw.githubusercontent.com/NoLimitNexus/game-models/main/library/animations/Rig_Medium_'
# Pin the upstream source files used for the reviewed CC0 workbench references.
PACK_SHA256 = {
 'CombatMelee':'2cc84b175da9b1e4351cb53de9752fb068c50bb9b673fe00df9a53a97311e31d',
 'General':'aa111549e09ce0cc2a0f0092911ed83d5e4bf91807c2106339b44bde45d163d5',
 'MovementAdvanced':'9f068c75f18c3810b8a3f5679b2f7ae189a78a08edd6de341c69c1e377407edf',
 'MovementBasic':'f4601166eeac557c84ca50bfa4e24614aae0124c73e2bee488b1a9b4d327ee06',
 'Tools':'c66ad83f46ab8e1550b7c58d7fafc59005d1683daba79fcb5d103f4c1339721c',
}
# (source pack, source clip, destination Action, role)
CLIPS = [
 ('MovementBasic','Walking_A','REF_KayKit_Walk_A','walk'),
 ('MovementBasic','Walking_B','REF_KayKit_Walk_B','walk'),
 ('MovementBasic','Walking_C','REF_KayKit_Walk_C','walk'),
 ('MovementBasic','Running_A','REF_KayKit_Run_A','run'),
 ('MovementBasic','Running_B','REF_KayKit_Run_B','run'),
 ('MovementAdvanced','Running_Strafe_Left','REF_KayKit_Run_StrafeLeft','run_strafe'),
 ('CombatMelee','Melee_1H_Attack_Chop','REF_KayKit_Attack_Axe1H','attack'),
 ('CombatMelee','Melee_2H_Attack_Chop','REF_KayKit_Attack_Axe2H','attack'),
 ('CombatMelee','Melee_1H_Attack_Slice_Diagonal','REF_KayKit_Attack_Diagonal','attack'),
 ('CombatMelee','Melee_1H_Attack_Slice_Horizontal','REF_KayKit_Attack_Horizontal','attack'),
 ('Tools','Chopping','REF_KayKit_Chopping_Loop','axe_chopping'),
 ('Tools','Chop','REF_KayKit_Chop_Sequence','axe_chopping'),
 ('Tools','Sawing','REF_KayKit_Sawing_Loop','sawing'),
 ('Tools','Hammering','REF_KayKit_Hammering_Loop','hammering'),
 ('Tools','Working_A','REF_KayKit_Work_Bench_A','crafting'),
 ('Tools','Working_B','REF_KayKit_Work_Bench_B','crafting'),
 ('Tools','Working_C','REF_KayKit_Work_Bench_C','crafting'),
 ('General','Use_Item','REF_KayKit_Use_Item','use_item'),
 ('General','Use_Item','REF_Experimental_Eat_HandToMouth','eat_derived'),
]
MAPPING = {
 'root':'Root','hips':'pelvis','spine':'spine_01','chest':'spine_03',
 'head':'head',
 'upperarm.l':'upperarm_l','lowerarm.l':'lowerarm_l','wrist.l':'hand_l',
 'upperarm.r':'upperarm_r','lowerarm.r':'lowerarm_r','wrist.r':'hand_r',
 'upperleg.l':'thigh_l','lowerleg.l':'calf_l','foot.l':'foot_l','toes.l':'ball_l',
 'upperleg.r':'thigh_r','lowerleg.r':'calf_r','foot.r':'foot_r','toes.r':'ball_r',
}


def fetch(cache, pack):
 path=cache / f'KayKit_{pack}.glb'
 if not path.exists():
  req=urllib.request.Request(BASE_URL+pack+'.glb',headers={'User-Agent':'ForestChopper-AnimationResearch'})
  path.parent.mkdir(parents=True,exist_ok=True)
  path.write_bytes(urllib.request.urlopen(req,timeout=25).read())
 if path.stat().st_size<10_000 or path.read_bytes()[:4]!=b'glTF' or hashlib.sha256(path.read_bytes()).hexdigest()!=PACK_SHA256[pack]:
  raise ValueError(f'Unexpected source GLB content or version: {path}')
 return path


def import_pack(path):
 existing_obj=set(bpy.data.objects)
 existing_act=set(bpy.data.actions)
 bpy.ops.import_scene.gltf(filepath=str(path))
 rigs=[o for o in set(bpy.data.objects)-existing_obj if o.type=='ARMATURE']
 if len(rigs)!=1:raise RuntimeError(f'Expected one imported rig in {path}, got {len(rigs)}')
 arm=rigs[0]
 animations={}
 for a in set(bpy.data.actions)-existing_act:
  base=a.name
  if base.endswith('.001') or base.endswith('.002') or base.endswith('.003'):
   base=base.rsplit('.',1)[0]
  animations[base]=a
 return arm,animations,list(set(bpy.data.objects)-existing_obj)


def smoothstep(x):
 x=min(1,max(0,x));return x*x*(3-2*x)


def aim_hand_at_mouth(rig,weight):
 """Optional approximate CCD for the eating preview: position right fist near mouth."""
 if weight<=0:return
 mouth=Vector((-0.065,-0.155,1.535))
 hand=rig.pose.bones['hand_r']
 chain=[rig.pose.bones['lowerarm_r'],rig.pose.bones['upperarm_r']]
 before={p.name:p.rotation_quaternion.copy() for p in chain}
 for _ in range(9):
  for pb in chain:
   bpy.context.view_layer.update()
   pivot=pb.head.copy();cursor=hand.head.copy()
   u=cursor-pivot;v=mouth-pivot
   if u.length<1e-4 or v.length<1e-4:continue
   delta=u.rotation_difference(v)
   if delta.angle>0.35:delta=Quaternion((1,0,0,0)).slerp(delta,0.35/delta.angle)
   old=pb.matrix.copy()
   transform=Matrix.Translation(pivot) @ delta.to_matrix().to_4x4() @ Matrix.Translation(-pivot)
   pb.matrix=transform @ old
 for p in chain:
  result=p.rotation_quaternion.copy()
  p.rotation_quaternion=before[p.name].slerp(result,weight)
 bpy.context.view_layer.update()


def add_bulk_curve(bag,path,values,frames):
 for axis in range(len(values[0])):
  fc=bag.fcurves.new(path,index=axis)
  coords=[]
  for x,v in zip(frames,values):coords.extend([float(x),float(v[axis])])
  fc.keyframe_points.add(len(frames))
  fc.keyframe_points.foreach_set('co',coords)
  # Linear resampling avoids auto-Bezier overshooting on quick foot strikes.
  for key in fc.keyframe_points:key.interpolation='LINEAR'
  fc.update()


def make_action(rig,source_rig,source_action,dest_name,role,scene,baseline):
 for pb in rig.pose.bones:pb.rotation_mode='QUATERNION'
 for pb in source_rig.pose.bones:pb.rotation_mode='QUATERNION'
 arm=source_rig.animation_data
 if arm is None:source_rig.animation_data_create();arm=source_rig.animation_data
 arm.action=source_action
 arm.action_slot=next(s for s in source_action.slots if s.target_id_type=='OBJECT')
 # Disable the workbench animation for sampling, so the new motion is the only
 # control source for the 53-bone target while we calculate its pose.
 rig.animation_data.action=None
 bounds=tuple(source_action.frame_range)
 length=bounds[1]-bounds[0]
 n=max(3,round(length)+1)
 frames=list(range(1,n+1))
 samples={name:[] for name in rig.pose.bones.keys()}
 locations={name:[] for name in ('Root','pelvis')}
 rests={
  tgt:(source_rig.data.bones[src].matrix_local.to_quaternion(),rig.data.bones[tgt].matrix_local.to_quaternion())
  for src,tgt in MAPPING.items()
 }
 for i,frame in enumerate(frames):
  t=i/(n-1)
  source_frame=bounds[0]+length*t
  scene.frame_set(math.floor(source_frame),subframe=source_frame-math.floor(source_frame))
  bpy.context.view_layer.update()
  for pb in rig.pose.bones:
   pb.location=(0,0,0)
   pb.rotation_quaternion=baseline[pb.name]
  for src,tgt in MAPPING.items():
   srcpb=source_rig.pose.bones[src]
   sq,tq=rests[tgt]
   # Convert the source animation's bone-local rotation through each rig's
   # rest-space orientation (T-pose source vs A-pose target).
   src_q=srcpb.matrix_basis.to_quaternion()
   # KayKit's extra handslot/hand joints are intentionally not imported.
   # The wrist drives our palm; original finger curls stay independent.
   target_q=tq.inverted() @ sq @ src_q @ sq.inverted() @ tq
   rig.pose.bones[tgt].rotation_quaternion=target_q.normalized()
  # KayKit locomotion is generally in-place. Preserve any genuine root
  # translation separately so a variant can be examined for root motion.
  scale=1.15
  for src,tgt in [('root','Root'),('hips','pelvis')]:
   srcp=source_rig.pose.bones[src].location
   rig.pose.bones[tgt].location=srcp*scale
  bpy.context.view_layer.update()
  if role=='eat_derived':
   eating=smoothstep((t-.14)/.23)*(1-smoothstep((t-.73)/.20))
   aim_hand_at_mouth(rig,eating)
  for pb in rig.pose.bones:
   samples[pb.name].append(tuple(pb.rotation_quaternion))
  for name in locations:
   locations[name].append(tuple(rig.pose.bones[name].location))
 # Create Blender 4.4+/5.x slotted Action with bulk keyframes.
 a=bpy.data.actions.new(dest_name)
 a.use_fake_user=True
 a['license']='CC0-1.0'
 a['source']='KayKit Character Animations, by Kay Lousberg'
 a['source_url']='https://kaylousberg.itch.io/kaykit-character-animations'
 a['source_action']=source_action.name.rsplit('.',1)[0] if source_action.name.endswith(('.001','.002','.003')) else source_action.name
 a['role']=role
 a['notes']='Retargeted 23-bone KayKit Rig_Medium onto Forest Chopper 53-bone rest pose; workbench comparison only.'
 if role=='eat_derived':a['notes']='Experimental approximation derived from CC0 KayKit Use_Item plus procedural hand-to-mouth reach; not original source mocap.'
 slot=a.slots.new('OBJECT',rig.name)
 layer=a.layers.new('Reference')
 strip=layer.strips.new(type='KEYFRAME')
 bag=strip.channelbag(slot,ensure=True)
 # Key mapped bones at each frame; non-mapped bones at endpoints only.
 mapped=set(MAPPING.values())
 for name,quats in samples.items():
  if name not in mapped:
   quats=[quats[0],quats[-1]]
   key_frames=[1,n]
  else:key_frames=frames
  add_bulk_curve(bag,f'pose.bones["{name}"].rotation_quaternion',quats,key_frames)
 for name,values in locations.items():
  add_bulk_curve(bag,f'pose.bones["{name}"].location',values,frames)
 print('IMPORTED_REF',a.name,'frames',len(frames),'keys',sum(len(fc.keyframe_points) for fc in bag.fcurves),'role',role,flush=True)
 return a


def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--output',required=True)
 parser.add_argument('--cache',default='/tmp/forest-mocap-source')
 parser.add_argument('--only',nargs='*',default=None,help='Destination action names to import')
 args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 rig=bpy.data.objects.get('Humanoid_Rig53')
 if not rig or rig.type!='ARMATURE':raise RuntimeError('Humanoid_Rig53 missing')
 originals={x.name for x in bpy.data.actions}
 assert 'run' in originals and 'walk' in originals and 'Chop' in originals
 scene=bpy.context.scene
 # Save the idle finger curl before importing source actions.
 existing_action=rig.animation_data.action
 existing_slot=rig.animation_data.action_slot
 rig.animation_data.action=bpy.data.actions['idle']
 slot=next(s for s in rig.animation_data.action.slots if s.target_id_type=='OBJECT')
 rig.animation_data.action_slot=slot
 scene.frame_set(1)
 bpy.context.view_layer.update()
 baseline={p.name:p.rotation_quaternion.copy() for p in rig.pose.bones}
 to_import=[x for x in CLIPS if not args.only or x[2] in args.only]
 if not to_import:raise ValueError('No actions matched')
 for pack in sorted({row[0] for row in to_import}):
  src_rig,actions,objects=import_pack(fetch(Path(args.cache),pack))
  try:
   for _,src_name,dest_name,role in (row for row in to_import if row[0]==pack):
    if dest_name in bpy.data.actions:bpy.data.actions.remove(bpy.data.actions[dest_name])
    source=actions.get(src_name)
    if not source:raise KeyError(f'{pack}: source action {src_name!r} missing, available {list(actions)}')
    make_action(rig,src_rig,source,dest_name,role,scene,baseline)
  finally:
   for obj in objects:
    bpy.data.objects.remove(obj,do_unlink=True)
   for action in actions.values():
    if action.name in bpy.data.actions:bpy.data.actions.remove(action)
   print('SOURCE_PACK_REMOVED',pack,flush=True)
 # Keep original current animation selection and frame.
 rig.animation_data.action=existing_action
 if existing_action:rig.animation_data.action_slot=existing_slot
 scene.frame_set(1)
 # Do not keep imported source rigs, meshes or actions in final .blend.
 missing=originals - {x.name for x in bpy.data.actions}
 if missing:raise RuntimeError('Original actions were lost: '+str(missing))
 actual=[x.name for x in bpy.data.actions if x.name.startswith('REF_')]
 assert len(actual)==len(to_import),(len(actual),len(to_import))
 output=Path(args.output)
 output.parent.mkdir(parents=True,exist_ok=True)
 bpy.ops.wm.save_as_mainfile(filepath=str(output))
 print('RETARGET_SUCCESS',output,'new_actions',len(actual),'total',len(bpy.data.actions),flush=True)

if __name__=='__main__':main()
