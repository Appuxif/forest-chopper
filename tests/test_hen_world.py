import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path

from forest_server import World, new_inventory, inv_add
from hen_world import HenWorld, RESPAWN_DELAY, CORPSE_TTL


class HenWorldTests(unittest.TestCase):
    def test_guaranteed_starter_trio_determinism_and_population_cap(self):
        a, b = HenWorld(123), HenWorld(123)
        standable = lambda x, z: True
        height = lambda x, z: 7.0
        player = {'x': 0.0, 'z': 0.0}
        a.activate([player], 1000, standable, height)
        b.activate([player], 1000, standable, height)
        self.assertTrue({'h:0,0:0:g0','h:0,0:1:g0','h:0,0:2:g0'} <= set(a.live))
        self.assertEqual(set(a.live), set(b.live))
        self.assertLessEqual(len(a.live), 24)
        self.assertTrue(all(hen['y'] == 7 for hen in a.live.values()))

    def test_dry_ground_gate_and_distant_players_prune_active_records(self):
        hens = HenWorld(44)
        hens.activate([{'x':0,'z':0}], 10, lambda x,z: False, lambda x,z: 0)
        self.assertFalse(hens.live)
        hens.activate([{'x':10000,'z':10000}], 10, lambda x,z: True, lambda x,z: 0)
        self.assertLessEqual(len(hens.live), 24)

    def test_kill_once_loot_and_respawn_with_corpse_coexistence(self):
        hens = HenWorld(1)
        hen = hens._spawn_record(0, 0, 0, 0)
        hen.update(x=0.0, z=0.0, y=1.0, vx=1.25, vz=-.5)
        hens.live[hen['id']] = hen
        corpse = hens.kill(hen['id'], 1000)
        self.assertIsNotNone(corpse)
        self.assertIsNone(hens.kill(hen['id'], 1001))
        self.assertEqual((corpse['vx'], corpse['vz']), (1.25, -.5))
        self.assertEqual(corpse['respawn_at'], 1000 + RESPAWN_DELAY)
        hens.activate([{'x':0,'z':0}], 1000 + RESPAWN_DELAY - .1, lambda x,z: True, lambda x,z: 0)
        self.assertNotIn(hen['id'], hens.live)
        hens.activate([{'x':0,'z':0}], 1000 + RESPAWN_DELAY + .1, lambda x,z: True, lambda x,z: 0)
        self.assertIn('h:0,0:0:g1', hens.live)
        self.assertIn(hen['id'], hens.corpses)
        hens.tick([], .1, 1000 + CORPSE_TTL + .1, lambda x,z: True, lambda x,z: 0)
        self.assertNotIn(hen['id'], hens.corpses)
        # Tombstone survives body expiry and server restart, preventing generation rollback.
        restored = HenWorld(1, hens.save_data())
        restored.activate([{'x':0,'z':0}], 1000 + CORPSE_TTL + .2, lambda x,z: True, lambda x,z: 0)
        self.assertIn('h:0,0:0:g1', restored.live)

    def test_live_hen_position_action_and_rng_survive_save_reload(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'live-world.json'
            world = World(path)
            hen = world.hens._spawn_record(0, 0, 0, 0)
            now = time.time()
            hen.update(x=22.75, y=3.25, z=7.5, yaw=1.2, vx=.34, vz=0.0,
                       state='Walk', state_start=now-2, state_until=now+4,
                       rng_state=123456789, _calm=now-5)
            world.hens.live[hen['id']] = hen
            world.save()
            loaded = World(path)
            restored = loaded.hens.live[hen['id']]
            loaded.hens.tick([], .1, now+1, lambda x,z:True, lambda x,z:3.25)
            self.assertEqual(restored['x'],22.75)
            self.assertEqual((restored['x'],restored['y'],restored['z']), (22.75,3.25,7.5))
            self.assertEqual((restored['state'],restored['state_start'],restored['state_until']),
                             ('Walk',hen['state_start'],hen['state_until']))
            self.assertEqual(restored['rng_state'],123456789)
            loaded.hens.activate([{'x':22.75,'z':7.5}], now+1, lambda x,z:True, lambda x,z:3.25)
            active=loaded.hens.live[hen['id']]
            self.assertEqual((active['x'],active['state'],active['rng_state']),
                             (22.75,'Walk',123456789))
            payload=loaded.hens.save_data()
            bad=dict(payload['live'][hen['id']]);bad['state_start']='yesterday'
            loaded.hens=HenWorld(loaded.seed, {'corpses':payload['corpses'],
                'sources':payload['sources'],'live':{hen['id']:bad}})
            self.assertNotIn(hen['id'],loaded.hens.live)

    def test_live_save_is_bounded(self):
        hens=HenWorld(5)
        for i in range(300):
            hen=hens._spawn_record(i,0,0,0)
            hens.live[hen['id']]=hen
        saved=hens.save_data()['live']
        self.assertEqual(len(saved),256)
        self.assertEqual(list(saved),sorted(saved))

    def test_old_save_without_hens_and_hen_save_roundtrip(self):
        hens = HenWorld(4)
        self.assertEqual(hens.save_data(), {'corpses': {}, 'sources': {}, 'live': {}})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'world.json'
            path.write_text(json.dumps({'seed': 42}))
            world = World(path)
            self.assertIsInstance(world.hens, HenWorld)
            self.assertFalse(world.hens.corpses)

    def test_server_actions_reject_repeats_and_capacity_then_allow_loot(self):
        async def scenario():
            with tempfile.TemporaryDirectory() as tmp:
                world = World(Path(tmp) / 'world.json')
                world.hen_line_of_sight = lambda player, hen: True
                player = {'id':1,'x':0.0,'z':0.0,'axe_equipped':True,
                          'inventory':new_inventory(),'wood':0}
                hen = world.hens._spawn_record(0, 0, 0, 0)
                hen.update(x=0.0,z=0.0,y=0.0)
                world.hens.live[hen['id']] = hen
                self.assertFalse(await world.hit_hen({**player,'axe_equipped':False},hen['id'],1))
                self.assertTrue(await world.hit_hen(player,hen['id'],1))
                self.assertFalse(await world.hit_hen(player,hen['id'],2))
                corpse = world.hens.corpses[hen['id']]
                corpse['loot']={'chicken_meat':1,'feather':1}
                player['inventory'][:] = [None] * len(player['inventory'])
                player['inventory'][:] = [{'id':'feather','count':10} for _ in player['inventory']]
                ok, reason = world.take_hen(player,hen['id'],'chicken_meat',None,now=2)
                self.assertFalse(ok)
                self.assertEqual(reason,'Сумка заполнена')
                self.assertEqual(corpse['loot']['chicken_meat'],1)
                player['inventory'][:] = [None] * len(player['inventory'])
                ok, count = world.take_hen(player,hen['id'],'chicken_meat',None,now=2)
                self.assertTrue(ok);self.assertEqual(count,1)
                self.assertEqual(world.take_hen(player,hen['id'],'chicken_meat',None,now=2),(False,'empty'))
                self.assertEqual(world.hens.corpses[hen['id']]['loot']['feather'],1)
        asyncio.run(scenario())

    def test_mob_and_legacy_axe_reach_are_halved_without_damaging_distant_targets(self):
        async def scenario():
            with tempfile.TemporaryDirectory() as tmp:
                for legacy in (False, True):
                    world = World(Path(tmp) / f'range-{legacy}.json')
                    world.hen_line_of_sight = lambda player, hen: True
                    player = {'id':1,'x':0.0,'z':0.0,'axe_equipped':True}
                    hen = world.hens._spawn_record(0, 0, 0, 0)
                    hen.update(x=3.251,z=0.0,y=0.0)
                    world.hens.live[hen['id']] = hen
                    hit = world.hit_hen if legacy else world.hit_mob
                    self.assertFalse(await hit(player,hen['id'],1000))
                    self.assertEqual(hen['health'],1)
                    self.assertNotIn(hen['id'],world.hens.corpses)
                    hen['x'] = 3.25
                    self.assertTrue(await hit(player,hen['id'],1001))
                    self.assertIn(hen['id'],world.hens.corpses)
        asyncio.run(scenario())


if __name__ == '__main__':
    unittest.main()


class HenWebSocketIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_server_authoritative_hit_and_take_all(self):
        from websockets.asyncio.server import serve
        from websockets.asyncio.client import connect
        import time
        with tempfile.TemporaryDirectory() as tmp:
            world = World(Path(tmp) / 'online.json')
            world.hen_line_of_sight = lambda player, hen: True
            server = await serve(world.handler, '127.0.0.1', 0)
            port = server.sockets[0].getsockname()[1]
            hen_task = None
            try:
                async with connect(f'ws://127.0.0.1:{port}') as ws:
                    welcome = json.loads(await asyncio.wait_for(ws.recv(), 2))
                    self.assertEqual(welcome['type'], 'welcome')
                    player = next(iter(world.clients.values()))
                    hen = world.hens._spawn_record(0, 0, 0, 0)
                    hen.update(x=0.0, z=0.0, y=0.0)
                    world.hens.live[hen['id']] = hen
                    await ws.send(json.dumps({'type':'hen_hit','id':hen['id']}))
                    death = json.loads(await asyncio.wait_for(ws.recv(), 2))
                    self.assertEqual(death['type'], 'hen_death')
                    corpse = world.hens.corpses[hen['id']]
                    self.assertEqual(death['vx'], corpse['vx'])
                    self.assertEqual(player['stamina'], 4.0)
                    vitals = json.loads(await asyncio.wait_for(ws.recv(), 2))
                    self.assertEqual(vitals['type'], 'vitals_state')
                    item = 'chicken_meat'
                    expected = corpse['loot'][item]
                    await ws.send(json.dumps({'type':'hen_take','id':hen['id'],'item':item}))
                    inventory = json.loads(await asyncio.wait_for(ws.recv(), 2))
                    self.assertEqual(inventory['type'], 'inventory_state')
                    self.assertEqual(inventory['hen_loot'], {'id':hen['id'],'item':item,'count':expected})
                    self.assertEqual(sum(i['count'] for i in inventory['inventory']['slots'] if i and i['id']==item), expected)
                    self.assertEqual(corpse['loot'][item], 0)
                    await ws.send(json.dumps({'type':'hen_take','id':hen['id'],'item':item}))
                    await asyncio.sleep(.05)
                    self.assertEqual(corpse['loot'][item], 0)
                    hen_task=asyncio.create_task(world.hen_simulation_loop())
                    state=None
                    for _ in range(8):
                        packet=json.loads(await asyncio.wait_for(ws.recv(),2))
                        if packet['type']=='hens_state':
                            state=packet;break
                    self.assertIsNotNone(state)
                    self.assertGreater(state['server_time'],0)
                    self.assertTrue(all({'id','x','y','z','yaw','vx','vz','state','state_start'}<=set(row) for row in state['hens']))
            finally:
                if hen_task:
                    hen_task.cancel()
                    await asyncio.gather(hen_task,return_exceptions=True)
                server.close()
                await server.wait_closed()

class HenConcurrentLootTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_players_cannot_receive_the_same_meat(self):
        with tempfile.TemporaryDirectory() as tmp:
            world = World(Path(tmp) / 'race.json')
            world.hen_line_of_sight = lambda player, hen: True
            hen = world.hens._spawn_record(0, 0, 0, 0)
            hen.update(x=0.0, z=0.0, y=0.0)
            world.hens.live[hen['id']] = hen
            import time
            corpse = world.hens.kill(hen['id'], time.time())
            expected = corpse['loot']['chicken_meat']
            players = [{'x':0.0,'z':0.0,'inventory':new_inventory()} for _ in range(2)]
            async def claim(player):
                await asyncio.sleep(0)
                return world.take_hen(player, hen['id'], 'chicken_meat')
            results = await asyncio.gather(*(claim(p) for p in players))
            self.assertEqual(sum(bool(ok) for ok, _ in results), 1)
            received = sum(item['count'] for p in players for item in p['inventory']
                           if item and item['id'] == 'chicken_meat')
            self.assertEqual(received, expected)
            self.assertEqual(corpse['loot']['chicken_meat'], 0)

class HenAxeMotionTests(unittest.TestCase):
    def test_hit_adds_away_motion_and_keeps_sideways_running_inertia_once(self):
        hens = HenWorld(123)
        hen = hens._spawn_record(0, 0, 0, 0)
        hen.update(x=0.0,z=1.0,vx=4.5,vz=0.0)
        hens.live[hen['id']] = hen
        corpse = hens.kill(hen['id'],1000,attacker={'x':0,'z':0})
        self.assertAlmostEqual(corpse['vx'],1.35)
        self.assertAlmostEqual(corpse['vz'],2.0)
        self.assertIsNone(hens.kill(hen['id'],1001,attacker={'x':0,'z':2}))
        self.assertAlmostEqual(corpse['vz'],2.0)
