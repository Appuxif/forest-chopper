"""Static articulated chicken skeleton + deterministic skinning (Blender 5.2).
Run via My MCP Terminal or directly Blender:
 blender -b characters/hen/work/hen_low_3k.blend -t 4 --python characters/hen/scripts/rig_hen_3k.py
Rebuilds a separate .blend/.glb, preserves original LOD model and color atlas.
"""
import bpy, math, json, os
from pathlib import Path
from mathutils import Vector, Quaternion
from collections import defaultdict, Counter

HEN=Path(__file__).resolve().parents[1]
OUT=HEN/"work"
SOURCE=HEN/"source"
PREVIEWS=HEN/"previews"
for folder in (OUT,SOURCE,PREVIEWS):folder.mkdir(parents=True,exist_ok=True)
MESH=next(o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith("HEN • 3k"))
assert len(MESH.data.vertices)<6000, "Unexpected source asset"
MESH.name="Hen_3K_Skinned"
MESH.data.name="Hen_3K_Mesh"
assert len(MESH.data.materials)==10
ORIGINAL_TRIS=sum(len(p.vertices)-2 for p in MESH.data.polygons)

# Clear any old vertex groups/modifiers (script is repeatable against original LOD).
MESH.vertex_groups.clear()
for m in list(MESH.modifiers):
    MESH.modifiers.remove(m)
MESH.animation_data_clear()
MESH.parent=None

# One organic armature in the same model coordinates as the static hen.
armdata=bpy.data.armatures.new("Hen_3K_Armature")
arm=bpy.data.objects.new("Hen_Rig",armdata)
bpy.context.scene.collection.objects.link(arm)
arm.show_in_front=True
armdata.display_type="STICK"
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active=arm
arm.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")

def bone(name,head,tail,parent=None,deform=True):
    b=armdata.edit_bones.new(name)
    b.head=head
    b.tail=tail
    b.use_deform=deform
    if parent:
        b.parent=armdata.edit_bones[parent]
        b.use_connect=False
    return b

bone("Root",(0,0,0.08),(0,0,.27),deform=False)
bone("Spine",(0,.32,1.15),(0,-.13,1.18),"Root")
bone("Chest",(0,-.13,1.18),(0,-.51,1.34),"Spine")
bone("Neck.01",(0,-.50,1.33),(0,-.58,1.48),"Chest")
bone("Neck.02",(0,-.58,1.48),(0,-.675,1.645),"Neck.01")
bone("Head",(0,-.675,1.645),(0,-.785,1.73),"Neck.02")
bone("Tail.01",(0,.60,1.23),(0,.93,1.39),"Spine")
bone("Tail.02",(0,.93,1.39),(0,1.22,1.59),"Tail.01")

for side in (-1,1):
    s="L" if side==-1 else "R"
    # Wings: shoulder, elbow and feather-tip; oriented along swept-back wing.
    bone("Wing.Upper."+s,(side*.366,-.245,1.255),
         (side*.488,.112,1.15),"Chest")
    bone("Wing.Lower."+s,(side*.488,.112,1.15),
         (side*.510,.374,1.045),"Wing.Upper."+s)
    bone("Wing.Tip."+s,(side*.510,.374,1.045),
         (side*.535,.620,.95),"Wing.Lower."+s)
    # Bird leg: large feather-covered upper thigh, long tarsus, flexible toes.
    bone("Leg.Thigh."+s,(side*.205,.18,.755),
         (side*.253,.157,.53),"Spine")
    bone("Leg.Shin."+s,(side*.253,.157,.53),
         (side*.270,.115,.165),"Leg.Thigh."+s)
    bone("Leg.Foot."+s,(side*.270,.115,.165),
         (side*.270,-.045,.103),"Leg.Shin."+s)
    for j,delta in enumerate((-.15,0,.15)):
        bone("Toe."+str(j+1)+"."+s,
             (side*.270,.102,.124),
             (side*.270+delta,-.236,.063),"Leg.Foot."+s)
    bone("Toe.Rear."+s,(side*.275,.125,.14),
         (side*.366,.391,.067),"Leg.Foot."+s)

