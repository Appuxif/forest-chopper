"""Pack ONE full body+rig+animation GLB per gender from offline build inputs.

The only distributed body models are game/body_male.glb and body_female.glb.
The full Blender workbench also contains REF_* experiments that are excluded
from the exported runtime models to avoid wasted GPU and download memory.
Geometry inputs lite/body_{gender}{,_angular,_soft}.glb are temporary Blender
build products, NOT referenced by the game or preview. All 13 production workbench
Actions go into both output GLBs, with optional gender overrides named
"male__run" or "female__run" selected per destination and renamed "run".
Clothing/hair GLBs remain independent gear assets, attached to this rig.
"""
import argparse
import copy
import json
import math
import struct
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent


def load_glb(path):
    data = path.read_bytes()
    assert data[:4] == b'glTF' and struct.unpack_from('<I', data, 4)[0] == 2
    offset = 12
    size, tag = struct.unpack_from('<II', data, offset)
    assert tag == 0x4E4F534A
    info = json.loads(data[offset + 8:offset + 8 + size])
    offset += 8 + size
    size, tag = struct.unpack_from('<II', data, offset)
    assert tag == 0x004E4942
    return info, data[offset + 8:offset + 8 + size]


def write_glb(path, info, blob):
    serialized = json.dumps(info, separators=(',', ':'), ensure_ascii=False).encode()
    serialized += b' ' * (-len(serialized) % 4)
    blob += b'\x00' * (-len(blob) % 4)
    length = 12 + 8 + len(serialized) + 8 + len(blob)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'glTF' + struct.pack('<II', 2, length) +
                     struct.pack('<II', len(serialized), 0x4E4F534A) + serialized +
                     struct.pack('<II', len(blob), 0x004E4942) + blob)


def read_floats(info, blob, index):
    accessor = info['accessors'][index]
    assert accessor['componentType'] == 5126 and 'sparse' not in accessor
    size = {'VEC2': 2, 'VEC3': 3}[accessor['type']]
    view = info['bufferViews'][accessor['bufferView']]
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride', size * 4)
    return [struct.unpack_from('<' + 'f' * size, blob, start + i * stride)
            for i in range(accessor['count'])]


def add_accessor(info, blob, coordinates):
    assert coordinates and all(len(v) == 3 for v in coordinates)
    # Buffer views MUST start aligned on 4-byte boundaries.
    blob.extend(b'\x00' * (-len(blob) % 4))
    offset = len(blob)
    for xyz in coordinates:
        blob.extend(struct.pack('<3f', *xyz))
    view = len(info['bufferViews'])
    info['bufferViews'].append({'buffer': 0, 'byteOffset': offset,
                                'byteLength': len(coordinates) * 12})
    accessor = len(info['accessors'])
    info['accessors'].append({'bufferView': view, 'componentType': 5126,
                              'count': len(coordinates), 'type': 'VEC3'})
    return accessor


def nearest_uv_mapping(base_uv, base_positions, face_uv, face_positions):
    """Match differently decimated face meshes by stable source UVs.

    >92% of points have exactly shared UVs; other vertices are mapped to the
    nearest UV while favoring the nearest rest-space position for UV seams.
    """
    buckets = defaultdict(list)
    for i, uv in enumerate(face_uv):
        buckets[(round(uv[0], 5), round(uv[1], 5))].append(i)
    indices = []
    for uv, p in zip(base_uv, base_positions):
        candidates = buckets.get((round(uv[0], 5), round(uv[1], 5)))
        if not candidates:
            # Extremely few remeshed vertices: fallback nearest UV in O(n).
            d2 = [(u[0] - uv[0])**2 + (u[1] - uv[1])**2 for u in face_uv]
            smallest = min(d2)
            candidates = [i for i, d in enumerate(d2) if d <= smallest + 1e-10]
        best = min(candidates, key=lambda i: sum((face_positions[i][k]-p[k])**2
                                                 for k in range(3)))
        indices.append(best)
    return indices


def add_face_presets(info, body_blob, gender, body_dir):
    """Embed angular/soft variants as morph POSITION targets in same body GLB.

    The source Blender variants are temporary build files. Mesh vertex counts
    differ slightly due to independent decimation, so UVs align vertices.
    """
    variants = {name: load_glb(body_dir / f'body_{gender}_{name}.glb')
                for name in ('angular', 'soft')}
    for mesh_index, mesh in enumerate(info['meshes']):
        targets_per_primitive = []
        for prim_index, primitive in enumerate(mesh['primitives']):
            base_pos = read_floats(info, body_blob, primitive['attributes']['POSITION'])
            base_uv = read_floats(info, body_blob, primitive['attributes']['TEXCOORD_0'])
            morphs = []
            for face, (face_info, face_blob) in variants.items():
                face_prim = face_info['meshes'][mesh_index]['primitives'][prim_index]
                variant_pos = read_floats(face_info, face_blob, face_prim['attributes']['POSITION'])
                variant_uv = read_floats(face_info, face_blob, face_prim['attributes']['TEXCOORD_0'])
                mapping = nearest_uv_mapping(base_uv, base_pos, variant_uv, variant_pos)
                delta = [tuple(variant_pos[k][axis] - pos[axis] for axis in range(3))
                         for pos, k in zip(base_pos, mapping)]
                # Skip faces with extremely poor UV mapping rather than creating
                # malformed body geometry.
                error = max(math.dist(base_pos[i], variant_pos[mapping[i]])
                            for i in range(len(base_pos)))
                if error > .12:
                    raise ValueError(f'{gender} {face} {mesh_index}:{prim_index}: '
                                     f'face vertex mismatch {error:.3f}m')
                morphs.append({'POSITION': add_accessor(info, body_blob, delta)})
            primitive['targets'] = morphs
            targets_per_primitive.append(morphs)
        mesh['weights'] = [0.0, 0.0]
        mesh.setdefault('extras', {})['targetNames'] = ['angular', 'soft']
    print('BAKED_FACE_PRESETS', gender, 'angular, soft', 'meshes', len(info['meshes']))


