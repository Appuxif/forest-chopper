import unittest
from forest_server import fall_damage_for_height, record_fall_landing


class FallDamageTests(unittest.TestCase):
    def test_thresholds(self):
        for height, damage in ((0, 0), (2.99, 0), (3, 2), (3.99, 2),
                               (4, 3), (4.99, 3), (5, 5), (30, 5)):
            with self.subTest(height=height):
                self.assertEqual(fall_damage_for_height(height), damage)

    def test_server_tracks_validated_peak_and_once_per_landing(self):
        player = {'fall_peak': None}
        self.assertIsNone(record_fall_landing(player, 4, 4.5, True))
        self.assertIsNone(record_fall_landing(player, 4.5, 5.2, True))
        self.assertIsNone(record_fall_landing(player, 5.2, 3.1, True))
        height, damage = record_fall_landing(player, 3.1, 1.2, False)
        self.assertAlmostEqual(height, 4)
        self.assertEqual(damage, 3)
        self.assertIsNone(record_fall_landing(player, 1.2, 1.2, False))

    def test_walk_off_platform_and_respawn_clears_peak(self):
        player = {}
        self.assertIsNone(record_fall_landing(player, 5, 4, True))
        self.assertEqual(record_fall_landing(player, 4, 0, False), (5, 5))
        self.assertIsNone(record_fall_landing(player, 0, 0, False))
        player['fall_peak'] = None
        self.assertIsNone(record_fall_landing(player, 0, 0, False))


if __name__ == '__main__':
    unittest.main()


class FallDamageNetworkTests(unittest.IsolatedAsyncioTestCase):
    async def test_authoritative_damage_once_and_lethal_respawn(self):
        import asyncio
        import json
        import tempfile
        from pathlib import Path
        from websockets.asyncio.client import connect
        from websockets.asyncio.server import serve
        from forest_server import World, height_at

        async def await_event(ws, kind):
            for _ in range(12):
                event = json.loads(await asyncio.wait_for(ws.recv(), 2))
                if event.get('type') == kind:
                    return event
            self.fail('missing event: ' + kind)

        with tempfile.TemporaryDirectory() as folder:
            world = World(Path(folder) / 'world.json')
            server = await serve(world.handler, '127.0.0.1', 0)
            url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
            try:
                async with connect(url) as ws:
                    await await_event(ws, 'welcome')
                    player = next(iter(world.clients.values()))
                    floor = height_at(world.seed, 0, 0)
                    packet = {'type': 'move', 'x': 0, 'z': 0,
                              'y': floor, 'yaw': 0, 'jumping': False}
                    player.update(y=floor+3.4, jumping=True, fall_peak=floor+3.4)
                    await ws.send(json.dumps(packet))
                    await await_event(ws, 'vitals_state')
                    impact = await await_event(ws, 'fall_impact')
                    self.assertEqual(impact['damage'], 2)
                    self.assertAlmostEqual(impact['height'], 3.4)
                    self.assertEqual(player['health'], 3)
                    await ws.send(json.dumps(packet))
                    await asyncio.sleep(.03)
                    self.assertEqual(player['health'], 3,
                                     'remaining on ground cannot double damage')
                    player.update(y=floor+5.1, jumping=True, fall_peak=floor+5.1)
                    await ws.send(json.dumps(packet))
                    await await_event(ws, 'player_respawn')
                    self.assertEqual(player['health'], 5)
                    self.assertEqual(player['hunger'], 3)
                    self.assertEqual(len(world.boxes), 1,
                                     'fatal fall drops inventory through normal death handler')
            finally:
                server.close()
                await server.wait_closed()
