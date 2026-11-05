"""Add an editable <=2000-triangle crescent axe variant to the same .blend.

The 34 original High Poly parts and materials are kept unchanged. Two
toggleable Blender collections contain independent High and Low models.
High and Low grips share the original attachment transform; size is set
to match an 0.81 m handle (original authored length ~1.06 m).

Run: blender -b characters/humanoid/weapons/crescent_axe.blend \
 --python-exit-code 1 --python characters/humanoid/weapons/create_crescent_lowpoly.py
"""
import bpy
import json
import struct
import os
import sys
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[3]
BLEND=Path(os.environ.get('FC_CRESCENT_BLEND',
     ROOT/'characters/humanoid/weapons/crescent_axe.blend')).resolve()
HIGH_GLB=Path(os.environ.get('FC_CRESCENT_HIGH_GLB',
     ROOT/'characters/humanoid/game/axe_crescent.glb')).resolve()
LOW_GLB=Path(os.environ.get('FC_CRESCENT_LOW_GLB',
     ROOT/'characters/humanoid/weapons/axe_crescent_low.glb')).resolve()
assert Path(bpy.data.filepath).resolve()==BLEND
high=bpy.data.objects.get('AXE_GRIP_CRESCENT')
assert high and len(high.children)==34
assert high.get('crescent_head_flipped_180')
assert not any('Blade | sweeping razor edge' in o.name for o in high.children)

# Idempotent: only one named Low Poly collection, and geometry stays separate
# from the authored High Poly meshes/curves/materials.
existing=bpy.data.collections.get('02 | Crescent axe LOW (<2000 triangles)')
if existing:
 for o in list(existing.objects):
  bpy.data.objects.remove(o,do_unlink=True)
 bpy.data.collections.remove(existing)

high_collection=next(c for c in high.users_collection if 'CRESCENT AXE' in c.name or 'Crescent axe HIGH' in c.name)
high_collection.name='01 | Crescent axe HIGH (original detail)'
high_collection.hide_viewport=False
high_collection.hide_render=False
for o in [high,*high.children]:o.hide_set(False)
target_scale=.81/1.06
high.scale=(target_scale,)*3
high['handle_target_m']=.81

low_collection=bpy.data.collections.new('02 | Crescent axe LOW (<2000 triangles)')
bpy.context.scene.collection.children.link(low_collection)
low=bpy.data.objects.new('AXE_GRIP_CRESCENT_LOW',None)
low_collection.objects.link(low)
low.matrix_basis=high.matrix_basis.copy()
low.empty_display_type='SPHERE'
low.empty_display_size=.025
low['source_high_poly']='AXE_GRIP_CRESCENT'
low['handle_target_m']=.81

def tube_mesh(obj,original_rings,original_sides,new_rings,new_sides):
 old=obj.data
 assert len(old.vertices)==original_rings*original_sides,(obj.name,len(old.vertices),original_rings,original_sides)
 xyz=[v.co.copy() for v in old.vertices]
 vertices=[]
 for row in range(new_rings):
  original_row=round(row*(original_rings-1)/(new_rings-1))
  for col in range(new_sides):
   original_col=round(col*original_sides/new_sides)%original_sides
   vertices.append(xyz[original_row*original_sides+original_col])
 faces=[tuple(reversed(range(new_sides)))]
 for row in range(new_rings-1):
  for col in range(new_sides):
   next_col=(col+1)%new_sides
   faces.append((row*new_sides+col,row*new_sides+next_col,
     (row+1)*new_sides+next_col,(row+1)*new_sides+col))
 faces.append(tuple((new_rings-1)*new_sides+col for col in range(new_sides)))
 mesh=bpy.data.meshes.new(obj.name+' | custom low rings')
 mesh.from_pydata(vertices,[],faces)
 mesh.update()
 for material in old.materials:mesh.materials.append(material)
 for idx,poly in enumerate(mesh.polygons):
  poly.use_smooth=idx!=0 and idx!=len(mesh.polygons)-1
 obj.data=mesh
 bpy.data.meshes.remove(old)
 return 2*new_rings*new_sides-4

def decimate(obj,ratio):
 modifier=obj.modifiers.new('Optimized faceted geometry','DECIMATE')
 modifier.decimate_type='COLLAPSE'
 modifier.ratio=ratio
 modifier.use_collapse_triangulate=True

