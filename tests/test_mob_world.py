import tempfile
import unittest
from pathlib import Path

from forest_server import World, new_inventory
from entity_combat import can_damage_entity, entity_relation
from hen_world import HenWorld
from mob_definitions import CHICKEN, DEFINITIONS, MobDefinition, PASSIVE_TEST_MOB, register_definition
from mob_world import MobPopulation, MobWorld, _appearance


class MobPopulationTests(unittest.TestCase):
    def test_damage_relation_allows_neutral_wildlife_without_friendly_fire(self):
        player={'id':1,'faction':'players','health':5}
        chicken={'id':'h:0,0:0:g0','faction':'wildlife','health':1}
        ally={'id':2,'faction':'players','health':5}
        self.assertEqual(entity_relation(player,chicken),'neutral')
        self.assertTrue(can_damage_entity(player,chicken,1))
        self.assertEqual(entity_relation(player,ally),'friendly')
        self.assertFalse(can_damage_entity(player,ally,1))
        self.assertFalse(can_damage_entity(player,chicken,float('nan')))
        self.assertFalse(can_damage_entity(player,{**chicken,'health':0},1))

    def test_generic_species_damage_loot_and_passive_ai(self):
        world = MobWorld(19, (CHICKEN, PASSIVE_TEST_MOB))
        chicken = world.populations['chicken']
        spirit = world.populations['forest_spirit']
        self.assertIsInstance(chicken, MobPopulation)
        record = spirit._spawn_record(0, 0, 0, 0)
        record.update(x=0.0, y=0.0, z=0.0, state='Walk', state_start=10.0, state_until=30.0,
                      vx=.34, vz=0.0)
        spirit.live[record['id']] = record
        # Nearby players do not trigger flee in the passive behavior.
        spirit.tick([{'x':0.0, 'z':0.0}], .1, 11.0, lambda x,z: True, lambda x,z: 0.0)
        self.assertNotEqual(record['state'], 'Run')
        self.assertLess(abs(record['vx']), PASSIVE_TEST_MOB.run_speed)
        first = spirit.damage(record['id'], 1, 12.0)
        self.assertEqual(first, {'alive':True, 'health':2, 'id':record['id']})
        self.assertFalse(spirit.corpses)
        self.assertIn(record['id'], spirit.live)
        lethal = spirit.damage(record['id'], 2, 13.0)
        self.assertFalse(lethal['alive'])
        corpse = spirit.corpses[record['id']]
        self.assertEqual(set(corpse['loot']), {'branch', 'stone'})
        self.assertTrue(1 <= corpse['loot']['branch'] <= 2)
        self.assertEqual(corpse['loot']['stone'], 1)
        self.assertIsNone(spirit.damage(record['id'], 1, 14.0))
        self.assertEqual(corpse['loot']['branch'], spirit.take(record['id'], 'branch', 99))

    def test_animation_role_aliases_and_later_population_ticks_after_first_ttl_expiry(self):
        aliased = MobDefinition(
            type_id='aliased_wildlife', id_prefix='m_aliased', health=2,
            behavior='wary', states=('Stand','Stroll','Sprint'),
            animations={'idle':'Stand','walk':'Stroll','run':'Sprint'},
            loot={'stone':(1,1)},
        )
        population = MobPopulation(5, aliased)
        row = population._spawn_record(1, 0, 0, 0)
        row.update(x=0.0,z=0.0,state='Stroll',state_start=10,state_until=30)
        population.live[row['id']] = row
        population.tick([{'x':0.0,'z':0.0}],.1,11,lambda x,z:True,lambda x,z:0)
        self.assertEqual(row['state'],'Sprint')
        self.assertTrue(population.can_target({'faction':'player'}) is False)

        multi = MobWorld(6,(CHICKEN,PASSIVE_TEST_MOB))
        chicken = multi.populations['chicken']
        dead = chicken._spawn_record(0,0,0,0)
        chicken.live[dead['id']] = dead
        chicken.kill(dead['id'],1)
        spirit = multi.populations['forest_spirit']
        active = spirit._spawn_record(0,0,0,0)
        active.update(x=1.0,z=0.0,state='Walk',state_start=3999,state_until=4001,yaw=0.0)
        spirit.live[active['id']] = active
        multi.tick([{'x':0.0,'z':0.0}],.1,4000,lambda x,z:True,lambda x,z:0)
        self.assertNotIn(dead['id'],chicken.corpses)
        self.assertGreater(active['z'],0.0)

    def test_two_types_save_reload_without_id_collision_and_legacy_chicken_alias(self):
        world = MobWorld(321, (CHICKEN, PASSIVE_TEST_MOB))
        for population in world.populations.values():
            row = population._spawn_record(1, -1, 0, 0)
            population.live[row['id']] = row
        self.assertEqual(len({ident for p in world.populations.values() for ident in p.live}), 2)
        snapshot = world.save_data()
        restored = MobWorld(321, (CHICKEN, PASSIVE_TEST_MOB), snapshot)
        self.assertEqual(set(restored.populations), {'chicken', 'forest_spirit'})
        for type_id in restored.populations:
            source_id = next(iter(world.populations[type_id].live))
            self.assertEqual(restored.populations[type_id].live[source_id]['subcategory'],
                             world.populations[type_id].live[source_id]['subcategory'])
        self.assertIsInstance(HenWorld(321, snapshot['chicken']), HenWorld)

    def test_world_reads_and_writes_optional_registered_mob_populations(self):
        old = DEFINITIONS.get(PASSIVE_TEST_MOB.type_id)
        register_definition(PASSIVE_TEST_MOB)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / 'multi-world.json'
                world = World(path)
                spirit = world.mobs.populations['forest_spirit']
                row = spirit._spawn_record(2, 1, 0, 0)
                spirit.live[row['id']] = row
                world.save()
                loaded = World(path)
                self.assertIn(row['id'], loaded.mobs.populations['forest_spirit'].live)
                self.assertIn('chicken', loaded.mobs.populations)
                self.assertIn('forest_spirit', __import__('json').loads(path.read_text())['mobs'])
        finally:
            if old is None:
                DEFINITIONS.pop(PASSIVE_TEST_MOB.type_id, None)


