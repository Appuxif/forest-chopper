# Procedural high-poly realistic russet hen, static / no rig.
# Run in Blender 5.x: exec(compile(open(__file__).read(),__file__,'exec'))
import bpy, math, random, os
from mathutils import Vector
from math import sin, cos, pi, sqrt
from pathlib import Path
rng = random.Random(20261104)
HEN=Path(__file__).resolve().parents[1]
OUT = str(HEN/"work")   # temporary rebuild stage, not the authoritative hen.blend
os.makedirs(OUT, exist_ok=True)

# Fresh dedicated scene, so generated assets remain clean.
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for c in list(bpy.data.collections):
    if c.name.startswith("HEN |") or c.name.startswith("STUDIO |"):
        bpy.data.collections.remove(c)
chicken_col = bpy.data.collections.new("HEN | high-poly static")
bpy.context.scene.collection.children.link(chicken_col)
studio_col = bpy.data.collections.new("STUDIO | render only")
bpy.context.scene.collection.children.link(studio_col)

def move_col(obj, coll=chicken_col):
    for c in list(obj.users_collection): c.objects.unlink(obj)
    coll.objects.link(obj)
    return obj

def material(name, rgb, rough=.8, sheen=.0, bump=.0, metallic=0.0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*rgb,1.0)
    m.use_nodes=True
    n=m.node_tree.nodes; n.clear()
    output=n.new("ShaderNodeOutputMaterial")
    bs=n.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Base Color"].default_value=(*rgb,1)
    bs.inputs["Roughness"].default_value=rough
    bs.inputs["Metallic"].default_value=metallic
    if "Sheen Weight" in bs.inputs: bs.inputs["Sheen Weight"].default_value=sheen
    m.node_tree.links.new(bs.outputs["BSDF"],output.inputs["Surface"])
    if bump>0:
        tex=n.new("ShaderNodeTexNoise"); tex.inputs["Scale"].default_value=95
        tex.inputs["Detail"].default_value=3; tex.inputs["Roughness"].default_value=.65
        bn=n.new("ShaderNodeBump");bn.inputs["Strength"].default_value=bump
        bn.inputs["Distance"].default_value=.006
        m.node_tree.links.new(tex.outputs["Fac"],bn.inputs["Height"])
        m.node_tree.links.new(bn.outputs["Normal"],bs.inputs["Normal"])
    return m

m_body=material("01 • Russet brown plumage",(.20,.075,.030),.89,.3,.20)
m_feather=[material("Feather • chestnut",(.27,.105,.042),.83,.38,.31),
           material("Feather • cinnamon",(.31,.137,.055),.84,.4,.31),
           material("Feather • copper",(.23,.069,.029),.84,.35,.28),
           material("Feather • autumn gold",(.43,.235,.108),.86,.41,.28),
           material("Feather • deep brown",(.155,.050,.026),.81,.33,.28),
           material("Feather • pale buff",(.41,.24,.119),.88,.42,.27)]
m_neck=[material("Hackle • amber",(.44,.228,.074),.82,.42,.32),
        material("Hackle • ochre",(.30,.115,.043),.87,.38,.32),
        material("Hackle • honey",(.50,.29,.124),.85,.4,.32),
        material("Hackle • dark stripe",(.16,.045,.019),.82,.35,.32)]
m_tail=[material("Tail • umber black",(0.058,.046,.043),.68,.36,.28),
        material("Tail • iridescent graphite",(0.078,.103,.098),.62,.42,.28),
        material("Tail • dark mahogany",(0.17,.068,.037),.75,.36,.26)]
m_comb=material("Comb and wattles • carmine",(.47,.009,.015),.47,.12,.23)
m_comb_light=material("Comb • rim coral",(.58,.028,.031),.47,.1,.18)
m_orbit=material("Eye socket • dusky red",(0.36,.065,.039),.65,.04,.07)
m_iris=material("Eyes • ochre amber",(.29,.127,.020),.27,.0,.02)
m_pupil=material("Eyes • glossy black",(0.009,.008,.006),.075,0,.0)
m_catch=material("Eyes • catch light",(0.94,.94,.88),.11,0,.0)
m_beak=material("Beak • bone ochre",(.52,.365,.155),.48,0,.12)
m_beak_lower=material("Beak • lower horn",(0.47,.31,.12),.58,0,.08)
m_nostril=material("Nostrils",(0.115,.069,.028),.83)
m_legs=material("Feet • golden ochre",(0.65,.39,.093),.79,.0,.26)
m_scales=material("Feet • scale ridges",(0.83,.56,.19),.8,0,.18)
m_claws=material("Claws • warm ivory",(.54,.50,.37),.55,0,.12)

