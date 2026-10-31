"""Real client/server heightfield parity; run from repository root with unittest."""
import json
import math
import random
import subprocess
import unittest

from terrain_height import base_height, height_at
from ponds import pond_depth_at
from lakes import lake_at, lakes_near_tile


class TerrainWaterTests(unittest.TestCase):
    def test_client_server_height_and_water_depth(self):
        coords=[(0,0),(8,-5),(40,50),(105,63),(260,-250),(310,-250),
                (320,-180),(-400,200),(-100,-150),(80,120)]
        rng=random.Random(2026)
        coords.extend((rng.uniform(-1200,1200),rng.uniform(-1200,1200))
                      for _ in range(95))
        samples=[(seed,x,z) for seed in (1,123456,999998) for x,z in coords]
        script='''import {terrainHeight} from './src/terrain.js';
            import {pondDepthAt} from './src/ponds.js';
            const points=JSON.parse(process.argv[1]);
            console.log(JSON.stringify(points.map(([s,x,z])=>
              [terrainHeight(s,x,z),pondDepthAt(s,x,z)])));
        '''
        result=subprocess.run(
            ['node','--input-type=module','-e',script,json.dumps(samples)],
            capture_output=True,text=True,check=True,timeout=30)
        browser=json.loads(result.stdout)
        self.assertEqual(len(browser),len(samples))
        for (seed,x,z),(client_y,client_depth) in zip(samples,browser):
            with self.subTest(seed=seed,x=x,z=z):
                self.assertAlmostEqual(client_y,height_at(seed,x,z),places=7)
                self.assertAlmostEqual(client_depth,pond_depth_at(seed,x,z),places=7)

    def test_headless_bots_cannot_enter_deep_lake_water(self):
        from types import SimpleNamespace
        from server_bots import can_stand

        world=SimpleNamespace(seed=123456,felled=set(),logs={})
        lake=lake_at(world.seed,0,-1)
        self.assertGreater(pond_depth_at(world.seed,lake['x'],lake['z']),.8)
        self.assertFalse(can_stand(world,lake['x'],lake['z']),
                         'bots must agree with the client about deep water')

    def test_lake_is_large_deep_and_rare(self):
        for seed in (1,123456,999998):
            lake=lake_at(seed,0,-1)
            self.assertIsNotNone(lake)
            self.assertGreater(lake['rx']*2,160)
            self.assertGreaterEqual(lake['depth'],4.5)
            self.assertLessEqual(lake['depth'],6.)
            self.assertGreater(pond_depth_at(seed,lake['x'],lake['z']),3.5)
            # Landscape is smooth and respects the original origin.
            self.assertAlmostEqual(height_at(seed,0,0),0)
            self.assertAlmostEqual(base_height(seed,0,0),0)
            found=list(lakes_near_tile(seed,lake['x']-20,lake['z']-20,40))
            self.assertEqual(sum(site['id']==lake['id'] for site in found),1)


if __name__=='__main__':
    unittest.main()