def animation_bank(info, gender):
    """Return a self-contained gender-specific Action mapping.

    Shared clips are the current default, but a separately authored
    `female__walk` in the same workbench overrides only female `walk`.
    """
    by_name = {a['name']: a for a in info['animations']}
    shared = {name: a for name, a in by_name.items()
              if not name.startswith(('male__', 'female__', 'REF_'))}
    for name, action in by_name.items():
        prefix = gender + '__'
        if name.startswith(prefix):
            target = name[len(prefix):]
            assert target in shared, f'{name}: overrides must target an existing clip'
            shared[target] = action
    required = {'idle', 'walk', 'run', 'Chop'}
    assert required <= shared.keys(), required - shared.keys()
    assert len(shared) == 13, ('Expected 13 production Actions',len(shared),sorted(shared))
    return shared


def build(source, gender, body_dir):
    source_info, source_blob = load_glb(source)
    base_info, target_blob = load_glb(body_dir / f'body_{gender}.glb')
    assert len(source_info['skins'][0]['joints']) == len(base_info['skins'][0]['joints']) == 53
    source_nodes = source_info['nodes']
    target_nodes = {node.get('name'): i for i, node in enumerate(base_info['nodes'])}
    assert all(source_nodes[i]['name'] in target_nodes for i in source_info['skins'][0]['joints'])
    source_rests = {node['name']: node for node in source_nodes if node.get('name') in target_nodes}

    # Discard old body-build animation bank. Only workbench-authoritative
    # clips are exported; each gender gets an independent list of samplers.
    original_clips = animation_bank(source_info, gender)
    mapped_clips = []
    source_for_remap = {}
    for name, clip in sorted(original_clips.items()):
        mapped = copy.deepcopy(clip)
        mapped['name'] = name
        for channel in mapped['channels']:
            node_name = source_nodes[channel['target']['node']]['name']
            channel['target']['node'] = target_nodes[node_name]
        mapped_clips.append(mapped)
        source_for_remap[name] = clip
    base_info['animations'] = mapped_clips
    accessor_base = len(base_info['accessors'])
    view_base = len(base_info['bufferViews'])
    byte_base = len(target_blob)
    base_info['bufferViews'].extend(copy.deepcopy(source_info['bufferViews']))
    for view in base_info['bufferViews'][view_base:]:
        view['buffer'] = 0
        view['byteOffset'] = view.get('byteOffset', 0) + byte_base
    base_info['accessors'].extend(copy.deepcopy(source_info['accessors']))
    for accessor in base_info['accessors'][accessor_base:]:
        if 'bufferView' in accessor:
            accessor['bufferView'] += view_base
        if 'sparse' in accessor:
            raise ValueError('Sparse animation accessors unsupported')
    for anim in mapped_clips:
        for sampler in anim['samplers']:
            sampler['input'] += accessor_base
            sampler['output'] += accessor_base

    payload = bytearray(target_blob + source_blob)
    for anim in mapped_clips:
        for channel in anim['channels']:
            if channel['target']['path'] != 'translation':
                continue
            node = base_info['nodes'][channel['target']['node']]
            source_rest = source_rests[node['name']].get('translation', [0, 0, 0])
            target_rest = node.get('translation', [0, 0, 0])
            diff = [a - b for a, b in zip(target_rest, source_rest)]
            if max(map(abs, diff)) < 1e-7:
                continue
            sampler = anim['samplers'][channel['sampler']]
            accessor = base_info['accessors'][sampler['output']]
            assert accessor['type'] == 'VEC3' and accessor['componentType'] == 5126
            view = base_info['bufferViews'][accessor['bufferView']]
            pos = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
            stride = view.get('byteStride', 12)
            for i in range(accessor['count']):
                xyz = struct.unpack_from('<3f', payload, pos + i * stride)
                struct.pack_into('<3f', payload, pos + i * stride,
                                 *(p + d for p, d in zip(xyz, diff)))

    add_face_presets(base_info, payload, gender, body_dir)
    base_info['buffers'][0]['byteLength'] = len(payload)
    output = BASE / f'game/body_{gender}.glb'
    write_glb(output, base_info, bytes(payload))
    verify, _ = load_glb(output)
    assert len(verify['skins']) == 1 and len(verify['skins'][0]['joints']) == 53
    assert len(verify['animations']) == len(mapped_clips) == 13
    assert all(prim.get('targets') and len(prim['targets']) == 2
               for m in verify['meshes'] for prim in m['primitives'])
    print('BUILT', output, 'bytes', output.stat().st_size,
          'actions', len(verify['animations']), 'unique gender bank', gender)


if __name__ == '__main__':
    cli = argparse.ArgumentParser()
    cli.add_argument('--animations', type=Path, required=True,
                     help='Animation-only GLB exported from the workbench')
    cli.add_argument('--body-dir', type=Path, default=BASE / 'lite',
                     help='Temporary generated base/face body GLBs')
    cli.add_argument('--gender', choices=['male','female'], default=None)
    options = cli.parse_args()
    for sex in ([options.gender] if options.gender else ['male', 'female']):
        build(options.animations, sex, options.body_dir)