def uv(name, loc, scale, mat, seg=48, rings=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,location=loc)
    ob=bpy.context.object;ob.name=name
    ob.scale=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    ob.data.materials.append(mat);move_col(ob)
    for p in ob.data.polygons:p.use_smooth=True
    return ob

# Full, plump, anatomically plausible body; volume joins hidden by individual feathers.
parts=[
 uv("Core | breast", (0,-.20,1.08),(.48,.56,.49),m_body,64,48),
 uv("Core | rump", (0,.36,1.13),(.51,.52,.46),m_body,64,48),
 uv("Core | dewlap", (0,-.49,1.17),(.32,.30,.40),m_body,48,32),
 uv("Core | neck", (0,-.57,1.43),(.228,.228,.37),m_body,48,32),
 uv("Core | head", (0,-.69,1.665),(.185,.19,.18),m_body,64,48)
]
bpy.ops.object.select_all(action="DESELECT")
for o in parts:o.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.join()
core=bpy.context.object
core.name="HEN • organic continuous body and head"
core.data.remesh_voxel_size=.020
bpy.ops.object.voxel_remesh()
sm=core.modifiers.new("Relax anatomy","SMOOTH");sm.factor=1.4;sm.iterations=5
bpy.context.view_layer.objects.active=core
bpy.ops.object.modifier_apply(modifier=sm.name)
for p in core.data.polygons:p.use_smooth=True

# Mesh batches: thousands of curved, independent feather vanes, only a few draw calls.
class Batch:
    def __init__(self): self.d={}
    def feather(self, material, a,b, side, normal, width, bend=.01, segments=12, across=6, sweep=0):
        a,b,side,normal=map(Vector,(a,b,side,normal))
        side.normalize();normal.normalize()
        verts,faces=self.d.setdefault(material.name,[[],[]])
        base=len(verts)
        for i in range(segments+1):
            t=i/segments
            fade=max(.007, sin(pi*(.03+.95*t))**.62) * (1-t*.18)
            c=a.lerp(b,t)+normal*(bend*sin(pi*t))+side*(sweep*t*t)
            for j in range(across+1):
                u=2*j/across-1
                ridge=.004*(1-abs(u)) + .006*(1-u*u)*sin(pi*t)
                serrate=(.0012*sin(16*pi*t+u*4)+.0009*sin(25*pi*t-u*8))*abs(u)
                verts.append(tuple(c+side*(u*width*fade+serrate)+normal*ridge))
        for i in range(segments):
            for j in range(across):
                k=base+i*(across+1)+j
                faces.append((k,k+1,k+1+(across+1),k+(across+1)))
    def flush(self):
        results=[]
        for name,(verts,faces) in self.d.items():
            mesh=bpy.data.meshes.new("Individual feather vane geometry")
            mesh.from_pydata(verts,[],faces);mesh.update()
            ob=bpy.data.objects.new("Feathers | "+name,mesh)
            chicken_col.objects.link(ob)
            mesh.materials.append(bpy.data.materials[name])
            for poly in mesh.polygons:poly.use_smooth=True
            results.append(ob)
        print("Feather batches",len(results),"feather quads",sum(len(o.data.polygons) for o in results))
        return results
batch=Batch()

# Body coordinate system: forward = -Y, side = X. Chest is full, rump raised.
def skin_raycast(origin,direction):
    mat=core.matrix_world
    inv=mat.inverted()
    ok,point,n,tri=core.ray_cast(inv @ Vector(origin),(inv.to_3x3() @ Vector(direction)).normalized(),distance=2.5)
    if ok:
        return mat @ point, (mat.to_3x3() @ n).normalized()
    return None,None

def body_surface(y,phi,inflate=.009):
    direct=Vector((cos(phi),0,sin(phi))).normalized()
    p,n=skin_raycast((0,y,1.11),direct)
    if p is None:
        yn=max(-.94,min(.94,(y-.04)/.85))
        f=sqrt(max(.03,1-yn*yn))
        n=direct
        p=Vector((.49*f*cos(phi),y,1.11+.46*f*sin(phi)))
    return p+n*inflate,n

