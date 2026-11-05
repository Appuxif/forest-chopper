"""Extract the single runtime axe from the authored male axe preview GLB.

The preview GLB includes a complete humanoid skeleton, extra geometry and
bone nodes; only AXE_GRIP and its five meshes are an actual weapon.
This build keeps the EXACT original AXE_GRIP local TRS, mesh accessors,
materials and embedded textures, but drops the unrelated humanoid.
The extracted scene root is directly attachable to Socket.handRight.

No Blender installation or third-party Python dependencies required.
Run from any directory:
  python3 characters/humanoid/animation/build_shared_axe.py
"""
from __future__ import annotations

import copy
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'characters/humanoid/lite/axe_preview.glb'
TARGET = ROOT / 'characters/humanoid/game/axe_shared.glb'

HEADER = struct.Struct('<III')
CHUNK = struct.Struct('<II')
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def load_glb(path: Path):
    blob = path.read_bytes()
    magic, version, length = HEADER.unpack_from(blob, 0)
    assert (magic, version, length) == (0x46546C67, 2, len(blob))
    offset = HEADER.size
    chunks = {}
    while offset < length:
        size, kind = CHUNK.unpack_from(blob, offset)
        offset += CHUNK.size
        chunks[kind] = blob[offset:offset + size]
        offset += size
    return json.loads(chunks[JSON_CHUNK]), chunks[BIN_CHUNK]


def select_objects(src):
    roots = [i for i, node in enumerate(src['nodes'])
             if node.get('name', '').startswith('AXE_GRIP')]
    assert len(roots) == 1, roots
    root = roots[0]
    children = src['nodes'][root]['children']
    assert len(children) == 5
    assert all('mesh' in src['nodes'][c] for c in children)
    assert all(not src['nodes'][c].get('children') for c in children)
    node_ids = [root, *children]
    mesh_ids = [src['nodes'][c]['mesh'] for c in children]
    assert len(set(mesh_ids)) == 5
    nodes = [copy.deepcopy(src['nodes'][i]) for i in node_ids]
    nodes[0]['children'] = list(range(1, len(node_ids)))
    for node in nodes[1:]:
        node['mesh'] = mesh_ids.index(node['mesh'])
    meshes = [copy.deepcopy(src['meshes'][i]) for i in mesh_ids]
    return nodes, meshes


def pack_asset(src, binary):
    nodes, meshes = select_objects(src)
    accessor_ids = set()
    for mesh in meshes:
        for prim in mesh['primitives']:
            accessor_ids.update(prim['attributes'].values())
            if 'indices' in prim:
                accessor_ids.add(prim['indices'])
            assert not prim.get('targets'), 'Axe should not have morph targets'

    accessor_ids = sorted(accessor_ids)
    accessor_map = {old: new for new, old in enumerate(accessor_ids)}
    accessors = [copy.deepcopy(src['accessors'][i]) for i in accessor_ids]
    for mesh in meshes:
        for prim in mesh['primitives']:
            prim['attributes'] = {
                key: accessor_map[value]
                for key, value in prim['attributes'].items()
            }
            if 'indices' in prim:
                prim['indices'] = accessor_map[prim['indices']]

    # These five source materials currently use the original five entries,
    # with embedded baseColor/normal textures. Preserve both without any
    # lossy conversion, rebuilding only accessor/view offsets.
    material_ids = sorted({
        prim['material'] for mesh in meshes for prim in mesh['primitives']
        if 'material' in prim
    })
    materials = [copy.deepcopy(src['materials'][i]) for i in material_ids]
    for mesh in meshes:
        for prim in mesh['primitives']:
            if 'material' in prim:
                prim['material'] = material_ids.index(prim['material'])
    assert len(materials) == 5, material_ids
    assert not src.get('extensionsRequired'), 'Unsupported asset extension'

    images = copy.deepcopy(src.get('images', []))
    textures = copy.deepcopy(src.get('textures', []))
    samplers = copy.deepcopy(src.get('samplers', []))
    referenced_views = {
        a['bufferView'] for a in accessors if 'bufferView' in a
    }
    for accessor in accessors:
        assert not accessor.get('sparse'), 'Sparse accessors not supported'
    for image in images:
        assert 'bufferView' in image, 'Expected an embedded texture'
        referenced_views.add(image['bufferView'])

    view_ids = sorted(referenced_views)
    view_map = {old: new for new, old in enumerate(view_ids)}
    views = [copy.deepcopy(src['bufferViews'][i]) for i in view_ids]
    output_bin = bytearray()
    for view in views:
        original_offset = view.get('byteOffset', 0)
        length = view['byteLength']
        assert view.get('buffer', 0) == 0
        assert original_offset + length <= len(binary)
        output_bin.extend(b'\0' * (-len(output_bin) % 4))
        view['byteOffset'] = len(output_bin)
        view['buffer'] = 0
        output_bin.extend(binary[original_offset:original_offset + length])
    for accessor in accessors:
        if 'bufferView' in accessor:
            accessor['bufferView'] = view_map[accessor['bufferView']]
    for image in images:
        image['bufferView'] = view_map[image['bufferView']]

    output = {
        'asset': copy.deepcopy(src['asset']),
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': nodes,
        'meshes': meshes,
        'materials': materials,
        'accessors': accessors,
        'bufferViews': views,
        'buffers': [{'byteLength': len(output_bin)}],
    }
    if images:
        output['images'] = images
    if textures:
        output['textures'] = textures
    if samplers:
        output['samplers'] = samplers
    return output, bytes(output_bin)


def write_glb(path, gltf, buffer):
    js = json.dumps(gltf, ensure_ascii=False, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    buffer += b'\0' * (-len(buffer) % 4)
    length = HEADER.size + CHUNK.size * 2 + len(js) + len(buffer)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        HEADER.pack(0x46546C67, 2, length) +
        CHUNK.pack(len(js), JSON_CHUNK) + js +
        CHUNK.pack(len(buffer), BIN_CHUNK) + buffer
    )


def main():
    source, binary = load_glb(SOURCE)
    out, subset = pack_asset(source, binary)
    write_glb(TARGET, out, subset)
    check, buffer = load_glb(TARGET)
    assert check == out
    assert len(buffer) >= len(subset)
    assert len(check['nodes']) == 6
    assert len(check['meshes']) == 5
    assert not check.get('skins') and not check.get('animations')
    print(f'SHARED_AXE: {TARGET} ({TARGET.stat().st_size} bytes vs '
          f'{SOURCE.stat().st_size} original), 5 meshes, 0 skins, '
          f'{len(check.get("images", []))} embedded images')


if __name__ == '__main__':
    main()
