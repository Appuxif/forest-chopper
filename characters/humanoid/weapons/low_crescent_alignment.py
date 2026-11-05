"""Correct the LOW-only shaft/socket alignment and small rear blade.

This works on existing Blender geometry, not on the detailed original.
It may be safely called repeatedly (idempotent). The metal head and original
HIGH hierarchy are never edited.
"""

import bpy
import numpy as np
from mathutils import Vector


def child(root, name):
    return next(obj for obj in root.children if obj.name.startswith(name))


def vertices_world(obj):
    return np.array([tuple(obj.matrix_world @ vertex.co)
                     for vertex in obj.data.vertices], dtype=float)


def evaluated_triangles(root):
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tris = 0
    for obj in root.children:
        if obj.type not in {'CURVE', 'MESH'}:
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        tris += sum(len(poly.vertices)-2 for poly in mesh.polygons)
        evaluated.to_mesh_clear()
    return tris


def refine_low_variant(high, low):
    assert high.name == 'AXE_GRIP_CRESCENT'
    assert low.name == 'AXE_GRIP_CRESCENT_LOW'
    assert len(high.children) == len(low.children) == 34

    high_poll = child(high, 'Poll | compact hammered counterweight')
    low_poll = child(low, 'Poll | compact hammered counterweight')

    if not low_poll.get('preserved_original_small_blade'):
        # Original small blade has bevels and a connecting edge. Decimating
        # 136 -> 16 triangles collapsed the neck and created a visible gap.
        # Keep the whole 136-triangle geometry; still below the 2k budget.
        original_name = low_poll.name
        target_collection = next(c for c in low_poll.users_collection
                                 if 'Crescent axe LOW' in c.name)
        replacement = high_poll.copy()
        replacement.data = high_poll.data.copy()
        replacement.parent = low
        replacement.matrix_basis = high_poll.matrix_basis.copy()
        target_collection.objects.link(replacement)
        bpy.data.objects.remove(low_poll, do_unlink=True)
        replacement.name = original_name
        replacement['variant'] = 'Low Poly'
        replacement['preserved_original_small_blade'] = True
        print('RESTORED_SMALL_BLADE', replacement.name, flush=True)

    # Blender's glTF exporter can export the unmodified 16-triangle
    # small blade, ignoring its visual bevel. Bake the original bevel
    # into the LOW mesh to preserve the junction in the GLB as well.
    small_blade = child(low, 'Poll | compact hammered counterweight')
    for bevel in [m for m in small_blade.modifiers if m.type == 'BEVEL']:
        bpy.ops.object.select_all(action='DESELECT')
        small_blade.select_set(True)
        bpy.context.view_layer.objects.active = small_blade
        bpy.ops.object.modifier_apply(modifier=bevel.name)
        print('BAKED_SMALL_BLADE_BEVEL',small_blade.name,flush=True)

    if not low.get('shaft_centered_to_socket'):
        bpy.context.view_layer.update()
        shaft = child(low, 'Handle | sculpted dark ash')
        socket = child(low, 'Head | blackened forged socket')
        coords = vertices_world(shaft)
        shaft_center = coords.mean(axis=0)
        _, _, vh = np.linalg.svd(coords - shaft_center, full_matrices=False)
        shaft_axis = vh[0]  # sign does not change the projection
        socket_center = vertices_world(socket).mean(axis=0)
        # Remove the along-handle component: move ONLY sideways to align
        # the actual cylinder axis with the forged socket centerline.
        difference = socket_center - shaft_center
        offset_world = difference - np.dot(difference, shaft_axis)*shaft_axis
        assert 0 < np.linalg.norm(offset_world) < .02, offset_world
        local_offset = low.matrix_world.inverted().to_3x3() @ Vector(offset_world)

        # Move the shaft, leather wrapping, collars, carved grain and pommel
        # AS ONE ASSEMBLY. Neither the steel socket nor blade are moved.
        moved = []
        for obj in low.children:
            if obj.name.startswith(('Handle |', 'Grip |', 'Pommel |',
                                   'Ash grain')):
                obj.location += local_offset
                moved.append(obj.name)
        low['shaft_centered_to_socket'] = True
        low['shaft_alignment_mm'] = round(float(np.linalg.norm(offset_world)*1000), 3)
        bpy.context.view_layer.update()
        print('ALIGNED_LOW_HANDLE',len(moved),'parts',
              'perpendicular offset mm',
              round(float(np.linalg.norm(offset_world)*1000),3),
              'world offset',tuple(round(float(x),6) for x in offset_world),
              flush=True)

    assert len(low.children) == 34
    triangles = evaluated_triangles(low)
    if triangles > 2000:
        # 136-triangle original small blade is more important than hidden
        # individual loops in the leather spiral; simplify only that
        # secondary detail until the *evaluated Blender* budget is met.
        lacing = child(low, 'Grip | spiral leather lacing')
        bpy.ops.object.select_all(action='DESELECT')
        lacing.select_set(True)
        bpy.context.view_layer.objects.active = lacing
        modifier = lacing.modifiers.new('Low-poly leather loop reduction',
                                        'DECIMATE')
        modifier.ratio = .73
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        triangles = evaluated_triangles(low)
        print('OPTIMIZED_LEATHER_SPIRAL',triangles,flush=True)
    print('LOW_BLENDER_TRIANGLES',triangles,flush=True)
    assert triangles <= 2000, triangles
    return triangles
