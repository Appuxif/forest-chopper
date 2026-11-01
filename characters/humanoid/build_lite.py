#!/usr/bin/env python3
"""Reproducible character LOD build from CC0 MakeHuman assets.

Usage:
  blender -b --factory-startup -t 4 --python-exit-code 1 --python build_lite.py -- --kind body --gender male
  blender -b --factory-startup -t 4 --python-exit-code 1 --python build_lite.py -- --kind gear --gender male --asset clothing_shirt.glb

Only source data from CC0-licensed upstream GLBs. The new generator is original code.
"""
import argparse, json, sys, math
from pathlib import Path
import bpy

P=Path(__file__).resolve().parent
SOURCE=P/'source'
OUT=P/'lite'
OUT.mkdir(exist_ok=True)
p=argparse.ArgumentParser()
p.add_argument('--kind', choices=['body','gear'],required=True)
p.add_argument('--gender', choices=['male','female'],required=True)
p.add_argument('--asset')
p.add_argument('--face',choices=['default','angular','soft'],default='default')
args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
if args.kind=='gear' and not args.asset:
 raise ValueError('gear requires --asset')
if args.asset and Path(args.asset).name!=args.asset:
 raise ValueError('asset must be a file basename')

source = SOURCE/('humanoid-base-animated.cc0.glb' if args.kind=='body' else args.asset)
if not source.is_file():raise FileNotFoundError(source)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
print('Imported',source.name,'armature',rig.name,'meshes',len(meshes),
 'actions',[a.name for a in bpy.data.actions],flush=True)
# Explicit gender profile at source mesh resolution, baked to regular geometry.
# No 92 morphs required in game. Clothing is baked from the same gender morph.
for ob in list(meshes):
 if ob.name.startswith('Icosphere'):
  bpy.data.objects.remove(ob,do_unlink=True)
  continue
 if args.kind=='body' and ob.name in ('Teeth','Tongue'):
  bpy.data.objects.remove(ob,do_unlink=True)
  continue
 if ob.data.shape_keys:
  keys=ob.data.shape_keys.key_blocks
  basis=keys.get('Basis') or keys[0]
  weights={'gender_'+args.gender:.8}
  if args.kind=='body' and args.face=='angular':
   weights.update({'face_jaw_width_incr':.42,'face_nose_length_incr':.22,'face_cheekbones_incr':.20})
  elif args.kind=='body' and args.face=='soft':
   weights.update({'face_jaw_width_decr':.42,'face_nose_width_decr':.25,'face_lips_incr':.20})
  coords=[]
  for i,b in enumerate(basis.data):
   position=b.co.copy()
   for key_name,weight in weights.items():
    target=keys.get(key_name)
    if target is None:raise RuntimeError('Missing '+key_name+' on '+ob.name)
    position+=(target.data[i].co-b.co)*weight
   coords.append(position)
  ob.shape_key_clear()
  for v,co in zip(ob.data.vertices,coords):v.co=co
  ob.data.update()
 assert not ob.data.shape_keys,ob.name
 # Decimate only high-res surfaces; preserve eye, eyelash and brow anatomy.
 # Blender interpolates vertex weights when faces collapse, keeping skinning.
 target_ratio = ({'Body':.165, 'Eyebrows':1., 'Eyelashes':1., 'Eyes':.45}
                 if args.kind=='body' else None)
 if args.kind=='gear':
  asset=args.asset
  target_ratio=(
   .45 if asset.startswith('clothing_shirt') or asset.startswith('clothing_tshirt')
   else .35 if asset.startswith('clothing_hoodie') or asset.startswith('clothing_jacket') or asset.startswith('clothing_trenchcoat')
   else .48 if asset.startswith('clothing_jeans') or asset.startswith('clothing_shorts') or asset.startswith('clothing_skirt')
   else .32 if asset.startswith('clothing_shoes') or asset.startswith('clothing_boots')
   else .32 if asset.startswith('hair_')
   else .50)
 else:target_ratio=target_ratio.get(ob.name,1.)
 before=sum(len(p.vertices)-2 for p in ob.data.polygons)
 if target_ratio<.99:
  modifier=ob.modifiers.new('LOD1 | 10k budget · triangulation simplification','DECIMATE')
  modifier.decimate_type='COLLAPSE'
  modifier.ratio=target_ratio
  ob.modifiers.move(len(ob.modifiers)-1,0)  # decimate undeformed rest geometry before armature
  bpy.context.view_layer.objects.active=ob
  bpy.ops.object.modifier_apply(modifier=modifier.name)
 # A small outward allowance prevents the body from poking through collars
 # and shoulders after the cloth mesh has been simplified.
 if args.kind=='gear' and args.asset.startswith(('clothing_shirt','clothing_tshirt','clothing_hoodie','clothing_jacket','clothing_trenchcoat')):
  bpy.context.view_layer.update()
  for vertex in ob.data.vertices:
   vertex.co += vertex.normal * .010
  ob.data.update()
 after=sum(len(p.vertices)-2 for p in ob.data.polygons)
 print('MESH',ob.name,'tris',before,'->',after,'shape_keys',bool(ob.data.shape_keys),flush=True)
 # Preserve armature modifier, UVs and materials, but never export hidden probes.
 ob['lod_level']=1
 ob['gender']=args.gender