# Dense fine plumage follows the REAL remeshed skin surface instead of a guessed ellipsoid.
for row in range(23):
    yy=-.62+row*.061
    for k in range(62):
        phi=2*pi*(k+(row%2)*.5)/62 + rng.uniform(-.020,.020)
        p,n=body_surface(yy,phi,.012)
        dy=rng.uniform(.075,.112)
        dphi=(-1 if cos(phi)>=0 else 1)*rng.uniform(.025,.07)
        q,_=body_surface(min(.87,yy+dy),phi+dphi,.015)
        side=Vector((-sin(phi),0,cos(phi))).normalized()
        color=rng.choices(m_feather,weights=[43,22,29,2,4,0.4])[0]
        batch.feather(color,p,q,side,n,rng.uniform(.021,.033),
                      bend=.006,segments=10,across=6,sweep=rng.uniform(-.006,.006))

# Overlapping breast feathers face forwards, cascading from throat toward abdomen.
for zi in range(20):
    z=.735+zi*.035
    for xi in range(30):
        x=-.400+xi*.028
        if (x/.455)**2+((z-1.04)/.47)**2>1.0:continue
        p,n=skin_raycast((x,-.37,z),Vector((0,-1,0)))
        q,n2=skin_raycast((x*.998,-.37,z-.086),Vector((0,-1,0)))
        if p is None or q is None or p.y>-.47:continue
        start=p+n*.013;end=q+n*.015
        batch.feather(rng.choices(m_feather,weights=[38,26,21,6,8,1])[0],
                      start,end,Vector((1,0,0)),Vector((0,-1,0)),
                      rng.uniform(.020,.027),bend=.004,segments=11,across=6)

# Neck hackles: long, overlapping pointed plumage around vertical tapered neck.
def neck_surface(z,phi):
    direct=Vector((cos(phi),sin(phi),0)).normalized()
    p,n=skin_raycast((0,-.57,z),direct)
    if p is None:
        t=(z-1.2)/.42
        p=Vector(((.25-.03*t)*cos(phi),-.57+(.24-.03*t)*sin(phi),z))
        n=direct
    return p,n
for row in range(14):
    zz=1.58-row*.030
    for i in range(42):
        phi=2*pi*(i+(row%2)*.5)/42+rng.uniform(-.025,.025)
        p,n=neck_surface(zz,phi)
        q,_=neck_surface(max(1.13,zz-rng.uniform(.095,.14)),phi+rng.uniform(-.065,.065))
        side=Vector((-sin(phi),cos(phi),0))
        col=rng.choices(m_neck,weights=[45,30,19,6])[0]
        batch.feather(col,p+n*.012,q+n*.014,side,n,rng.uniform(.015,.027),bend=.009,segments=12,across=6)

# Head cap tiny feathers (keep eyes, beak and comb unobscured).
for i in range(210):
    zz=rng.uniform(1.65,1.795)
    ang=rng.uniform(0,2*pi)
    # rear crown mostly
    if sin(ang)<-.35:continue
    height=(zz-1.67)/.206
    r=.195*sqrt(max(.05,1-height*height))
    p=Vector((r*cos(ang),-.69+r*sin(ang),zz))
    n=Vector((cos(ang),sin(ang),.23)).normalized()
    q=p+Vector((0,.045,-.016))
    batch.feather(rng.choice(m_feather[:3]),p+n*.012,q+n*.015,Vector((1,0,0)),n,rng.uniform(.008,.012),bend=.004,segments=7,across=4)

# Wings: teardrop bases for coherent silhouette, hundreds of overlapping coverts.
for sign in (-1,1):
    wing=uv(("R" if sign==1 else "L")+" • wing musculature",
            (sign*.432,.062,1.150),(.058,.438,.180),m_feather[0],56,40)
    wing.rotation_euler[0]=-.16
    # large outer flight and covert feathers
    for i in range(26):
        f=i/25
        y=-.29+f*.72
        x=sign*(.476+.020*sin(pi*f))
        z=1.110-.125*f
        a=Vector((x,y,z))
        b=Vector((sign*(.500+.033*f),y+.24+.13*f,z-.15-.035*f))
        n=Vector((sign,0,.13))
        side=Vector((0,.38,.925))
        col=rng.choices(m_feather,weights=[40,23,24,1,11,1])[0]
        batch.feather(col,a,b,side,n,.038+.014*f,bend=.026,segments=15,across=8)
    # Shingle rows of feather coverts: the visible signature of real plumage.
    for row in range(7):
        for i in range(15):
            f=(i+.25*(row%2))/15
            y=-.36+f*.79
            z=1.30-row*.049-(max(0,f-.48)*.07)
            x=sign*(.476+.027*sin(pi*max(.05,min(.93,f))))
            a=Vector((x,y,z))
            b=Vector((x+sign*.010,y+rng.uniform(.12,.20),z-rng.uniform(.035,.09)))
            side=Vector((0,.35,.94))
            color=rng.choices(m_feather,weights=[40,25,24,1,9,1])[0]
            batch.feather(color,a,b,side,Vector((sign,0,.05)),
                          .037+rng.uniform(-.006,.006),bend=.011,segments=11,across=6)