class MobWebSocketTests(unittest.IsolatedAsyncioTestCase):
    async def test_generic_multihit_and_loot_packet_contract(self):
        import asyncio, json
        from websockets.asyncio.server import serve
        from websockets.asyncio.client import connect
        with tempfile.TemporaryDirectory() as tmp:
            world = World(Path(tmp) / 'mob-ws.json')
            spirit = world.register_mob(PASSIVE_TEST_MOB)
            world.hen_line_of_sight = lambda player, mob: True
            server = await serve(world.handler,'127.0.0.1',0)
            port = server.sockets[0].getsockname()[1]
            try:
                async with connect(f'ws://127.0.0.1:{port}') as ws:
                    await asyncio.wait_for(ws.recv(),2)  # welcome
                    player = next(iter(world.clients.values()))
                    player['axe_equipped'] = True
                    mob = spirit._spawn_record(0,0,0,0)
                    mob.update(x=0.0,z=0.0,y=0.0)
                    spirit.live[mob['id']] = mob

                    async def next_type(expected):
                        while True:
                            packet=json.loads(await asyncio.wait_for(ws.recv(),2))
                            if packet.get('type')==expected:
                                return packet

                    for hp in (2,1):
                        await ws.send(json.dumps({'type':'mob_hit','id':mob['id']}))
                        packet=await next_type('mob_hit')
                        self.assertEqual(packet['health'],hp)
                        self.assertIn(mob['id'],spirit.live)
                        await asyncio.sleep(.31)
                    await ws.send(json.dumps({'type':'mob_hit','id':mob['id']}))
                    death=await next_type('mob_death')
                    self.assertEqual(death['type'],'mob_death')
                    self.assertEqual(death['mob_type'],'forest_spirit')
                    self.assertEqual(death['health'],0)
                    await ws.send(json.dumps({'type':'mob_take','id':mob['id'],'item':'branch'}))
                    loot=await next_type('inventory_state')
                    self.assertGreater(loot['corpse_loot']['count'],0)
                    self.assertNotIn('hen_loot',loot)
            finally:
                server.close()
                await server.wait_closed()

    def test_chicken_subcategory_is_deterministic_in_legacy_live_and_corpse_saves(self):
        hens = HenWorld(777)
        record = hens._spawn_record(0, 0, 0, 0)
        expected = _appearance(777, record['id'], CHICKEN)
        self.assertIn(expected, ('russet', 'white', 'black', 'golden', 'speckled'))
        legacy_record = {k:v for k,v in record.items() if k not in ('category', 'subcategory')}
        restored = HenWorld(777, {'corpses':{}, 'sources':{}, 'live':{record['id']:legacy_record}})
        self.assertEqual(restored.live[record['id']]['subcategory'], expected)
        hens.live[record['id']] = record
        corpse = hens.kill(record['id'], 1000)
        saved = hens.save_data()
        self.assertEqual(saved['corpses'][record['id']]['subcategory'], expected)
        self.assertEqual(HenWorld(777, saved).corpses[record['id']]['subcategory'], expected)

    def test_server_generic_hit_and_take_share_validation_and_capacity(self):
        async def scenario():
            with tempfile.TemporaryDirectory() as tmp:
                server = World(Path(tmp) / 'mob-world.json')
                spirit = server.register_mob(PASSIVE_TEST_MOB)
                server.hen_line_of_sight = lambda player, mob: True
                player = {'id':1,'x':0.0,'z':0.0,'axe_equipped':True,
                          'inventory':new_inventory(),'wood':0}
                mob = spirit._spawn_record(0, 0, 0, 0)
                mob.update(x=0.0, z=0.0, y=0.0)
                spirit.live[mob['id']] = mob
                self.assertTrue(await server.hit_mob(player,mob['id'],100,damage=1))
                self.assertEqual(spirit.live[mob['id']]['health'], 2)
                self.assertNotIn(mob['id'], spirit.corpses)
                self.assertTrue(await server.hit_mob(player,mob['id'],101,damage=2))
                corpse = spirit.corpses[mob['id']]
                self.assertEqual(set(corpse['loot']), {'branch','stone'})
                ok, count = server.take_mob(player,mob['id'],'branch',now=102)
                self.assertTrue(ok)
                self.assertGreater(count, 0)
                self.assertEqual(corpse['loot']['branch'], 0)
        import asyncio
        asyncio.run(scenario())


