"""Pure Python bot collision regression against the shared tree/log footprints."""
import unittest
from types import SimpleNamespace
from server_bots import can_stand
from forest_server import tree_info


class CollisionTests(unittest.TestCase):
    def test_log_footprints_orientation_height_and_headroom(self):
        world = SimpleNamespace(seed=321, felled=set(), logs={})
        # Away from procedurally placed trunks and first eight meters around spawn.
        world.logs[1] = {'x': 0, 'z': 0, 'y': .29, 'orientation': 0}
        self.assertFalse(can_stand(world, 0, 0, 0))
        self.assertFalse(can_stand(world, 1.6, 0, 0))
        self.assertTrue(can_stand(world, 0, 1.0, 0))
        world.logs[1]['orientation'] = 1
        self.assertFalse(can_stand(world, 0, 1.6, 0))
        self.assertTrue(can_stand(world, 1.0, 0, 0))
        # The same log cannot hit a player far above it.
        self.assertTrue(can_stand(world, 0, 0, 2.0))
        world.logs.clear()
        self.assertTrue(can_stand(world, 0, 0, 0))

    def test_seeded_trunk_and_felled_id(self):
        world = SimpleNamespace(seed=321, felled=set(), logs={})
        key = next(k for k in (f'{cx},{cz}:{i}' for cx in range(-2, 3)
                 for cz in range(-2, 3) for i in range(8))
                 if tree_info(k, world.seed))
        x, z, _ = tree_info(key, world.seed)
        self.assertFalse(can_stand(world, x, z, 0))
        world.felled.add(key)
        self.assertTrue(can_stand(world, x, z, 0))


if __name__ == '__main__':
    unittest.main()
