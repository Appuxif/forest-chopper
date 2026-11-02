"""Bake the authored workbench Run/Chop into each modular base body GLB.

The *runtime* loads one gender-specific model/rig/mixer, without a separate
invisible animation driver. Original source .blend and lite/*.glb stay intact.
"""
import copy
import json
import struct
from pathlib import Path

BASE = Path(__file__).resolve().parent


def load_glb(path):
    data = path.read_bytes()
    assert data[:4] == b'glTF' and struct.unpack_from('<I', data, 4)[0] == 2
    offset = 12
    assert struct.unpack_from('<I', data, offset + 4)[0] == 0x4E4F534A
    size = struct.unpack_from('<I', data, offset)[0]
    info = json.loads(data[offset + 8:offset + 8 + size])
    offset += 8 + size
    assert struct.unpack_from('<I', data, offset + 4)[0] == 0x004E4942
    size = struct.unpack_from('<I', data, offset)[0]
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


def build(source, gender):
    source_info, source_blob = load_glb(source)
    target_info, target_blob = load_glb(BASE / f'lite/body_{gender}.glb')
    assert len(source_info['skins'][0]['joints']) == len(target_info['skins'][0]['joints']) == 53
    source_nodes = source_info['nodes']
    target_nodes = {node.get('name'): i for i, node in enumerate(target_info['nodes'])}
    for i in source_info['skins'][0]['joints']:
        assert source_nodes[i]['name'] in target_nodes
    source_base = {node['name']: node for node in source_nodes if node.get('name') in target_nodes}

    # Existing gender clips remain intact, except Run and Chop replaced by the
    # artist-authored source. Rebase local translations to the target body rest
    # pose, particularly important for the shorter female arm/leg bones.
    generated = []
    for name in ('run', 'Chop'):
        anim = next(a for a in source_info['animations'] if a['name'] == name)
        mapped = copy.deepcopy(anim)
        for channel in mapped['channels']:
            node = source_nodes[channel['target']['node']]['name']
            channel['target']['node'] = target_nodes[node]
        generated.append(mapped)
    target_info['animations'] = [a for a in target_info['animations'] if a['name'] not in ('run','Chop')] + generated

    accessor_base = len(target_info['accessors'])
    view_base = len(target_info['bufferViews'])
    byte_base = len(target_blob)
    target_info['bufferViews'].extend(copy.deepcopy(source_info['bufferViews']))
    for view in target_info['bufferViews'][view_base:]:
        view['buffer'] = 0
        view['byteOffset'] = view.get('byteOffset', 0) + byte_base
    target_info['accessors'].extend(copy.deepcopy(source_info['accessors']))
    for accessor in target_info['accessors'][accessor_base:]:
        if 'bufferView' in accessor:
            accessor['bufferView'] += view_base
        if 'sparse' in accessor:
            raise ValueError('Sparse animation accessors unsupported')
    for anim in generated:
        for sampler in anim['samplers']:
            sampler['input'] += accessor_base
            sampler['output'] += accessor_base

    # Patch the sample values of animated local translations to the gender's
    # own rest skeleton rather than importing male bone lengths onto female.
    base_blob = bytearray(target_blob + source_blob)
    for anim in generated:
        for channel in anim['channels']:
            if channel['target']['path'] != 'translation':
                continue
            node = target_info['nodes'][channel['target']['node']]
            source_rest = source_base[node['name']].get('translation', [0,0,0])
            target_rest = node.get('translation', [0,0,0])
            offset = [t-s for t,s in zip(target_rest,source_rest)]
            if max(map(abs, offset)) < 1e-7:
                continue
            sampler = anim['samplers'][channel['sampler']]
            accessor = target_info['accessors'][sampler['output']]
            assert accessor['type']=='VEC3' and accessor['componentType']==5126
            view = target_info['bufferViews'][accessor['bufferView']]
            begin = view['byteOffset'] + accessor.get('byteOffset', 0)
            stride = view.get('byteStride', 12)
            for i in range(accessor['count']):
                xyz = struct.unpack_from('<3f', base_blob, begin + i * stride)
                struct.pack_into('<3f', base_blob, begin + i * stride, *(p+d for p,d in zip(xyz,offset)))

    target_info['buffers'][0]['byteLength'] = len(base_blob)
    output = BASE / f'game/body_{gender}.glb'
    write_glb(output, target_info, bytes(base_blob))
    verify, _ = load_glb(output)
    assert len(verify['skins'][0]['joints']) == 53
    assert any(a['name']=='run' and len(a['channels'])==159 for a in verify['animations'])
    assert any(a['name']=='Chop' for a in verify['animations'])
    print('BUILT',output,'bytes',output.stat().st_size,'animations',len(verify['animations']))


if __name__ == '__main__':
    source = BASE / 'game/humanoid-game.glb'
    for gender in ('male','female'):
        build(source,gender)