bpy.ops.object.mode_set(mode="OBJECT")
# Bone collections for Blender Pose Mode / future animation work.
rig_sections = {
    "00 | Main Controls": ["Root"],
    "01 | Spine": ["Spine", "Chest"],
    "02 | Neck & Head": ["Neck.01", "Neck.02", "Head"],
    "03 | Tail": ["Tail.01", "Tail.02"],
}
for side in ("L", "R"):
    rig_sections[f"04 | Wing.{side}"] = [f"Wing.{part}.{side}" for part in ("Upper", "Lower", "Tip")]
    rig_sections[f"06 | Leg.{side}"] = [f"Leg.{part}.{side}" for part in ("Thigh", "Shin", "Foot")] + [f"Toe.{digit}.{side}" for digit in ("1", "2", "3", "Rear")]
for section,names in rig_sections.items():
    coll=armdata.collections.new(section)
    for name in names:coll.assign(armdata.bones[name])
arm.rotation_mode="XYZ"
MESH.rotation_mode="XYZ"
MESH.parent=arm
MESH.matrix_parent_inverse=arm.matrix_world.inverted()
mod=MESH.modifiers.new("Hen_Skin","ARMATURE")
mod.object=arm
mod.use_vertex_groups=True
mod.use_bone_envelopes=False

# Character topology has separate islands for body/neck/head, two wing shells,
# 2 thigh shells, 2 shanks, eyes and sockets, 6 toe shells, claws and feathers.
# Classify connected components rather than just vertex coordinates, so a wing
# can rotate without pulling neighboring body vertices along.
n=len(MESH.data.vertices)
parent=list(range(n))
def find(x):
    while parent[x]!=x:
        parent[x]=parent[parent[x]]
        x=parent[x]
    return x
def union(a,b):
    a=find(a);b=find(b)
    if a!=b: parent[b]=a
for face in MESH.data.polygons:
    vs=face.vertices
    for v in vs[1:]: union(vs[0],v)
islands=defaultdict(list)
for v in MESH.data.vertices: islands[find(v.index)].append(v.index)
materials=defaultdict(Counter)
for face in MESH.data.polygons:
    materials[find(face.vertices[0])][face.material_index]+=1
positions={v.index: MESH.matrix_world @ v.co for v in MESH.data.vertices}
# Mesh object transforms are identity; world coordinates must agree with rest bones.
assert all(abs(t)<1e-4 for t in MESH.location),MESH.location

def smooth(a,b,x):
    t=max(0.,min(1.,(x-a)/(b-a)))
    return t*t*(3-2*t)
def normalize(d):
    d={k:max(0.,v) for k,v in d.items() if v>1e-6}
    # glTF/Three.js standard skinning uses 4 joints per vertex. Limit before
    # export to avoid silently dropping the 5th influence during conversion.
    d=dict(sorted(d.items(),key=lambda item:item[1],reverse=True)[:4])
    total=sum(d.values())
    assert total>0
    return {k:v/total for k,v in d.items()}
def name_side(x):return "L" if x<0 else "R"

# One weight dictionary per vertex.
weights={}
stats=Counter()
def write_vertex(index,d):
    weights[index]=normalize(d)

def body_weights(p):
    x,y,z=p
    fwd=-y
    front=smooth(-.16,.47,fwd)*.87
    neck=smooth(.37,.63,fwd)*smooth(1.235,1.46,z)
    head=smooth(.49,.69,fwd)*smooth(1.53,1.74,z)
    # Preserve the head as a coherent volume (eye/comb separate islands rigid).
    head=max(head, .93 if z>=1.76 and fwd>.53 else 0)
    neck_upper=smooth(1.45,1.63,z)
    return normalize({
        "Spine":(1-front)*(1-neck)*(1-head),
        "Chest":front*(1-neck)*(1-head),
        "Neck.01":neck*(1-head)*(1-neck_upper),
        "Neck.02":neck*(1-head)*neck_upper,
        "Head":head,
    })

def wing_weights(p,side):
    x,y,z=p
    t=smooth(-.17,.50,y)
    tip=smooth(.38,.61,y)
    fold=smooth(-.08,.34,y)
    return normalize({
        "Wing.Upper."+side:1-fold,
        "Wing.Lower."+side:fold*(1-tip),
        "Wing.Tip."+side:fold*tip,
    })

def thigh_weights(p,side):
    z=p.z
    hip=smooth(.705,.83,z)*.28
    knee=(1-smooth(.50,.61,z))*.18
    return normalize({
        "Spine":hip,
        "Leg.Thigh."+side:1-hip-knee,
        "Leg.Shin."+side:knee,
    })