if __name__ == '__main__':
    unittest.main()

class MobPursuitTests(unittest.TestCase):
    def test_pursuit_uses_current_position_and_does_not_duplicate_at_spawn(self):
        population = MobPopulation(123, CHICKEN)
        population.activate([{'x':0,'z':0}],1000,lambda x,z:True,lambda x,z:0)
        mob = population.live['h:0,0:0:g0']
        ident, origin = mob['id'], {'x':mob['x'],'z':mob['z']}
        for step in range(750):
            player = {'x':mob['x']-2,'z':mob['z']}
            population.tick([player],.2,1000+step*.2,lambda x,z:True,lambda x,z:0)
            self.assertIn(ident,population.live,f'pursued mob vanished at step {step}')
            mob = population.live[ident]
            self.assertLess(abs(mob['x']-player['x']),4)
        self.assertGreater(mob['x']-origin['x'],500)
        player = {'x':mob['x']-2,'z':mob['z']}
        population.activate([origin,player],1150,lambda x,z:True,lambda x,z:0)
        self.assertEqual(sum(row['id']==ident for row in population.views(player['x'],player['z'],1150)),1)
        self.assertGreater(population.live[ident]['x']-origin['x'],500)
        restored = MobPopulation(123,CHICKEN,population.save_data())
        restored.activate([player],1151,lambda x,z:True,lambda x,z:0)
        self.assertIn(ident,restored.live)
        self.assertGreater(restored.live[ident]['x']-origin['x'],500)

    def test_nearest_budget_ranks_the_current_mob_not_its_old_spawn_position(self):
        from dataclasses import replace
        population = MobPopulation(123,replace(CHICKEN,live_limit=1))
        chased = population._spawn_record(0,0,0,0)
        chased.update(x=100.0,z=0.0,y=0.0)
        other = population._spawn_record(1,0,0,0)
        other.update(x=85.0,z=0.0,y=0.0)
        population.live = {chased['id']:chased,other['id']:other}
        population.activate([{'x':100,'z':0}],1000,lambda x,z:True,lambda x,z:0)
        self.assertIn(chased['id'],population.live)
        self.assertEqual(population.live[chased['id']]['x'],100)