# Compact upright tail fan: charcoal flight feathers rise behind the rump.
for layer in range(3):
    for i in range(23):
        f=(i-11)/11
        spread=abs(f)
        a=Vector((f*.16,.81-layer*.04,1.31+layer*.022))
        b=Vector((f*(.30+layer*.013),1.24+.11*(1-spread)-layer*.045,
                   1.71-.20*spread-.065*layer))
        col=rng.choices(m_tail,weights=[54,30,16])[0]
        batch.feather(col,a,b,Vector((.22,0,.975)),Vector((0,.82,.36)),
                      .071+.026*(1-spread),bend=.021,segments=18,across=8,sweep=.009*f)
batch.flush()

# Smooth tapered tubes: legs, toes, delicate horn claws.
def tube(name, points, radii, mat, sides=14, subdivisions=3):
    pp=list(map(Vector,points));assert len(pp)==len(radii)
    verts=[];faces=[]
    # interpolate centerline with Catmull-Rom to avoid kinked chicken toes
    ps=[];rs=[]
    for i in range(len(pp)-1):
        for j in range(subdivisions):
            t=j/subdivisions
            p0=pp[max(0,i-1)];p1=pp[i];p2=pp[i+1];p3=pp[min(len(pp)-1,i+2)]
            p=.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t)
            ps.append(p);rs.append(radii[i]*(1-t)+radii[i+1]*t)
    ps.append(pp[-1]);rs.append(radii[-1])
    for i,p in enumerate(ps):
        tang=(ps[min(i+1,len(ps)-1)]-ps[max(i-1,0)]).normalized()
        axis=Vector((1,0,0)) if abs(tang.x)<.8 else Vector((0,1,0))
        u=tang.cross(axis).normalized();v=tang.cross(u).normalized()
        for k in range(sides):
            angle=2*pi*k/sides
            verts.append(tuple(p+rs[i]*(u*cos(angle)+v*sin(angle))))
    for i in range(len(ps)-1):
        for k in range(sides):
            n=i*sides+k; j=i*sides+(k+1)%sides
            faces.append((n,j,j+sides,n+sides))
    faces.append(tuple(reversed(range(sides))))
    base=(len(ps)-1)*sides
    faces.append(tuple(range(base,base+sides)))
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
    ob=bpy.data.objects.new(name,me);chicken_col.objects.link(ob);me.materials.append(mat)
    for p in me.polygons:p.use_smooth=True
    return ob

# Two independently modeled feet; toes with realistic splay and backward hallux.
for s in (-1,1):
    x=s*.252
    uv("Feathery thigh "+str(s),(x*.78,.17,.657),(.088,.118,.145),m_body,40,32)
    tube("Tarsometatarsus "+str(s),
         [(x,.20,.56),(x*1.02,.145,.38),(x*1.07,.115,.165)],
         [.070,.055,.049],m_legs,20,8)
    # raised scale ridges around leg anterior surface; small overlapping tiles
    for row in range(17):
        t=row/17
        zz=.19+t*.34
        yy=.118+.09*t
        for k in range(5):
            a=(k-2)*.023
            uv("Shank scale", (x*1.05+a,yy-.044,zz+.004*(k%2)),(.018,.007,.013),m_scales,12,8)
    ankle=Vector((x*1.07,.112,.155))
    for toe,side in enumerate((-.12,0,.12)):
        dest=Vector((x*1.07+side,.112- (.30 if toe==1 else .255),.055))
        mid=ankle.lerp(dest,.46)+Vector((0,-.009,-.047))
        tip=dest+Vector((side*.16,-.044,-.003))
        tube("Front toe %s:%s"%(s,toe),
             [ankle,mid,dest,tip],
             [.045,.041,.031,.019],m_legs,14,5)
        tube("Front claw %s:%s"%(s,toe),
             [tip,tip+Vector((side*.20,-.035,.021)),tip+Vector((side*.25,-.088,-.010))],
             [.023,.018,.0015],m_claws,12,6)
        for j in range(6):
            pp=mid.lerp(dest,j/6)
            uv("Toe scale",pp+Vector((0,-.005,.027)),(.030,.016,.007),m_scales,10,6)
    # Backward 4th toe
    p=ankle+Vector((s*.046,.125,-.065))
    q=p+Vector((s*.047,.090,-.03))
    tube("Hallux "+str(s),[ankle,p,q],[.036,.029,.014],m_legs,14,7)
    tube("Rear claw "+str(s),[q,q+Vector((0,.065,.017)),q+Vector((0,.109,-.003))],
         [.018,.012,.001],m_claws,12,6)

