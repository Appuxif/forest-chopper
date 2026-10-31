"""Bake short skinned fabric-to-skin rim bridges into the Lite shirts.

Separate source assets stay intact. Extra geometry connects open garment edges
(hem, cuffs, collar) to the nearest body surface, providing a textile lining at
the openings. The generated vertices carry the garment's bone weights and UVs.

This is Blender build-time work; runtime simply loads the baked GLBs.
"""
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def seal_garment_openings(cloth, gender, asset, base_dir):
    """Connect selected shirt boundary edges to the body, keeping the rig."""
    if asset not in ('clothing_shirt.glb','clothing_tshirt.glb'):
        return {}
    body_path=Path(base_dir)/'lite'/f'body_{gender}.glb'
    if not body_path.is_file():
        raise FileNotFoundError(f'Generate {body_path} before garments')

    previously=set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=str(body_path))
    new_names=set(bpy.data.objects.keys())-previously
    # Body has body skin + face parts. Only the skin surface is used here.
    body=next(o for name in new_names
        if (o:=bpy.data.objects.get(name)) and o.type=='MESH' and o.name=='Body')
    bvh=BVHTree.FromPolygons(
        [v.co for v in body.data.vertices],
        [tuple(p.vertices) for p in body.data.polygons],
        all_triangles=False,
    )

    bm=bmesh.new()
    bm.from_mesh(cloth.data)
    bm.verts.ensure_lookup_table()
    uv_layer=bm.loops.layers.uv.active
    deform_layer=bm.verts.layers.deform.verify()
    min_z=min(v.co.z for v in bm.verts)
    max_z=max(v.co.z for v in bm.verts)
    is_long=(asset=='clothing_shirt.glb')
    count={'hem':0,'cuff':0,'collar':0,'faces':0}

    # Border edges can be UV-island seams, not only anatomical garment openings.
    # Restrict to z-heights / lateral x positions of actual neck/hem/wrist rims.
    # In Blender, character height is Z, x goes across shoulders.
    def classify(edge):
        v,w=(vert.co for vert in edge.verts)
        mx=max(abs(v.x),abs(w.x))
        mz=(v.z+w.z)*.5
        if max(v.z,w.z)<min_z+.050 and mx<.25 and abs(v.z-w.z)<.022:
            return 'hem'
        # Sleeve rim on +/-X; thresholds tuned to the source shirt at both genders.
        cuff_x= .40 if gender=='female' else .44
        cuff_max_z=1.02 if gender=='female' else 1.105
        if is_long and min(abs(v.x),abs(w.x))>cuff_x and max(v.z,w.z)<cuff_max_z:
            return 'cuff'
        if not is_long:
            # Short sleeves end near the biceps, not at the wrists.
            short_max=1.34 if gender=='female' else 1.43
            short_min=1.14 if gender=='female' else 1.22
            if min(abs(v.x),abs(w.x))>.143 and min(v.z,w.z)>short_min and max(v.z,w.z)<short_max:
                return 'cuff'
        # Center opening of the shirt; do not close over the face.
        collar_top=1.31 if gender=='female' else 1.395
        if min(v.z,w.z)>collar_top and mx<.145 and mz<max_z+.003:
            return 'collar'
        if not is_long:
            if min(v.z,w.z)>max_z-.075 and mx<.145:
                return 'collar'
        return None

    new_points={}  # (boundary vertex id, opening type) -> bmesh vertex
    adjusted=set()
    for edge in list(e for e in bm.edges if e.is_boundary):
        opening=classify(edge)
        if opening is None: continue
        v0,v1=edge.verts
        # Tailor open cuffs toward the skin (rather than broad hollow tubes).
        # A small margin preserves a plausible cloth thickness and keeps
        # animated fingers/arms from piercing directly through the cuff.
        fit_ratio={'cuff':.56,'collar':.28,'hem':.42}.get(opening,0)
        if fit_ratio:
            for vertex in (v0,v1):
                if vertex in adjusted:continue
                nearest_skin=bvh.find_nearest(vertex.co)
                if nearest_skin and .006<nearest_skin[3]<.09:
                    vertex.co.lerp(nearest_skin[0],fit_ratio)
                adjusted.add(vertex)
        mid=(v0.co+v1.co)*.5
        nearest=bvh.find_nearest(mid)
        if not nearest or nearest[3]>.095: continue

        faces=edge.link_faces
        if not faces:continue

        target=[]
        for source in (v0,v1):
            key=(source,opening)
            if key not in new_points:
                found=bvh.find_nearest(source.co)
                if not found or found[3]>.105:break
                co,normal,_,distance=found
                if normal.length_squared<.01:break
                # Land slightly *inside* the body; this overlaps the inset
                # skin safely and avoids an open fabric-to-skin gap.
                point=bm.verts.new(co-normal.normalized()*.037)
                for group_idx,weight in source[deform_layer].items():
                    point[deform_layer][group_idx]=weight
                new_points[key]=point
            target.append(new_points[key])
        if len(target)!=2:continue
        w0,w1=target
        if w0 is w1:continue
        try:
            face=bm.faces.new((v0,v1,w1,w0))
        except ValueError:
            continue

        # Preserve source texture mapping at the hem so the lining looks like
        # the inside of the garment rather than a flat untextured polygon.
        face.material_index=faces[0].material_index
        face.smooth=True
        if uv_layer:
            original_uv={}
            for loop in faces[0].loops:
                original_uv[loop.vert]=loop[uv_layer].uv.copy()
            for loop in face.loops:
                vertex=loop.vert
                source= v0 if vertex is w0 else v1 if vertex is w1 else vertex
                loop[uv_layer].uv=original_uv.get(source,Vector((.5,.5)))
        count[opening]+=1
        count['faces']+=1

    bm.normal_update()
    bm.to_mesh(cloth.data)
    bm.free()
    cloth.data.update()
    for name in new_names:
        ob=bpy.data.objects.get(name)
        if ob:
            bpy.data.objects.remove(ob,do_unlink=True)
    print('GARMENT_SEAMS',asset,gender,count,flush=True)
    return count