# Which curves need curvature and how much? Each is still a faithful
# stylized gold/silver/ash material line, but the high-res bevel rings
# are replaced by a lean 4-sided section and 1-2 segments per Bezier.
curve_quality={
 'Etched gold':2,
 'Hollow grind':2,
 'Forged spine':2,
 'Ash grain':1,
}
mesh_counts={
 'Handle | sculpted dark ash':(22,16,9,8),
 'Grip | rich dark leather':(17,16,8,8),
 'Grip | spiral leather lacing':(151,7,31,4),
 'Head | blackened forged socket':(9,18,6,8),
}
for o in sorted(high.children,key=lambda x:x.name):
 copy=o.copy()
 copy.data=o.data.copy()
 low_collection.objects.link(copy)
 copy.parent=low
 copy.matrix_basis=o.matrix_basis.copy()
 copy.name=o.name+' | LOW'
 copy['variant']='Low Poly'
 # Preserve machine bevels on the main blade and both concave panels,
 # where outlines and highlights are visually important.
 if copy.type=='CURVE':
  copy.data.resolution_u=next((quality for key,quality in curve_quality.items() if o.name.startswith(key)),1)
  copy.data.render_resolution_u=copy.data.resolution_u
  copy.data.bevel_resolution=0
 elif copy.type=='MESH':
  original_name=o.name
  params=mesh_counts.get(original_name)
  if params:
   copy.modifiers.clear()
   tube_mesh(copy,*params)
  elif any(original_name.startswith(key) for key in (
    'Grip | lower brass collar','Grip | upper brass collar',
    'Head | etched ring','Head | silver inlay',
    'Pommel | cast brass lower rim','Pommel | polished narrow pin')):
   copy.modifiers.clear()
   tube_mesh(copy,2,16,2,8)
  elif original_name.startswith('Grip | brass stud'):
   decimate(copy,.26)
  elif original_name.startswith('Socket rivets'):
   decimate(copy,.24)
  elif original_name.startswith('Pommel | inset on end'):
   decimate(copy,.3)
  elif original_name.startswith('Poll | compact hammered'):
   # Keep the full beveled small blade: reducing this 136-triangle detail
   # to ~16 triangles opens a visible gap below the forged socket.
   pass

# glTF can export the *base* mesh for a DECIMATE modifier, especially if
# the modifier is excluded by its exporter settings. Bake reductions
# into copies so saved .blend and low GLB have the same real triangle count.
for part in low.children:
 if part.type!='MESH':continue
 for mod in list(part.modifiers):
  if mod.type!='DECIMATE':continue
  bpy.ops.object.select_all(action='DESELECT')
  part.select_set(True)
  bpy.context.view_layer.objects.active=part
  bpy.ops.object.modifier_apply(modifier=mod.name)

def count_evaluated(root):
 deps=bpy.context.evaluated_depsgraph_get()
 total=0
 by={}
 for obj in root.children:
  evaluated=obj.evaluated_get(deps)
  if obj.type not in {'MESH','CURVE'}:continue
  mesh=evaluated.to_mesh()
  n=sum(max(0,len(poly.vertices)-2) for poly in mesh.polygons)
  evaluated.to_mesh_clear()
  by[obj.name]=n
  total+=n
 return total,by

# Recenter the wooden assembly onto the forged head, while preserving
# the original small lower blade so its root blends into the socket.
sys.path.insert(0,str(Path(__file__).resolve().parent))
from low_crescent_alignment import refine_low_variant
refine_low_variant(high,low)

bpy.context.view_layer.update()
low_total,details=count_evaluated(low)
print('LOW_TRI_INITIAL',low_total,'PARTS',sorted(details.items(),key=lambda x:-x[1])[:13],flush=True)

# If a Blender version changes the curve bevel tessellation, trim only
# secondary decoration before impacting the silhouette.
if low_total>1950:
 for key in ('Hollow grind','Etched gold','Forged spine'):
  for o in low.children:
   if o.type=='CURVE' and o.name.startswith(key):
    o.data.resolution_u=1
    o.data.render_resolution_u=1
  bpy.context.view_layer.update()
  low_total,details=count_evaluated(low)
  print('LOW_TRI_TUNED',key,low_total,flush=True)
  if low_total<=1950:break