# Head: realistic beak, nostrils and two independently inset eyes.
# Axis -Y, tapered almond-shaped upper and lower horny mandibles.
def beak_mesh(name, yy, zz, lengths, mat):
    rings=[];sides=20
    for (y,halfwidth,halfheight,zc) in lengths:
        rings.append((y,halfwidth,halfheight,zc))
    verts=[];faces=[]
    for y,rx,rz,z in rings:
        for k in range(sides):
            a=2*pi*k/sides
            verts.append((rx*cos(a),y,z+rz*sin(a)))
    for i in range(len(rings)-1):
        for k in range(sides):
            j=i*sides+k
            faces.append((j,i*sides+(k+1)%sides,(i+1)*sides+(k+1)%sides,j+sides))
    faces.append(tuple(reversed(range(sides))))
    base=(len(rings)-1)*sides
    faces.append(tuple(range(base,base+sides)))
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces)
    ob=bpy.data.objects.new(name,me);chicken_col.objects.link(ob)
    me.materials.append(mat)
    for p in me.polygons:p.use_smooth=True
    return ob
beak_mesh("Upper beak • curved horny tip",-.86,1.60,
          [(-.858,.081,.041,1.604),(-.924,.076,.040,1.598),
           (-.985,.050,.028,1.583),(-1.047,.011,.011,1.557),
           (-1.055,.002,.002,1.555)],m_beak)
beak_mesh("Lower beak • jaw",-.87,1.545,
          [(-.863,.076,.027,1.554),(-.925,.067,.021,1.546),
           (-.986,.044,.013,1.548),(-1.052,.002,.002,1.554)],m_beak_lower)
for s in (-1,1):
    # Eyes inset into lateral skull, not cartoon stalks.
    nor=Vector((s*.96,-.25,.05)).normalized()
    center=Vector((s*.139,-.813,1.687))
    uv("Eye socket",center+nor*.005,(.034,.032,.032),m_orbit,40,28)
    uv("Wet black eye",center+nor*.014,(.024,.024,.024),m_pupil,40,28)
    uv("Amber iris",center+nor*.029,(.015,.015,.016),m_iris,40,28)
    uv("Dark pupil",center+nor*.040,(.010,.010,.010),m_pupil,40,28)
    uv("Corneal glint",center+nor*.046+Vector((0,-.004,.009)),
       (.004,.004,.004),m_catch,16,12)
    # nostril is a dark recessed oval on the lateral beak root
    uv("Naris / nostril", (s*.065,-.910,1.642),(.009,.012,.006),m_nostril,20,12)
    # Lobe behind the eye
    uv("Earlobe red",(s*.171,-.629,1.566),(.016,.027,.032),m_comb,32,24)
    # loose pendant skin flaps
    uv("Fleshy wattle",(s*.057,-.831,1.430),(.039,.043,.101),m_comb,48,32)
    uv("Wattle tip",(s*.060,-.852,1.362),(.034,.037,.040),m_comb,32,24)