# Seal the open shirt cuffs, collar and hem at build time so you cannot see
# through the garment shell when looking from below or along the arms.
if args.kind=='gear' and args.asset in ('clothing_shirt.glb','clothing_tshirt.glb'):
 sys.path.insert(0,str(P))
 from seal_openings import seal_garment_openings
 for garment in list(bpy.context.scene.objects):
  if garment.type=='MESH' and garment.name.startswith('Cloth_'):
   seal_garment_openings(garment,args.gender,args.asset,P)
# Make the baked male/female silhouette and its skeleton agree. Shape keys
# deform mesh vertices but do not automatically move armature joints. Apply
# matching morph offsets to all 53 rest-pose pivots for body and equipment,
# preserving the bone hierarchy, rotations, names, weights and animation clips.
# Source GLBs remain untouched; the exported skin includes updated bind poses.
from mathutils import Vector
joints=json.loads((SOURCE/'base_body.joints.json').read_text())
gender_deltas=joints['morphs']['gender_'+args.gender]
if len(joints['bones'])!=53 or len(gender_deltas)!=53:
 raise RuntimeError('Expected morph offsets for every one of the 53 bones')
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='EDIT')
for name,base_xyz in joints['bones'].items():
 eb=rig.data.edit_bones.get(name)
 if eb is None:raise RuntimeError('Missing joint '+name)
 delta=gender_deltas[name]
 point=[base_xyz[i]+0.8*delta[i] for i in range(3)]
 target=Vector((point[0],-point[2],point[1]))
 offset=target-eb.head.copy()
 eb.head=target
 eb.tail+=offset
bpy.ops.object.mode_set(mode='OBJECT')
print('MORPH_ALIGNED_RIG',args.gender,'bones',len(joints['bones']),flush=True)

# This is deliberately Male-only: the gripping hand belongs to the Chop
# authoring pose; Female defaults keep their independent relaxed finger pose.
if args.kind=='body' and args.gender=='male':
 sys.path.insert(0,str(P))
 from tools.apply_male_finger_pose import load_finger_pose,apply_finger_pose_to_actions
 finger_pose=load_finger_pose(P/'animation/male_chop_finger_pose.json')
 channels=apply_finger_pose_to_actions(rig,finger_pose)
 assert channels==12*30*7,channels
 print('BAKED_CHOP_FINGER_POSE',len(finger_pose['finger_bones']),'bones across 12 clips',flush=True)

# Protect immutable source and select only skinned meshes + one skeleton.
bpy.ops.object.select_all(action='DESELECT')
for ob in bpy.context.scene.objects:
 if ob.type=='ARMATURE' or (ob.type=='MESH' and not ob.name.startswith('Icosphere')):
  ob.select_set(True)
bpy.context.view_layer.objects.active=rig
opts={
 'filepath':str(OUT / (((f'body_{args.gender}' if args.face=='default' else f'body_{args.gender}_{args.face}') if args.kind=='body' else f'{args.asset.removesuffix(".glb")}_{args.gender}')+'.glb')),
 'export_format':'GLB','use_selection':True,'export_skins':True,
 'export_animations':args.kind=='body',
 'export_animation_mode':'NLA_TRACKS' if args.kind=='body' else 'ACTIONS',
 'export_merge_animation':'NONE' if args.kind=='body' else 'ACTION',
 'export_yup':True,'export_apply':False,
}
# The imported glTF actions are on the skeleton's NLA tracks. The exporter
# treats them as separate named actions, instead of merging into one clip.
if args.kind=='body':
 for t in rig.animation_data.nla_tracks:t.mute=False
 rig.animation_data.action=None
bpy.ops.export_scene.gltf(**opts)
out=Path(opts['filepath'])
data=out.read_bytes()
import struct
length=struct.unpack_from('<I',data,12)[0]
gltf=json.loads(data[20:20+length])
stats={
 'asset':out.name, 'bytes':len(data),
 'meshes':len(gltf.get('meshes',[])),
 'skins':len(gltf.get('skins',[])),
 'bones':len(gltf.get('skins',[{}])[0].get('joints',[])),
 'animations':[a['name'] for a in gltf.get('animations',[])],
 'morphs':sum(len(m['primitives'][0].get('targets',[])) for m in gltf.get('meshes',[])),
 'triangles':sum(gltf['accessors'][p.get('indices',p['attributes']['POSITION'])]['count']//3
                 for m in gltf.get('meshes',[]) for p in m['primitives'])
}
print('BUILD_OK',json.dumps(stats),flush=True)
if stats['bones']!=53 or stats['morphs']!=0 or stats['skins']!=1:
 raise RuntimeError('Invalid LOD skin or morph budget')
if args.kind=='body' and len(stats['animations'])!=12:
 raise RuntimeError('Animation export failed; expected 12 separate clips')
