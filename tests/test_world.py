"""Regression coverage for real-player WebSocket and isolated save/load."""
import asyncio
import json
import time
import math
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from websockets.asyncio.server import serve
from websockets.asyncio.client import connect
from forest_server import World, tree_info, inv_give_logs, inv_logs, inventory_view, resource_info, resource_nearby, resource_cell, decor_resource, nearby_decor, DECOR_ITEM_IDS, inv_count, inv_add, vitals_view,advance_hunger,apply_food,FOOD_EFFECTS,LOW_VITALS_THRESHOLD,HUNGER_INTERVAL_SECONDS,BOX_TTL_SECONDS, RESOURCE_LIMIT, RESOURCE_RESPAWN_SECONDS


class WorldTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name) / 'isolated-world.json'
        self.world = World(self.path)
        self.server = await serve(self.world.handler, '127.0.0.1', 0)
        self.port = self.server.sockets[0].getsockname()[1]
        self.url = f'ws://127.0.0.1:{self.port}'

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()
        self.folder.cleanup()

    async def receive(self, ws, event):
        for _ in range(6):
            message = json.loads(await asyncio.wait_for(ws.recv(), 2))
            if message['type'] == event:
                return message
        self.fail(f'Expected event: {event}')

    async def test_invalid_save_does_not_half_load_world(self):
        # A syntactically valid but inconsistent save must not leave a partial seed/felled state.
        self.path.write_text(json.dumps({
            'seed': 9999, 'felled': ['0,0:0'],
            'damage': {'0,0:1': 'not-a-number'},
            'logs': {'2': {'x': 1, 'z': 2, 'y': .29, 'level': 0, 'orientation': 0}},
        }))
        with patch('forest_server.random.randrange', return_value=123456):
            loaded = World(self.path)
        self.assertEqual(loaded.seed, 123456)
        self.assertFalse(loaded.felled)
        self.assertFalse(loaded.damage)
        self.assertFalse(loaded.logs)

    async def test_welcome_chat_join_leave_and_invalid_messages(self):
        async with connect(self.url) as alice:
            welcome = await self.receive(alice, 'welcome')
            self.assertEqual(welcome['seed'], self.world.seed)
            await alice.send('not valid json')
            await alice.send(json.dumps({'type': 'move', 'x': float('nan'), 'z': 0, 'yaw': 0}))
            await alice.send(json.dumps({'type': 'move', 'x': 90000, 'z': 0, 'yaw': 0}))
            async with connect(self.url) as bob:
                await self.receive(bob, 'welcome')
                await bob.send(json.dumps({'type': 'hello', 'name': 'Bob'}))
                join = await self.receive(alice, 'join')
                self.assertEqual(join['player']['name'], 'Bob')
                await alice.send(json.dumps({'type': 'chat', 'text': ' hi forest '}))
                received = await self.receive(bob, 'chat')
                self.assertEqual(received['text'], 'hi forest')
                self.assertEqual(received['id'], 1)
                self.assertEqual(next(p['x'] for p in self.world.clients.values() if p['id'] == welcome['id']), 0)
            leave = await self.receive(alice, 'leave')
            self.assertEqual(leave['id'], join['player']['id'])
        for _ in range(20):
            if not self.world.clients:
                break
            await asyncio.sleep(.01)
        self.assertFalse(self.world.clients)

    async def test_ping_pong_is_direct_and_validates_nonce(self):
        async with connect(self.url) as alice:
            await self.receive(alice, 'welcome')
            async with connect(self.url) as bob:
                await self.receive(bob, 'welcome')
                await alice.send(json.dumps({'type': 'ping', 'nonce': 345}))
                pong = await self.receive(alice, 'pong')
                self.assertEqual(pong['nonce'], 345)
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(), .08)  # RTT is private, not broadcast.
                await alice.send(json.dumps({'type': 'ping', 'nonce': 'not-an-int'}))
                await alice.send(json.dumps({'type': 'ping', 'nonce': -1}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(alice.recv(), .08)

    async def test_map_pings_are_ephemeral_validated_and_rate_limited(self):
        async with connect(self.url) as alice:
            welcome = await self.receive(alice, 'welcome')
            await alice.send(json.dumps({'type': 'hello', 'name': 'Sender'}))
            async with connect(self.url) as bob:
                await self.receive(bob, 'welcome')
                # The server decides who authored the marker; client-supplied identities are ignored.
                await alice.send(json.dumps({
                    'type': 'map_ping', 'x': 12.345, 'z': -4.44,
                    'name': 'Forged', 'by': 9999,
                }))
                a = await self.receive(alice, 'map_ping')
                b = await self.receive(bob, 'map_ping')
                self.assertEqual(a, b)
                self.assertEqual(a, {'type': 'map_ping', 'by': welcome['id'],
                                     'name': 'Sender', 'x': 12.3, 'z': -4.4})
                self.assertFalse(self.path.exists(), 'map pings do not persist world state')
                await alice.send(json.dumps({'type': 'map_ping', 'x': 13, 'z': 0}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(), .08)

                player = next(p for p in self.world.clients.values() if p['id'] == welcome['id'])
                for x, z in ((float('nan'), 0), (float('inf'), 0),
                             (200000, 0), (56, 0), ('invalid', 0)):
                    player['last_map_ping'] = 0
                    await alice.send(json.dumps({'type': 'map_ping', 'x': x, 'z': z}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(bob.recv(), .06)
                player['last_map_ping'] = 0
                await alice.send(json.dumps({'type': 'map_ping', 'x': 20, 'z': -10}))
                response = await self.receive(bob, 'map_ping')
                self.assertEqual((response['x'], response['z']), (20, -10))
                self.assertEqual(len(self.world.chat), 0)
                self.assertFalse(self.path.exists())

    async def test_place_remove_height_resources_and_save_roundtrip(self):
        async with connect(self.url) as alice:
            welcome = await self.receive(alice, 'welcome')
            async with connect(self.url) as bob:
                await self.receive(bob, 'welcome')
                owner=next(p for p in self.world.clients.values() if p['id']==welcome['id'])
                # Old requests cannot bypass the equipped-inventory protocol.
                await alice.send(json.dumps({'type':'place','x':2,'z':0,'orientation':0}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(),.06)
                inv_give_logs(owner['inventory'],4)
                owner['wood']=4
                await alice.send(json.dumps({'type':'select_slot','slot':1}))
                self.assertFalse((await self.receive(bob,'equipment'))['axe_equipped'])
                await self.receive(alice,'inventory_state')
                # Equipped log spends one from all bag stacks.
                await alice.send(json.dumps({'type':'place_item','x':2,'z':0,'orientation':0}))
                placed=await self.receive(bob,'log_add')
                self.assertEqual(placed['log']['level'],0)
                self.assertEqual(placed['wood'],3)
                lid=placed['log']['id']
                self.assertEqual((await self.receive(alice,'log_add'))['log']['id'],lid)
                await self.receive(alice,'inventory_state')
                for payload in ({'x':1.3,'z':0,'orientation':0},
                                {'x':2,'z':0,'orientation':7},
                                {'x':200,'z':0,'orientation':0},
                                {'x':float('nan'),'z':0,'orientation':0}):
                    owner['last_build']=0
                    await alice.send(json.dumps({'type':'place_item',**payload}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(bob.recv(),.035)
                self.assertEqual(len(self.world.logs),1)
                self.world.logs[lid]['level']=15
                owner['last_build']=0
                await alice.send(json.dumps({'type':'place_item','x':2,'z':0,'orientation':0}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(),.055)
                self.assertEqual(owner['wood'],3)
                self.world.logs[lid]['level']=0
                self.world.save()
                self.assertEqual(World(self.path).logs[lid]['level'],0)
                # An axe must be selected before a structure can be dismantled.
                owner['last_build']=0
                await alice.send(json.dumps({'type':'hit_structure','kind':'log','id':lid}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(),.055)
                await alice.send(json.dumps({'type':'select_slot','slot':0}))
                self.assertTrue((await self.receive(bob,'equipment'))['axe_equipped'])
                await self.receive(alice,'inventory_state')
                await alice.send(json.dumps({'type':'hit_structure','kind':'log','id':lid+100}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(),.055)
                owner['last_build']=0
                await alice.send(json.dumps({'type':'hit_structure','kind':'log','id':lid}))
                removed=await self.receive(bob,'log_remove')
                self.assertEqual(removed['wood'],4)
                self.assertEqual(inv_logs(owner['inventory']),4)
                self.assertFalse(self.world.logs)
                self.assertFalse(World(self.path).logs)

    async def test_emotes_are_trusted_ephemeral_and_throttled(self):
        async with connect(self.url) as sender:
            welcome=await self.receive(sender,'welcome')
            async with connect(self.url) as receiver:
                await self.receive(receiver,'welcome')
                await sender.send(json.dumps({'type':'emote','kind':'wave','by':9999}))
                expected={'type':'emote','by':welcome['id'],'kind':'wave'}
                self.assertEqual(await self.receive(receiver,'emote'),expected)
                self.assertEqual(await self.receive(sender,'emote'),expected)
                await sender.send(json.dumps({'type':'emote','kind':'thumbs_up'}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(receiver.recv(),.07)
                player=next(p for p in self.world.clients.values() if p['id']==welcome['id'])
                for bad in ('dance','',None,123,[],{}):
                    player['last_emote']=0
                    await sender.send(json.dumps({'type':'emote','kind':bad}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(receiver.recv(),.035)
                player['last_emote']=0
                await sender.send(json.dumps({'type':'emote','kind':'thumbs_up'}))
                self.assertEqual((await self.receive(receiver,'emote'))['kind'],'thumbs_up')
                self.assertFalse(self.world.chat)
                self.assertFalse(self.path.exists(),'emotes must not write a save')

    async def test_bench_crafting(self):
        async with connect(self.url) as alice:
            welcome=await self.receive(alice,'welcome')
            async with connect(self.url) as bob:
                await self.receive(bob,'welcome')
                owner=next(p for p in self.world.clients.values() if p['id']==welcome['id'])
                # Crafting creates a bag item, never directly builds world furniture.
                await alice.send(json.dumps({'type':'craft_item','recipe':'bench'}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(),.05)
                inv_give_logs(owner['inventory'],10);owner['wood']=10
                await alice.send(json.dumps({'type':'craft_item','recipe':'bench'}))
                updated=await self.receive(alice,'inventory_state')
                self.assertEqual(updated['wood'],7)
                self.assertEqual(inv_logs(owner['inventory']),7)
                bench_slot=next(i for i,x in enumerate(owner['inventory']) if x and x['id']=='bench')
                self.assertLess(bench_slot,4)
                self.assertFalse(self.world.furniture)
                await alice.send(json.dumps({'type':'select_slot','slot':bench_slot}))
                await self.receive(bob,'equipment')
                await self.receive(alice,'inventory_state')
                await alice.send(json.dumps({'type':'place_item','x':4,'z':0,'orientation':0}))
                add=await self.receive(bob,'furniture_add')
                self.assertEqual(add['wood'],7)
                fid=add['item']['id']
                self.assertEqual(add['item']['kind'],'bench')
                self.assertEqual(self.world.furniture[fid]['x'],4)
                self.assertEqual((await self.receive(alice,'furniture_add'))['item']['id'],fid)
                await self.receive(alice,'inventory_state')
                self.assertEqual(len(World(self.path).furniture),1)
                for payload in ({'x':999,'z':0,'orientation':0},
                                {'x':4,'z':0,'orientation':9},
                                {'x':float('nan'),'z':0,'orientation':0}):
                    owner['last_build']=0
                    await alice.send(json.dumps({'type':'place_item',**payload}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(bob.recv(),.035)
                owner['last_build']=0
                await alice.send(json.dumps({'type':'hit_structure','kind':'bench','id':fid}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(),.05)
                await alice.send(json.dumps({'type':'select_slot','slot':0}))
                await self.receive(bob,'equipment')
                await self.receive(alice,'inventory_state')
                owner['last_build']=0
                await alice.send(json.dumps({'type':'hit_structure','kind':'bench','id':fid}))
                removed=await self.receive(bob,'furniture_remove')
                self.assertEqual(removed['wood'],7)
                self.assertFalse(self.world.furniture)
                updated=await self.receive(alice,'inventory_state')
                self.assertEqual(sum(x is not None and x['id']=='bench' for x in updated['inventory']['slots']),1)
                self.assertFalse(World(self.path).furniture)

    async def test_inventory_capacity_and_authoritative_recipe_rejection(self):
        async with connect(self.url) as alice:
            await self.receive(alice,'welcome')
            owner=next(iter(self.world.clients.values()))
            # All 12 slots full (axe + 11 log stacks), even though wood can be spent.
            for i in range(1,12):
                owner['inventory'][i]={'id':'log','count':5}
            owner['wood']=55
            await alice.send(json.dumps({'type':'craft_item','recipe':'bench'}))
            denied=await self.receive(alice,'action_denied')
            self.assertIn('свободный слот',denied['reason'])
            self.assertEqual(owner['wood'],55)
            self.assertEqual(inv_logs(owner['inventory']),55)
            # Also reject destructive axe hits if return resource cannot fit.
            owner['selected']=0
            self.world.furniture[100]={'kind':'bench','x':1,'z':0,'orientation':0}
            await alice.send(json.dumps({'type':'hit_structure','kind':'bench','id':100}))
            denied=await self.receive(alice,'action_denied')
            self.assertIn('Сумка',denied['reason'])
            self.assertIn(100,self.world.furniture)
            self.assertEqual(sum(item is not None and item['id']=='bench' for item in owner['inventory']),0)
            # Logs must also respect capacity at the source.
            self.assertEqual(inv_give_logs(owner['inventory'],10),0)
            self.assertEqual(owner['wood'],55)

    async def test_gather_branches_stones_craft_axe_and_pickup_box_by_another_player(self):
        async with connect(self.url) as alice:
            wa=await self.receive(alice,'welcome')
            owner=next(p for p in self.world.clients.values() if p['id']==wa['id'])
            async with connect(self.url) as bob:
                wb=await self.receive(bob,'welcome')
                recipient=next(p for p in self.world.clients.values() if p['id']==wb['id'])
                node=next(n for n in wa['resources'] if n['kind'] in ('stone','branch'))
                owner.update(x=node['x'],z=node['z'])
                await alice.send(json.dumps({'type':'collect_resource','id':node['id']}))
                self.assertEqual((await self.receive(alice,'resource_remove'))['id'],node['id'])
                self.assertEqual((await self.receive(bob,'resource_remove'))['id'],node['id'])
                state=await self.receive(alice,'inventory_state')
                self.assertEqual(sum(x['count'] for x in state['inventory']['slots'] if x and x['id']==node['kind']),1)
                self.assertIn(node['id'],self.world.resource_cooldowns)
                # Server makes crafting authoritative; 3 branches + 2 stones.
                inv_add(owner['inventory'],{'id':'branch','count':3})
                inv_add(owner['inventory'],{'id':'stone','count':2})
                await alice.send(json.dumps({'type':'craft_axe'}))
                state=await self.receive(alice,'inventory_state')
                self.assertEqual(sum(x['id']=='axe' for x in state['inventory']['slots'] if x),2)
                axe_slot=next(i for i,x in enumerate(owner['inventory']) if x and x['id']=='axe' and i!=0)
                await alice.send(json.dumps({'type':'drop_item','slot':axe_slot}))
                added=await self.receive(bob,'box_add')
                self.assertEqual(added['box']['item'],{'id':'axe','tier':0})
                self.assertEqual(added['box']['expires_at']>time.time()+3500,True)
                await self.receive(alice,'box_add')
                await self.receive(alice,'inventory_state')
                box_id=added['box']['id']
                recipient.update(x=added['box']['x'],z=added['box']['z'])
                await bob.send(json.dumps({'type':'pickup_box','id':box_id}))
                self.assertEqual((await self.receive(bob,'box_remove'))['id'],box_id)
                self.assertEqual((await self.receive(alice,'box_remove'))['id'],box_id)
                state=await self.receive(bob,'inventory_state')
                self.assertEqual(sum(x['id']=='axe' for x in state['inventory']['slots'] if x),2)
                self.assertNotIn(box_id,self.world.boxes)
                await bob.send(json.dumps({'type':'pickup_box','id':box_id}))
                with self.assertRaises(asyncio.TimeoutError):await asyncio.wait_for(bob.recv(),.055)

    async def test_box_ttl_is_3600_seconds_and_does_not_depend_on_any_player_position(self):
        self.assertEqual(BOX_TTL_SECONDS,3600)
        now=time.time()
        self.world.boxes[12]={'x':3.0,'z':4.0,'expires_at':now+3600,
                             'item':{'id':'stone','count':6}}
        self.world.save()
        reloaded=World(self.path)
        self.assertIn(12,reloaded.boxes)
        self.assertEqual(await self.world.prune_boxes(now=now+3599),[])
        self.assertIn(12,self.world.boxes)
        self.assertEqual(await self.world.prune_boxes(now=now+3601),[12])
        self.assertNotIn(12,self.world.boxes)
        self.assertNotIn(12,World(self.path).boxes)

    async def test_seeded_resources_are_stable_and_in_nine_cells(self):
        key='-3,7:0'
        self.assertEqual(resource_info(key,123456),
            {'id':'-3,7:0','kind':'branch','x':-23.75,'z':75.69})
        self.assertEqual(resource_info('-3,7:1',123456),
            {'id':'-3,7:1','kind':'branch','x':-25.92,'z':77.06})
        self.assertIsNone(resource_info('garbage',123456))
        first=resource_nearby(123456,0,0,{})
        self.assertGreater(len(first),RESOURCE_LIMIT)
        self.assertEqual(first,resource_nearby(123456,0,0,{}))
        self.assertEqual(first,resource_nearby(123456,0,0,{},now=time.time()+1000))
        self.assertEqual(resource_cell(-.1,10),(-1,1))
        self.assertEqual(len(set(i['id'] for i in first)),len(first))
        self.assertTrue(any(i['z']<0 for i in first))
        self.assertTrue(any(i['z']>0 for i in first))
        second=resource_nearby(123456,51,0,{})
        self.assertNotEqual(first,second)
        self.assertEqual(first,resource_nearby(123456,0,0,{}),
                         'returning to zone does not reroll its positions')

    async def test_existing_decor_species_follow_exact_world_seed_and_inventory_stacks(self):
        flowers=nearby_decor(12345,0,0,{},now=0)
        self.assertEqual(len(flowers),41)
        sample=decor_resource(12345,-1,-1,5)
        self.assertEqual(sample['kind'],'flower:pink_wildflower')
        self.assertAlmostEqual(sample['x'],-13.965131644072244)
        self.assertAlmostEqual(sample['z'],-16.432527240849595)
        self.assertEqual(self.world.resource_view({'x':0,'z':0})['type'],'resources_state')
        self.assertIsNone(decor_resource(12345,0,0,25))
        self.assertIsNone(resource_info('d:1,1:25',12345))
        for species in DECOR_ITEM_IDS:
            self.assertEqual(inv_count([{'id':species,'count':4}],species),4)
            self.assertTrue(inv_add([None]*3,{'id':species,'count':1}))

    async def test_mushrooms_and_flowers_share_server_respawn_and_cross_player_pickup(self):
        async with connect(self.url) as alice:
            welcome=await self.receive(alice,'welcome')
            decor=[item for item in welcome['resources'] if item['id'].startswith('d:')]
            flower=next(item for item in decor if item['kind'].startswith('flower:'))
            mushroom=next(item for item in decor if item['kind'].startswith('mushroom:'))
            async with connect(self.url) as bob:
                other=await self.receive(bob,'welcome')
                self.assertIn(flower,other['resources'])
                self.assertIn(mushroom,other['resources'])
                for item in (flower,mushroom):
                    for player in self.world.clients.values():
                        player.update(x=item['x'],z=item['z'])
                    await alice.send(json.dumps({'type':'collect_resource','id':item['id']}))
                    self.assertEqual((await self.receive(alice,'resource_remove'))['id'],item['id'])
                    self.assertEqual((await self.receive(bob,'resource_remove'))['id'],item['id'])
                    state=await self.receive(alice,'inventory_state')
                    self.assertEqual(sum(v['count'] for v in state['inventory']['slots']
                                         if v and v['id']==item['kind']),1)
                    await bob.send(json.dumps({'type':'collect_resource','id':item['id']}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(bob.recv(),.045)
                    self.assertIn(item['id'],self.world.resource_cooldowns)
                self.world.save()
                saved=World(self.path)
                self.assertEqual(set(saved.resource_cooldowns),{flower['id'],mushroom['id']})
                deadline=max(self.world.resource_cooldowns.values())
                self.assertEqual(set(await self.world.prune_resource_cooldowns(now=deadline+1)),
                                 {flower['id'],mushroom['id']})
                # Both clients receive a refreshed nearby view from the shared server.
                alice_view=await self.receive(alice,'resources_state')
                bob_view=await self.receive(bob,'resources_state')
                self.assertIn(flower,alice_view['resources'])
                self.assertIn(mushroom,alice_view['resources'])
                self.assertIn(flower,bob_view['resources'])
                self.assertIn(mushroom,bob_view['resources'])
                self.assertFalse(World(self.path).resource_cooldowns)

    async def test_shared_pickup_prevents_duplication_and_expires_in_ten_minutes(self):
        async with connect(self.url) as alice:
            welcome=await self.receive(alice,'welcome')
            item=welcome['resources'][0]
            async with connect(self.url) as bob:
                other=await self.receive(bob,'welcome')
                self.assertIn(item,other['resources'])
                for player in self.world.clients.values():
                    player.update(x=item['x'],z=item['z'])
                await alice.send(json.dumps({'type':'collect_resource','id':item['id']}))
                self.assertEqual((await self.receive(bob,'resource_remove'))['id'],item['id'])
                self.assertEqual((await self.receive(alice,'resource_remove'))['id'],item['id'])
                inventory=await self.receive(alice,'inventory_state')
                self.assertEqual(sum(v['count'] for v in inventory['inventory']['slots'] if v and v['id']==item['kind']),1)
                self.assertIn(item['id'],self.world.resource_cooldowns)
                self.assertNotIn(item,resource_nearby(self.world.seed,0,0,self.world.resource_cooldowns))
                await bob.send(json.dumps({'type':'collect_resource','id':item['id']}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(),.055)
                deadline=self.world.resource_cooldowns[item['id']]
                self.assertTrue(time.time()+599<deadline<=time.time()+601)
                self.world.save()
                self.assertIn(item['id'],World(self.path).resource_cooldowns)
                self.assertEqual(await self.world.prune_resource_cooldowns(now=deadline-.1),[])
                self.assertEqual(await self.world.prune_resource_cooldowns(now=deadline+.1),[item['id']])
                self.assertIn(item,(await self.receive(alice,'resources_state'))['resources'])
                self.assertIn(item,(await self.receive(bob,'resources_state'))['resources'])
                self.assertNotIn(item['id'],World(self.path).resource_cooldowns)

    async def test_cooldown_entries_are_saved_and_invalid_values_cannot_poison_world(self):
        item=resource_nearby(self.world.seed,0,0,{})[0]
        deadline=time.time()+200
        self.world.resource_cooldowns[item['id']]=deadline
        self.world.save()
        fresh=World(self.path)
        self.assertIn(item['id'],fresh.resource_cooldowns)
        self.assertNotIn(item,resource_nearby(fresh.seed,0,0,fresh.resource_cooldowns))
        self.assertIn(item,resource_nearby(fresh.seed,0,0,{},now=deadline+1))
        bad=json.loads(self.path.read_text())
        bad['resource_cooldowns']['not-a-resource']=deadline
        self.path.write_text(json.dumps(bad))
        with patch('forest_server.random.randrange',return_value=12345):
            invalid=World(self.path)
        self.assertEqual(invalid.seed,12345)
        self.assertFalse(invalid.resource_cooldowns)

    async def test_player_heading_does_not_affect_seeded_generation(self):
        async with connect(self.url) as ws:
            welcome=await self.receive(ws,'welcome')
            player=next(p for p in self.world.clients.values() if p['id']==welcome['id'])
            await ws.send(json.dumps({'type':'hello','name':'Gatherer','resources':True}))
            await ws.send(json.dumps({'type':'move','x':0,'z':0,'yaw':math.pi}))
            with self.assertRaises(asyncio.TimeoutError):
                await asyncio.wait_for(ws.recv(),.06)
            self.assertEqual(self.world.resource_view(player)['resources'],welcome['resources'])

    async def test_invalid_furniture_save_does_not_crash_or_partially_restore(self):
        for malformed in ([], ['bench'], {'1': {'kind':'bench','x':float('nan'),'z':0,'orientation':0}}):
            self.path.write_text(json.dumps({'seed':9999,'felled':['0,0:1'],
                'damage':{},'logs':{},'furniture':malformed}))
            with patch('forest_server.random.randrange',return_value=456789):
                restored=World(self.path)
            self.assertEqual(restored.seed,456789)
            self.assertFalse(restored.felled)
            self.assertFalse(restored.furniture)

    async def test_shared_team_goal_counts_confirmed_players_and_bots_and_survives_restart(self):
        async with connect(self.url) as alice:
            await self.receive(alice,'welcome')
            async with connect(self.url) as bob:
                welcome=await self.receive(bob,'welcome')
                self.assertEqual(welcome['community_cuts'],0)
                self.world.community_cuts=19
                # A real server hit_tree event that actually fells a tree, not a client claim.
                keys=[k for k in (f'{cx},{cz}:{i}' for cx in range(-2,3)
                       for cz in range(-2,3) for i in range(8))
                       if tree_info(k,self.world.seed)]
                first=keys[0]
                tx,tz,_=tree_info(first,self.world.seed)
                player=next(iter(self.world.clients.values()))
                player.update(x=tx+1.5,z=tz)
                self.world.damage[first]=1
                self.assertTrue(await self.world.hit_tree(player,first,0))
                event=await self.receive(alice,'tree_fell')
                self.assertEqual(event['community_cuts'],20)
                self.assertEqual((await self.receive(bob,'tree_fell'))['community_cuts'],20)
                self.assertEqual(World(self.path).community_cuts,20)
                # Headless bots use the same authoritative hit_tree() path.
                bot=await self.world.bots.create('HelperQA')
                second=keys[1]
                bx,bz,_=tree_info(second,self.world.seed)
                bot.update(x=bx+1.5,z=bz)
                self.world.damage[second]=1
                self.assertTrue(await self.world.hit_tree(bot,second,0))
                self.assertEqual((await self.receive(bob,'tree_fell'))['community_cuts'],21)
                self.assertEqual(self.world.community_cuts,21)
                self.assertEqual(World(self.path).community_cuts,21)
                # Invalid attempts cannot increase team progress.
                self.assertFalse(await self.world.hit_tree(bot,'not:a:tree',0))
                self.assertEqual(self.world.community_cuts,21)
                await self.world.bots.remove(bot['id'])

    async def test_legacy_team_goal_defaults_zero_and_invalid_goal_does_not_half_load(self):
        self.path.write_text(json.dumps({'seed':123,'felled':[],'damage':{},'logs':{}}))
        self.assertEqual(World(self.path).community_cuts,0)
        self.path.write_text(json.dumps({'seed':123,'felled':['0,0:1'],'damage':{},
                                         'logs':{},'community_cuts':'not-a-number'}))
        with patch('forest_server.random.randrange',return_value=9000):
            loaded=World(self.path)
        self.assertEqual(loaded.community_cuts,0)
        self.assertEqual(loaded.seed,9000)
        self.assertFalse(loaded.felled)

    async def test_vitals_are_bounded_and_server_hunger_is_time_based(self):
        self.assertEqual(HUNGER_INTERVAL_SECONDS,300)
        self.assertEqual(LOW_VITALS_THRESHOLD,1)
        self.assertEqual(len(FOOD_EFFECTS),8)
        player={'health':5,'hunger':5,'hunger_progress':0,
                'last_hunger_at':100.0}
        self.assertFalse(advance_hunger(player,399))
        self.assertEqual(player['hunger'],5)
        self.assertTrue(advance_hunger(player,400))
        self.assertEqual(player['hunger'],4)
        self.assertEqual(player['hunger_progress'],0)
        self.assertTrue(advance_hunger(player,1000))
        self.assertEqual(player['hunger'],2)
        self.assertTrue(advance_hunger(player,1300))
        self.assertEqual(player['hunger'],1)
        self.assertFalse(apply_food(player,'branch'))
        self.assertTrue(apply_food(player,'mushroom:boletus'))
        self.assertEqual(player['hunger'],2)
        self.assertTrue(apply_food(player,'mushroom:milkcap'))
        self.assertEqual(player['hunger'],3)
        for _ in range(7):apply_food(player,'mushroom:death_cap')
        self.assertEqual(player['health'],0)
        apply_food(player,'flower:daisy')
        self.assertEqual(player['health'],1)
        for species in ('flower:buttercup','flower:pink_wildflower','flower:blue_wildflower'):
            self.assertTrue(apply_food(player,species))
        self.assertEqual(player['health'],1)
        self.assertEqual(vitals_view(player)['hunger'],3)

    async def test_eating_is_authoritative_and_does_not_duplicate_an_item(self):
        async with connect(self.url) as ws:
            welcome=await self.receive(ws,'welcome')
            self.assertEqual(welcome['vitals'],{'health':5,'hunger':5,'hungerProgress':0.0})
            player=next(iter(self.world.clients.values()))
            player['health']=3;player['hunger']=2
            player['inventory'][1]={'id':'mushroom:fly_agaric','count':2}
            player['inventory'][2]={'id':'flower:daisy','count':2}
            player['inventory'][3]={'id':'mushroom:boletus','count':1}
            for slot,kind,expected in ((1,'mushroom:fly_agaric',(2,2)),
                                       (2,'flower:daisy',(3,2)),
                                       (3,'mushroom:boletus',(3,3)),
                                       (1,'mushroom:fly_agaric',(2,3))):
                await ws.send(json.dumps({'type':'consume_food','slot':slot}))
                inventory=await self.receive(ws,'inventory_state')
                vitals=await self.receive(ws,'vitals_state')
                self.assertEqual((vitals['vitals']['health'],vitals['vitals']['hunger']),expected)
                self.assertEqual(player['inventory'][slot] is None,kind=='mushroom:boletus' or
                                 (kind=='mushroom:fly_agaric' and expected==(2,3)))
                self.assertEqual(inventory['inventory']['slots'][slot],player['inventory'][slot])
            # No remaining poisonous mushrooms, so replayed packets cannot duplicate consumption.
            await ws.send(json.dumps({'type':'consume_food','slot':1}))
            await ws.send(json.dumps({'type':'consume_food','slot':-1}))
            await ws.send(json.dumps({'type':'consume_food','slot':100}))
            with self.assertRaises(asyncio.TimeoutError):
                await asyncio.wait_for(ws.recv(),.07)
            self.assertEqual(player['health'],2)

    async def test_server_rejects_tree_hits_with_low_health_or_low_hunger(self):
        async with connect(self.url) as ws:
            await self.receive(ws,'welcome')
            player=next(iter(self.world.clients.values()))
            key=next(k for k in (f'{x},{z}:{i}' for x in range(-2,3)
                       for z in range(-2,3) for i in range(8))
                       if tree_info(k,self.world.seed))
            tx,tz,_=tree_info(key,self.world.seed)
            player.update(x=tx+1.5,z=tz)
            for health,hunger in ((1,5),(5,1),(0,0)):
                player.update(health=health,hunger=hunger,last_hit=0)
                await ws.send(json.dumps({'type':'hit','tree':key}))
                state=await self.receive(ws,'vitals_state')
                denial=await self.receive(ws,'action_denied')
                self.assertEqual(state['vitals']['health'],health)
                self.assertIn('2 жизни',denial['reason'])
                self.assertNotIn(key,self.world.damage)
                self.assertNotIn(key,self.world.felled)
            player.update(health=2,hunger=2,last_hit=0)
            await ws.send(json.dumps({'type':'hit','tree':key}))
            event=await self.receive(ws,'tree_hit')
            self.assertEqual(event['tree'],key)

    async def test_hits_save_and_restore_world(self):
        async with connect(self.url) as ws:
            await self.receive(ws, 'welcome')
            key = next(k for k in (f'{x},{z}:{i}' for x in range(-2, 3)
                            for z in range(-2, 3) for i in range(8))
                            if tree_info(k, self.world.seed))
            tx, tz, hp = tree_info(key, self.world.seed)
            player = next(iter(self.world.clients.values()))
            # Set player position in this isolated world; no public game or save is involved.
            player.update(x=tx + 1.5, z=tz)
            await ws.send(json.dumps({'type': 'hit', 'tree': key}))
            hit = await self.receive(ws, 'tree_hit')
            self.assertEqual(hit['hp'], hp - 1)
            self.assertEqual(self.world.damage[key], hp - 1)
            await ws.send(json.dumps({'type': 'hit', 'tree': key}))
            with self.assertRaises(asyncio.TimeoutError):
                await asyncio.wait_for(ws.recv(), .08)  # cooldown rejects immediate second hit
            player['last_hit'] = 0
            self.world.damage[key] = 1
            await ws.send(json.dumps({'type': 'hit', 'tree': key}))
            fell = await self.receive(ws, 'tree_fell')
            self.assertEqual(fell['wood'], 5)
            self.assertIn(key, self.world.felled)
            self.world.damage['0,0:0'] = 3
            self.world.logs[99] = {'x': 5, 'y': .29, 'z': 7, 'level': 0, 'orientation': 0}
            self.world.save()
        restored = World(self.path)
        self.assertEqual(restored.seed, self.world.seed)
        self.assertEqual(restored.felled, self.world.felled)
        self.assertEqual(restored.damage, self.world.damage)
        self.assertEqual(restored.logs, self.world.logs)
        self.assertEqual(restored.next_log, 100)