def shin_weights(p,side):
    top=smooth(.46,.58,p.z)*.28
    foot=1-smooth(.157,.25,p.z)
    return normalize({
        "Leg.Thigh."+side:top*(1-foot),
        "Leg.Shin."+side:(1-top)*(1-foot),
        "Leg.Foot."+side:foot,
    })

def tail_weights(p):
    t=smooth(.85,1.24,p.y)
    return {"Tail.01":1-t,"Tail.02":t}

def toe_name(centroid,side,category):
    if category=="toe_rear": return "Toe.Rear."+side
    cx=centroid.x
    # x positions of 3 forward toes, including matching claws:
    # left [-.34,-.27,-.20], right [+.34,+.27,+.20].
    refs=[(.27+.07)*(-1 if side=="L" else 1),
          .27*(-1 if side=="L" else 1),
          (.27-.07)*(-1 if side=="L" else 1)]
    idx=min(range(3),key=lambda j:abs(refs[j]-cx))
    return "Toe."+str(idx+1)+"."+side

for root,idxs in islands.items():
    verts=[positions[i] for i in idxs]
    centroid=sum(verts,Vector())/len(verts)
    mat=materials[root].most_common(1)[0][0]
    x,y,z=centroid
    side=name_side(x)
    vcount=len(idxs)
    # 0 plumage, 1 leg, 2 claw, 3-8 head details, 9 comb/wattles.
    if vcount>380 and mat==0:
        kind="body"
    elif mat==0 and vcount>=90 and abs(x)>.32 and .88<z<1.4:
        kind="wing"
    elif mat==0 and .50<z<.89 and abs(x)>.10 and y>0:
        kind="thigh"
    elif mat==0 and y>.73 and z>1.29:
        kind="tail"
    elif mat==0 and abs(x)>.48 and .86<z<1.24:
        kind="wing"
    elif mat==1 and z>.22:
        kind="shin"
    elif mat==1 and y>.13 and z<.22:
        kind="toe_rear"
    elif mat==1 and z<.22:
        kind="toe"
    elif mat==2 and y>.15: kind="toe_rear"
    elif mat==2: kind="toe"
    elif mat in (3,4,5,6,7,8,9) and y<-.27:
        kind="head"
    else:
        raise RuntimeError("UNCLASSIFIED ISLAND "+str((vcount,mat,tuple(round(v,3) for v in centroid))))
    stats[kind]+=1
    for idx in idxs:
        p=positions[idx]
        if kind=="body": d=body_weights(p)
        elif kind=="wing": d=wing_weights(p,side)
        elif kind=="thigh": d=thigh_weights(p,side)
        elif kind=="tail": d=tail_weights(p)
        elif kind=="shin": d=shin_weights(p,side)
        elif kind=="head": d={"Head":1.}
        else: d={toe_name(centroid,side,kind):1.0}
        write_vertex(idx,d)

assert len(weights)==n,(len(weights),n)
# Create groups for all deform bones, including toes with no geometry as necessary.
groups={}
for b in arm.data.bones:
    if b.use_deform:groups[b.name]=MESH.vertex_groups.new(name=b.name)
assignments=defaultdict(lambda:defaultdict(list))
for idx,values in weights.items():
    for bn,w in values.items():
        if w>.00001:
            assignments[bn][round(w,5)].append(idx)
for bn,by_weight in assignments.items():
    assert bn in groups, bn
    for w,idxs in by_weight.items():
        groups[bn].add(idxs,w,"REPLACE")
# GLB normalizes weights; quantization before add differs max 0.00005.
print("ISLANDS",len(islands),"kinds",dict(stats),"bone groups used",len(assignments),flush=True)
print("VERTICES",n,"FACES",len(MESH.data.polygons),"TRIS",ORIGINAL_TRIS,"BONES",len(arm.data.bones),flush=True)

# Make bones visible through plumage for artist/animator; no keyframes.
arm.show_in_front=True
armdata.display_type="OCTAHEDRAL"
armdata.show_names=False
for pb in arm.pose.bones:
    pb.rotation_mode="XYZ"

# Save rig in rest pose and GLB with animation explicitly disabled.
out=OUT/"hen_low_3k_rigged"
glb=SOURCE/"hen_low_3k_rigged.glb"
scene=bpy.context.scene
scene.frame_set(1)
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
MESH.select_set(True)
bpy.context.view_layer.objects.active=arm
export_path=str(glb)
bpy.ops.export_scene.gltf(filepath=export_path,
                          export_format="GLB",use_selection=True,
                          export_animations=False,export_skins=True)