if low_total>1950:
 for key in ('Grip | spiral leather lacing','Handle | sculpted dark ash'):
  for o in low.children:
   if o.type=='MESH' and o.name.startswith(key):
    decimate(o,.75)
  bpy.context.view_layer.update()
  low_total,details=count_evaluated(low)
  print('LOW_TRI_TUNED',key,low_total,flush=True)
  if low_total<=1950:break

assert 1000<=low_total<=2000,('low polygon budget not satisfied',low_total)
print('LOW_TRI_FINAL',low_total,'HIGH_PARTS',len(high.children),'LOW_PARTS',len(low.children),flush=True)

def export(root,path):
 # select_all does not clear selected objects in an eye-hidden collection!
 # Explicitly unselect every object (including hidden HIGH) so the two GLBs
 # never end up containing the other variant's 34 meshes.
 for obj in bpy.data.objects:
  obj.select_set(False)
 for o in [root,*root.children]:
  o.hide_set(False)
  o.select_set(True)
 bpy.context.view_layer.objects.active=root
 bpy.ops.export_scene.gltf(
  filepath=str(path),export_format='GLB',use_selection=True,
  export_yup=True,export_normals=True,export_materials='EXPORT',
  export_animations=False,export_skins=False,
  export_cameras=False,export_lights=False)
 raw=path.read_bytes()
 length=struct.unpack_from('<I',raw,12)[0]
 doc=json.loads(raw[20:20+length])
 triangle_count=sum(doc['accessors'][p['indices']]['count']//3
                    for mesh in doc['meshes'] for p in mesh['primitives'])
 print('EXPORTED',path,'TRIANGLES',triangle_count,'MESHES',len(doc['meshes']),flush=True)
 return triangle_count,doc

high_total,high_doc=export(high,HIGH_GLB)
assert high_total==21156,high_total
low_export_total,low_doc=export(low,LOW_GLB)
assert low_export_total<=2000,(low_export_total,low_total)
assert not any('Blade | sweeping razor edge' in n.get('name','') for n in low_doc['nodes'])
assert any(n.get('name')=='AXE_GRIP_CRESCENT_LOW' for n in low_doc['nodes'])
assert all(abs(v-target_scale)<1e-5 for n in low_doc['nodes']
           if n.get('name')=='AXE_GRIP_CRESCENT_LOW' for v in n.get('scale',[]))
assert all(abs(v-target_scale)<1e-5 for n in high_doc['nodes']
           if n.get('name')=='AXE_GRIP_CRESCENT' for v in n.get('scale',[]))

# Present LOW as the visible variant in the same scene. Toggling
# collections in Outliner reveals the editable High without duplicates.
bpy.ops.object.select_all(action='DESELECT')
# Global Collection.hide_viewport disables the whole collection and greys
# it out in Outliner. Instead use the per-ViewLayer *eye* visibility, so
# the user can toggle HIGH/LOW by clicking the eyes in Outliner.
high_collection.hide_viewport=False
high_collection.hide_render=True
low_collection.hide_viewport=False
low_collection.hide_render=False
for view_layer in bpy.context.scene.view_layers:
 high_layer=view_layer.layer_collection.children.get(high_collection.name)
 low_layer=view_layer.layer_collection.children.get(low_collection.name)
 assert high_layer and low_layer
 high_layer.exclude=False
 low_layer.exclude=False
 high_layer.hide_viewport=True
 low_layer.hide_viewport=False
low.select_set(True)
bpy.context.view_layer.objects.active=low
# Hide non-model studio lights from viewport without removing them
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':
   space=area.spaces.active
   space.shading.type='MATERIAL'
   space.overlay.show_floor=False
   space.overlay.show_relationship_lines=False
   space.overlay.show_extras=False
   space.overlay.show_cursor=False
   space.overlay.show_axis_x=False
   space.overlay.show_axis_y=False
   space.region_3d.view_distance=1.18
   space.region_3d.view_location=low.matrix_world.translation
# Keep import/export oriented grip intact and use existing camera preview.
bpy.context.scene.render.filepath=str(ROOT/'characters/humanoid/weapons/crescent_axe_low_preview.png')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND),compress=True)
print('BLEND_SAVED',BLEND,'HIGH_TRI',high_total,'LOW_TRI',low_export_total,
      'BOTH_HANDLE_M',.81,flush=True)
