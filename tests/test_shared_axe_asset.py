"""The runtime axe must be one exact, skin-free extraction of the authored axe.

No Blender required. The 53-bone preview is ONLY a source asset; gameplay
loads the compact shared GLB for all three independent characters.
"""
import json
import struct
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'characters/humanoid/lite/axe_preview.glb'
SHARED = ROOT / 'characters/humanoid/game/axe_shared.glb'


def read_glb(path):
    data = path.read_bytes()
    assert data[:4] == b'glTF'
    size = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20+size])
    binary_offset = 20+size+8
    return gltf, data[binary_offset:]


def accessor_data(gltf, blob, idx):
    accessor = gltf['accessors'][idx]
    view = gltf['bufferViews'][accessor['bufferView']]
    offset = view.get('byteOffset', 0)
    length = view['byteLength']
    # Both GLBs contain exactly the same packed bufferView bytes after
    # remapping the accessor's view to a smaller independent BIN chunk.
    return blob[offset:offset+length]


class SharedAxeAssetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original, cls.original_data = read_glb(SOURCE)
        cls.shared, cls.shared_data = read_glb(SHARED)

    def test_exact_grip_transform_and_five_child_meshes(self):
        originals = self.original['nodes']
        source_root = next(n for n in originals if n.get('name', '').startswith('AXE_GRIP'))
        root = self.shared['nodes'][0]
        for key in ('name', 'rotation', 'translation', 'scale'):
            self.assertEqual(root.get(key), source_root.get(key), key)
        self.assertEqual(root['children'], [1, 2, 3, 4, 5])
        self.assertEqual(len(self.shared['nodes']), 6)
        for index, original_index in enumerate(source_root['children'], start=1):
            self.assertEqual(self.shared['nodes'][index]['name'],
                             originals[original_index]['name'])

    def test_same_materials_textures_and_exact_mesh_geometry(self):
        original = self.original
        shared = self.shared
        self.assertEqual(shared['materials'], original['materials'])
        self.assertEqual(shared['textures'], original['textures'])
        self.assertEqual(shared['samplers'], original['samplers'])
        for index, node in enumerate(shared['nodes'][1:], start=1):
            source_node = next(
                n for n in original['nodes'] if n.get('name') == node['name']
            )
            source_mesh = original['meshes'][source_node['mesh']]
            new_mesh = shared['meshes'][node['mesh']]
            self.assertEqual(len(source_mesh['primitives']),
                             len(new_mesh['primitives']))
            for old_primitive, primitive in zip(source_mesh['primitives'],
                                                new_mesh['primitives']):
                self.assertEqual(old_primitive.get('material'),
                                 primitive.get('material'))
                for semantic, accessor_index in primitive['attributes'].items():
                    old_index = old_primitive['attributes'][semantic]
                    self.assertEqual(
                        accessor_data(shared, self.shared_data, accessor_index),
                        accessor_data(original, self.original_data, old_index),
                        (node['name'], semantic)
                    )
                if 'indices' in primitive:
                    self.assertEqual(
                        accessor_data(shared, self.shared_data, primitive['indices']),
                        accessor_data(original, self.original_data, old_primitive['indices'])
                    )
        for old_image, new_image in zip(original['images'], shared['images']):
            def bytes_from(gltf, blob, image):
                view = gltf['bufferViews'][image['bufferView']]
                pos = view.get('byteOffset', 0)
                return blob[pos:pos+view['byteLength']]
            self.assertEqual(bytes_from(original, self.original_data, old_image),
                             bytes_from(shared, self.shared_data, new_image))

    def test_shared_asset_has_no_humanoid_or_old_lumberjack_weapon(self):
        self.assertEqual(len(self.shared['meshes']), 5)
        self.assertEqual(len(self.shared['materials']), 5)
        self.assertEqual(len(self.shared['images']), 3)
        self.assertFalse(self.shared.get('skins'))
        self.assertFalse(self.shared.get('animations'))
        self.assertFalse(any('hand_r' == n['name'] for n in self.shared['nodes']))
        self.assertFalse((ROOT/'lumberjack/lumberjack_axe.glb').exists())


if __name__ == '__main__':
    unittest.main()