# Use rest position, so the asset opens exactly like the old LOD.
arm.data.pose_position="POSE"
for pb in arm.pose.bones:pb.rotation_euler=(0.,0.,0.)
MESH.select_set(False)
arm.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.wm.save_as_mainfile(filepath=str(out)+".blend")
print("SAVED_RIG",str(out)+".blend",glb,flush=True)

# Pose deformation verification: flex all principal chains then measure
# evaluated positions of selected mesh vertices, NOT just bone rotations.
samples={}
# Each isolated category supports a deterministic in-mesh vertex sample.
for kind in ("body","wing","thigh","tail","shin","head","toe"):
    candidates=[]
    for root,idxs in islands.items():
        root_idx=idxs[0]
        # representative category from weight groups on its first vertex
        ws=weights[root_idx]
        if kind=="body" and "Spine" in ws:candidates.append(root_idx)
        elif kind=="wing" and any(k.startswith("Wing.") for k in ws):candidates.append(root_idx)
        elif kind=="thigh" and any(k.startswith("Leg.Thigh.") for k in ws):candidates.append(root_idx)
        elif kind=="tail" and any(k.startswith("Tail.") for k in ws):candidates.append(root_idx)
        elif kind=="shin" and any(k.startswith("Leg.Shin.") for k in ws):candidates.append(root_idx)
        elif kind=="head" and ws=={"Head":1.}:candidates.append(root_idx)
        elif kind=="toe" and any(k.startswith("Toe.") for k in ws):candidates.append(root_idx)
    if candidates:samples[kind]=candidates[0]
def eval_position(vid):
    dg=bpy.context.evaluated_depsgraph_get()
    ev=MESH.evaluated_get(dg)
    eva=ev.to_mesh()
    result=ev.matrix_world @ eva.vertices[vid].co
    ev.to_mesh_clear()
    return result
orig={key:eval_position(v) for key,v in samples.items()}
# Pose rotations relative to each bone's own rest frame; these angles exercise the rig.
changes={
    "Neck.01":(math.radians(8),0,math.radians(9)),
    "Neck.02":(math.radians(-6),math.radians(6),0),
    "Head":(0,0,math.radians(-12)),
    "Wing.Upper.L":(0,math.radians(-42),math.radians(-16)),
    "Wing.Lower.L":(0,math.radians(18),0),
    "Wing.Upper.R":(0,math.radians(42),math.radians(16)),
    "Wing.Lower.R":(0,math.radians(-18),0),
    "Tail.01":(0,math.radians(15),math.radians(9)),
    "Leg.Thigh.L":(math.radians(24),0,0),
    "Leg.Shin.L":(math.radians(-14),0,0),
    "Leg.Foot.L":(math.radians(10),0,0),
    "Toe.2.L":(math.radians(14),0,0),
    "Spine":(math.radians(4),0,0),
}
for bn,rot in changes.items():
    assert bn in arm.pose.bones
    arm.pose.bones[bn].rotation_euler=rot
bpy.context.view_layer.update()
now={key:eval_position(v) for key,v in samples.items()}
deltas={k:round((now[k]-orig[k]).length,4) for k in samples}
print("POSE_DISPLACEMENTS_METERS",deltas,flush=True)
assert max(deltas.values())>.025,"Skin does not move under rig!"
# Render a posed example without storing action or exporting animation.
scene.render.filepath=str(PREVIEWS/"hen_low_3k_rigged_pose_preview.png")
scene.render.resolution_percentage=80
bpy.ops.render.render(write_still=True)
# Restore true rest pose; avoid saving pose into .blend and corrupting export.
for pb in arm.pose.bones:pb.rotation_euler=(0.,0.,0.)
bpy.context.view_layer.update()
for key,idx in samples.items():
    assert (eval_position(idx)-orig[key]).length<.0001,("failed pose reset",key)
scene.render.resolution_percentage=100
bpy.context.view_layer.objects.active=arm
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.select_all(action="DESELECT")
bpy.ops.wm.save_as_mainfile(filepath=str(out)+".blend")
print("VERIFIED: rest pose restored; no actions; rig GLB exported",flush=True)
