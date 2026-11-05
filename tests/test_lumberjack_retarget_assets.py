"""Contract checks for the preview-stage, individually animated Lumberjack."""
import json
import struct
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RIG = ROOT / 'characters/humanoid/animation/preview/body_lumberjack_retarget.glb'
AXE = ROOT / 'characters/humanoid/game/axe_shared.glb'
SOURCE = ROOT / 'lumberjack/lumberjack.glb'

MOTIONS = {
    'idle', 'idle_breathe', 'idle_fidget', 'idle_look', 'walk',
    'walk_backward', 'run', 'run_backward', 'strafe_left', 'strafe_right',
    'jump', 'fall', 'land', 'Chop'
}


def glb_metadata(path: Path):
    data = path.read_bytes()
    assert data[:4] == b'glTF'
    assert struct.unpack_from('<I', data, 4)[0] == 2
    size, tag = struct.unpack_from('<II', data, 12)
    assert tag == 0x4E4F534A
    return json.loads(data[20:20 + size])


class LumberjackAssetsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.body = glb_metadata(RIG)
        cls.axe = glb_metadata(AXE)
        cls.source = glb_metadata(SOURCE)

    def test_source_preserved_and_new_skeleton_matches_gender_rigs(self):
        self.assertEqual(len(self.source['skins'][0]['joints']), 13)
        self.assertEqual(len(self.source['animations']), 9)
        body = self.body
        self.assertEqual(len(body['skins']), 1)
        joints = body['skins'][0]['joints']
        self.assertEqual(len(joints), 53)
        names = [body['nodes'][n]['name'] for n in joints]
        male = glb_metadata(ROOT / 'characters/humanoid/game/body_male.glb')
        male_names = [male['nodes'][n]['name'] for n in male['skins'][0]['joints']]
        self.assertEqual(names, male_names, 'same 53 bone names and order')

    def test_all_body_meshes_are_skinned_and_original_axe_is_separate(self):
        model = self.body
        self.assertEqual(len(model['meshes']), 56)
        mesh_nodes = [node for node in model['nodes'] if 'mesh' in node]
        self.assertEqual(len(mesh_nodes), 56)
        self.assertTrue(all(n.get('skin') == 0 for n in mesh_nodes))
        self.assertFalse(any('Axe blade' in n.get('name', '') or
                             'Axe handle' in n.get('name', '')
                             for n in model['nodes']))
        for mesh in model['meshes']:
            for primitive in mesh['primitives']:
                attributes = primitive['attributes']
                self.assertIn('JOINTS_0', attributes)
                self.assertIn('WEIGHTS_0', attributes)

    def test_lumberjack_owns_all_fourteen_runtime_actions(self):
        actions = self.body['animations']
        self.assertEqual({a['name'] for a in actions}, MOTIONS)
        self.assertEqual(len(actions), 14)
        for action in actions:
            self.assertEqual(len(action['channels']), 53 * 3)
        self.assertGreater(len(next(a for a in actions if a['name']=='Chop')['samplers']), 0)

    def test_six_locomotion_root_distances_match_standard_actors(self):
        # The game uses glTF Y-up: Blender -Y corresponds to glTF +Z.
        # Test the actual exported GLB translation curves per frame.
        blob = RIG.read_bytes()
        json_size = struct.unpack_from('<I', blob, 12)[0]
        binary_start = 20 + json_size + 8
        gltf = self.body
        nodes = gltf['nodes']
        actions = {a['name']: a for a in gltf['animations']}

        def root_track(name):
            action = actions[name]
            channels = [
                c for c in action['channels']
                if nodes[c['target']['node']]['name'] == 'Root'
                and c['target']['path'] == 'translation'
            ]
            self.assertEqual(len(channels), 1, name)
            sampler = action['samplers'][channels[0]['sampler']]
            accessor = gltf['accessors'][sampler['output']]
            self.assertEqual(accessor['type'], 'VEC3')
            self.assertEqual(accessor['componentType'], 5126)
            view = gltf['bufferViews'][accessor['bufferView']]
            offset = binary_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
            stride = view.get('byteStride', 12)
            return [struct.unpack_from('<fff', blob, offset + i * stride)
                    for i in range(accessor['count'])]

        expected = {
            'walk': (0.0, 1.32),
            'walk_backward': (0.0, -1.32),
            'run': (0.0, 3.40782),
            'run_backward': (0.0, -1.16),
            'strafe_left': (0.60, 0.0),
            'strafe_right': (-0.60, 0.0),
        }
        for motion, (expected_x, expected_z) in expected.items():
            samples = root_track(motion)
            self.assertGreater(len(samples), 10, motion)
            dx = samples[-1][0] - samples[0][0]
            dz = samples[-1][2] - samples[0][2]
            self.assertAlmostEqual(dx, expected_x, places=3, msg=motion)
            self.assertAlmostEqual(dz, expected_z, places=3, msg=motion)
            self.assertAlmostEqual(samples[0][0], 0, places=4, msg=motion)
            self.assertAlmostEqual(samples[0][2], 0, places=4, msg=motion)
            axis, expected_value = (
                (0, expected_x) if abs(expected_x)>0.05 else (2, expected_z)
            )
            sign = 1 if expected_value >= 0 else -1
            for previous, following in zip(samples, samples[1:]):
                self.assertGreaterEqual(sign*(following[axis]-previous[axis]),
                                        -0.002, msg=motion)

    def test_exported_strafe_duration_matches_male_and_female(self):
        # Editor timing: 26.25 / 30 = 0.875s. All exported GLBs have
        # 26-frame sampled durations: 26 / 30 = 0.8666667 seconds.
        male = glb_metadata(ROOT / 'characters/humanoid/game/body_male.glb')
        female = glb_metadata(ROOT / 'characters/humanoid/game/body_female.glb')
        for motion in ('strafe_left', 'strafe_right'):
            durations = []
            for model in (male, female, self.body):
                action = next(a for a in model['animations'] if a['name'] == motion)
                stamps = [
                    model['accessors'][sampler['input']]
                    for sampler in action['samplers']
                ]
                duration = max(item['max'][0] for item in stamps) - min(
                    item['min'][0] for item in stamps
                )
                durations.append(duration)
            for value in durations:
                self.assertAlmostEqual(value, 26 / 30, places=5, msg=motion)
            self.assertAlmostEqual(durations[0], durations[2], places=6)

    def test_axe_is_independent_socket_ready_static_mesh(self):
        gltf = self.axe
        self.assertEqual(len(gltf.get('skins', [])), 0)
        self.assertEqual(len(gltf.get('animations', [])), 0)
        self.assertEqual(len(gltf['meshes']), 5)
        self.assertEqual(len(gltf['nodes']), 6)
        self.assertEqual(len(gltf.get('materials', [])), 5)
        nodes = gltf['nodes']
        self.assertEqual(len([n for n in nodes if n['name'].startswith('AXE_GRIP')]), 1)
        self.assertEqual(
            {n['name'] for n in nodes if 'mesh' in n},
            {'Axe End pin · Male', 'Axe Forged blade · Male',
             'Axe Handle · Male', 'Axe Leather grip · Male',
             'Axe Steel collar · Male'}
        )


if __name__ == '__main__':
    unittest.main()