# Comb serrations as one thick sculpted surface; rises along crown, neither flat nor cones.
outline=[(-.931,1.767),(-.933,1.853),(-.908,1.922),(-.872,2.012),
(-.830,1.897),(-.793,1.940),(-.749,2.068),(-.700,1.923),
(-.652,1.970),(-.612,2.098),(-.569,1.944),(-.514,1.964),
(-.464,2.067),(-.426,1.932),(-.378,1.941),(-.327,2.003),
(-.291,1.878),(-.251,1.842),(-.285,1.774),(-.420,1.764),
(-.655,1.774),(-.832,1.758)]
# Catmull-Rom subdivisions soften the six comb lobes like flexible skin.
control=list(outline)
smooth_outline=[]
for i in range(len(control)):
    p0=control[(i-1)%len(control)];p1=control[i]
    p2=control[(i+1)%len(control)];p3=control[(i+2)%len(control)]
    for j in range(4):
        t=j/4
        smooth_outline.append(tuple(.5*((2*p1[k])+(-p0[k]+p2[k])*t+
                             (2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t*t+
                             (-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t*t*t)
                             for k in (0,1)))
outline=smooth_outline
# closed contour: bevelled thick rounded caps via bevelled solid mesh
v=[];f=[]
for xx in (-.027,.027):
    for yy,zz in outline:v.append((xx,yy,zz))
n=len(outline)
for i in range(n):j=(i+1)%n;f.append((i,j,j+n,i+n))
f.append(tuple(reversed(range(n))));f.append(tuple(range(n,2*n)))
me=bpy.data.meshes.new("Biological 6-point comb");me.from_pydata(v,[],f);me.update()
comb=bpy.data.objects.new("Single upright 6-point comb",me)
chicken_col.objects.link(comb);me.materials.append(m_comb)
bevel=comb.modifiers.new("Organic rounded edges","BEVEL")
bevel.width=.019;bevel.segments=4
comb.modifiers.new("Soft normals","WEIGHTED_NORMAL")
for p in me.polygons:p.use_smooth=True

# Studio preview only. Does not export to GLB.
grey=material("Studio • matte neutral warm grey",(.23,.225,.21),.96)
bpy.ops.mesh.primitive_plane_add(size=120,location=(0,0,-.017))
ground=move_col(bpy.context.object,studio_col)
ground.name="Studio backdrop floor";ground.data.materials.append(grey)
def light(name, pos,power,size):
    data=bpy.data.lights.new(name,"AREA");data.energy=power;data.shape="DISK";data.size=size
    obj=bpy.data.objects.new(name,data);studio_col.objects.link(obj);obj.location=pos
    direction=Vector((0,0,1.04))-obj.location
    obj.rotation_euler=direction.to_track_quat("-Z","Y").to_euler()
light("Large softbox key",(-3.3,-3.5,5),850,4)
light("Soft warm fill",(3,-1.5,3),460,3)
light("Rim / feather separator",(1.7,3.1,4),1050,3.6)
cam_data=bpy.data.cameras.new("Portrait camera")
cam=bpy.data.objects.new("Portrait camera",cam_data)
studio_col.objects.link(cam)
cam.location=(-4.4,-3.5,2.18)
cam.rotation_euler=(Vector((0,.0,1.05))-cam.location).to_track_quat("-Z","Y").to_euler()
cam_data.type="ORTHO";cam_data.ortho_scale=3.08
bpy.context.scene.camera=cam

scene=bpy.context.scene
scene.render.engine="BLENDER_EEVEE"
scene.render.resolution_x=1050;scene.render.resolution_y=1050
scene.render.resolution_percentage=100
scene.render.image_settings.file_format="PNG"
scene.world.color=(.34,.34,.34)
scene.view_settings.view_transform="Standard"
# No bones, no keyframes, no rigs: static game-ready high-poly asset.
bpy.ops.object.select_all(action="DESELECT")
for ob in chicken_col.objects:ob.select_set(True)
bpy.context.view_layer.objects.active=core
blendfile=os.path.join(OUT,"hen_highpoly.blend")
bpy.ops.wm.save_as_mainfile(filepath=blendfile)
# Export chicken alone: studio stays in .blend only.
try:
    glb=str(HEN/"source/hen_highpoly.glb")
    bpy.ops.export_scene.gltf(filepath=glb,export_format="GLB",use_selection=True,export_animations=False)
    print("GLB:",glb,os.path.getsize(glb))
except Exception as exc: print("GLB export issue",type(exc).__name__,str(exc))
print("BLEND:",blendfile,os.path.getsize(blendfile))
print("SCENE:",len(chicken_col.objects),"chicken objects; faces:",sum(len(o.data.polygons) for o in chicken_col.objects if o.type=="MESH"))
print("READY_TO_RENDER")
