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
from forest_server import DAY_CYCLE_SECONDS, DAY_SYNC_SECONDS, World, tree_info, inv_give_logs, inv_logs, inventory_view, resource_info, resource_nearby, resource_cell, decor_resource, nearby_decor, DECOR_ITEM_IDS, inv_count, inv_add, inv_weight, inv_weight_space, inv_can_add, inv_take_logs, MAX_CARRY_WEIGHT, vitals_view,advance_hunger,apply_food,FOOD_EFFECTS,LOW_VITALS_THRESHOLD,HUNGER_INTERVAL_SECONDS,advance_stamina,server_can_sprint,server_can_hit,spend_hit_stamina,STAMINA_SPRINT_DRAIN,STAMINA_REGEN,BOX_TTL_SECONDS, RESOURCE_LIMIT, RESOURCE_RESPAWN_SECONDS


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
            'logs': {'2': {'x': 1, 'z': 2, 'y': .29, 'height': 0, 'orientation': 0}},
        }))
        with patch('forest_server.random.randrange', return_value=123456):
            loaded = World(self.path)
        self.assertEqual(loaded.seed, 123456)
        self.assertFalse(loaded.felled)
        self.assertFalse(loaded.damage)
        self.assertFalse(loaded.logs)

    async def test_server_clock_is_authoritative_and_survives_restarts(self):
        self.world.day_epoch = time.time() - DAY_CYCLE_SECONDS * .625
        self.assertAlmostEqual(self.world.day_phase(), .625, delta=.002)
        self.assertAlmostEqual(
            self.world.day_phase(self.world.day_epoch + DAY_CYCLE_SECONDS*1.25),
            .25, places=9)
        self.world.save()
        restored = World(self.path)
        self.assertEqual(restored.day_epoch, self.world.day_epoch)
        self.assertAlmostEqual(restored.day_phase(), self.world.day_phase(), delta=.002)

    async def test_server_sends_welcome_clock_and_periodic_sync_to_all_clients(self):
        async with connect(self.url) as alice, connect(self.url) as bob:
            first = await self.receive(alice, 'welcome')
            second = await self.receive(bob, 'welcome')
            self.assertTrue(0 <= first['day_phase'] < 1)
            self.assertAlmostEqual(first['day_phase'],second['day_phase'],delta=.005)
            before = self.world.day_phase()
            await alice.send(json.dumps({'type':'time_sync','day_phase':.75}))
            self.assertAlmostEqual(self.world.day_phase(),before,delta=.005,
                msg='clients must not control the server clock')
            self.world.last_day_sync = time.monotonic() - DAY_SYNC_SECONDS - 1
            clock_task = asyncio.create_task(self.world.box_expiration_loop())
            try:
                sync_alice = await self.receive(alice, 'time_sync')
                sync_bob = await self.receive(bob, 'time_sync')
                self.assertAlmostEqual(sync_alice['day_phase'],sync_bob['day_phase'],
                    delta=.001)
                self.assertAlmostEqual(sync_alice['day_phase'],self.world.day_phase(),
                    delta=.005)
            finally:
                clock_task.cancel()
                await asyncio.gather(clock_task,return_exceptions=True)

    async def test_status_route_does_not_create_player_or_mutate_world(self):
        created=self.world.world_created_at
        self.world.save()
        reloaded=World(self.path)
        self.assertEqual(reloaded.world_created_at,created)
        self.assertEqual(reloaded.server_status()['world_created_at'],created)
        self.assertEqual(self.world.clients,{})
        async with connect(self.url+'/status') as ws:
            response=json.loads(await asyncio.wait_for(ws.recv(),2))
            self.assertEqual(response['type'],'server_status')
            self.assertEqual(response['online'],0)
            self.assertEqual(response['max_players'],32)
            self.assertEqual(response['world_seed'],self.world.seed)
            self.assertEqual(response['protocol_version'],1)
            self.assertTrue(0<=response['day_phase']<1)
        self.assertEqual(self.world.clients,{},'status must not allocate a player')
        async with connect(self.url) as player:
            welcome=await self.receive(player,'welcome')
            async with connect(self.url+'/status') as status:
                payload=json.loads(await asyncio.wait_for(status.recv(),2))
                self.assertEqual(payload['online'],1)
                self.assertEqual(payload['world_seed'],welcome['seed'])
                self.assertEqual(self.world.next_id,welcome['id']+1,
                    'status must not consume a player ID')

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
                inv_give_logs(owner['inventory'],3)
                owner['wood']=3
                await alice.send(json.dumps({'type':'assign_quick','quick':1,'source':1}))
                self.assertTrue((await self.receive(bob,'equipment'))['axe_equipped'])
                await self.receive(alice,'inventory_state')
                await alice.send(json.dumps({'type':'select_slot','slot':1}))
                self.assertFalse((await self.receive(bob,'equipment'))['axe_equipped'])
                await self.receive(alice,'inventory_state')
                # Equipped log spends one from all bag stacks.
                await alice.send(json.dumps({'type':'place_item','x':2,'z':0,'orientation':0,'height':0}))
                placed=await self.receive(bob,'log_add')
                self.assertEqual(placed['log']['height'],0)
                self.assertEqual(placed['wood'],2)
                lid=placed['log']['id']
                self.assertEqual((await self.receive(alice,'log_add'))['log']['id'],lid)
                await self.receive(alice,'inventory_state')
                for payload in ({'x':1.3,'z':0,'orientation':0,'height':0},
                                {'x':2,'z':0,'orientation':7,'height':0},
                                {'x':200,'z':0,'orientation':0,'height':0},
                                {'x':float('nan'),'z':0,'orientation':0,'height':0},
                                {'x':2,'z':0,'orientation':0},
                                {'x':2,'z':0,'orientation':2,'height':16}):
                    owner['last_build']=0
                    await alice.send(json.dumps({'type':'place_item',**payload}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(bob.recv(),.035)
                self.assertEqual(len(self.world.logs),1)
                self.world.logs[lid]['height']=15
                owner['last_build']=0
                await alice.send(json.dumps({'type':'place_item','x':2,'z':0,'orientation':0,'height':15}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(),.055)
                self.assertEqual(owner['wood'],2)
                self.world.logs[lid]['height']=0
                self.world.save()
                self.assertEqual(World(self.path).logs[lid]['height'],0)
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
                self.assertEqual(removed['wood'],3)
                self.assertEqual(inv_logs(owner['inventory']),3)
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
                inv_give_logs(owner['inventory'],3);owner['wood']=3
                await alice.send(json.dumps({'type':'craft_item','recipe':'bench'}))
                updated=await self.receive(alice,'inventory_state')
                self.assertEqual(updated['wood'],0)
                self.assertEqual(inv_logs(owner['inventory']),0)
                bench_slot=next(i for i,x in enumerate(owner['inventory']) if x and x['id']=='bench')
                self.assertEqual(owner['inventory'][bench_slot],{'id':'bench','count':1})
                self.assertFalse(self.world.furniture)
                await alice.send(json.dumps({'type':'assign_quick','quick':1,'source':bench_slot}))
                await self.receive(bob,'equipment')
                assigned=await self.receive(alice,'inventory_state')
                self.assertEqual(assigned['inventory']['quickIds'][1],'bench')
                await alice.send(json.dumps({'type':'select_slot','slot':1}))
                await self.receive(bob,'equipment')
                await self.receive(alice,'inventory_state')
                await alice.send(json.dumps({'type':'place_item','x':4,'z':0,'orientation':0}))
                add=await self.receive(bob,'furniture_add')
                self.assertEqual(add['wood'],0)
                fid=add['item']['id']
                self.assertEqual(add['item']['kind'],'bench')
                self.assertEqual(self.world.furniture[fid]['x'],4)
                self.assertEqual((await self.receive(alice,'furniture_add'))['item']['id'],fid)
                await self.receive(alice,'inventory_state')
                self.assertEqual(len(World(self.path).furniture),1)
                for payload in ({'x':999,'z':0,'orientation':0},
                                {'x':4,'z':0,'orientation':9},
                                {'x':float('nan'),'z':0,'orientation':0,'height':0},
                                {'x':2,'z':0,'orientation':0},
                                {'x':2,'z':0,'orientation':2,'height':16}):
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
                self.assertEqual(removed['wood'],0)
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
            self.assertIn('100 кг',denied['reason'])
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
        self.assertEqual(len(flowers),193)
        self.assertEqual(sum(item['kind']=='dry_grass' for item in flowers),152)
        self.assertEqual(decor_resource(12345,-1,-1,0)['kind'],'dry_grass',
                         'ordinary green grass must now be collectible')
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

    async def test_dry_grass_collection_is_server_authoritative_and_respawns(self):
        async with connect(self.url) as alice:
            welcome=await self.receive(alice,'welcome')
            dry=next((r for r in welcome['resources'] if r['kind']=='dry_grass'),None)
            self.assertIsNotNone(dry)
            player=next(p for p in self.world.clients.values() if p['id']==welcome['id'])
            player['x']=dry['x'];player['z']=dry['z']
            await alice.send(json.dumps({'type':'collect_resource','id':dry['id']}))
            removed=await self.receive(alice,'resource_remove')
            self.assertEqual(removed['id'],dry['id'])
            state=await self.receive(alice,'inventory_state')
            self.assertEqual(sum(x['count'] for x in state['inventory']['slots'] if x and x['id']=='dry_grass'),1)
            self.assertIn(dry['id'],self.world.resource_cooldowns)
            await alice.send(json.dumps({'type':'collect_resource','id':dry['id']}))
            with self.assertRaises(asyncio.TimeoutError):
                await asyncio.wait_for(alice.recv(),.06)
            self.assertEqual(inv_count(player['inventory'],'dry_grass'),1)

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
                # Both items originated in the initial 3x3 chunk view. Re-enter it
                # before requesting the refreshed nearby resource snapshot.
                for player in self.world.clients.values():
                    player.update(x=0,z=0)
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
        self.assertEqual(len(FOOD_EFFECTS),15)
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
            self.assertEqual(welcome['vitals'],{'health':5,'hunger':5,'stamina':5,'staminaLocked':False,'hungerProgress':0.0})
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
            for health,hunger,reason in ((1,5,'Мало жизней'),(5,1,'Вы голодны'),(0,0,'Мало жизней')):
                player.update(health=health,hunger=hunger,last_hit=0)
                await ws.send(json.dumps({'type':'hit','tree':key}))
                state=await self.receive(ws,'vitals_state')
                denial=await self.receive(ws,'action_denied')
                self.assertEqual(state['vitals']['health'],health)
                self.assertEqual(reason,denial['reason'])
                self.assertNotIn(key,self.world.damage)
                self.assertNotIn(key,self.world.felled)
            player.update(health=2,hunger=2,last_hit=0)
            await ws.send(json.dumps({'type':'hit','tree':key}))
            event=await self.receive(ws,'tree_hit')
            self.assertEqual(event['tree'],key)

    async def test_server_jump_consumes_energy_once_and_refuses_exhaustion(self):
        async with connect(self.url) as ws:
            await self.receive(ws,'welcome')
            player=next(iter(self.world.clients.values()))
            player['stamina']=2.5
            player['last_stamina_at']=time.monotonic()
            await ws.send(json.dumps({'type':'jump'}))
            status=await self.receive(ws,'vitals_state')
            self.assertAlmostEqual(status['vitals']['stamina'],1.5,delta=.05)
            await ws.send(json.dumps({'type':'jump'}))
            await self.receive(ws,'vitals_state')
            denied=await self.receive(ws,'action_denied')
            self.assertEqual(denied['reason'],'Прыжок недоступен')
            self.assertAlmostEqual(player['stamina'],1.5,delta=.06)
            player['stamina']=.4
            player['last_jump']=-10000
            await ws.send(json.dumps({'type':'jump'}))
            await self.receive(ws,'vitals_state')
            denied=await self.receive(ws,'action_denied')
            self.assertEqual(denied['reason'],'Нет сил')
            self.assertGreaterEqual(player['stamina'],.4)
            self.assertLess(player['stamina'],.5)

    async def test_shortcut_binding_restores_type_and_stack_count_for_network_clients(self):
        async with connect(self.url) as ws:
            await self.receive(ws,'welcome')
            player=next(iter(self.world.clients.values()))
            self.assertTrue(inv_add(player['inventory'],{'id':'stone','count':10}))
            self.assertTrue(inv_add(player['inventory'],{'id':'stone','count':10}))
            self.assertTrue(inv_add(player['inventory'],{'id':'stone','count':3}))
            indices=[i for i,item in enumerate(player['inventory']) if item and item['id']=='stone']
            self.assertEqual([player['inventory'][i]['count'] for i in indices],[10,10,3])
            await ws.send(json.dumps({'type':'assign_quick','quick':2,'source':indices[2]}))
            await self.receive(ws,'inventory_state')
            await ws.send(json.dumps({'type':'select_slot','slot':2}))
            status=await self.receive(ws,'inventory_state')
            self.assertEqual(status['inventory']['quickIds'][2],'stone')
            self.assertEqual(sum(item['count'] for item in status['inventory']['slots']
                if item and item['id']=='stone'),23)
            await ws.send(json.dumps({'type':'transfer_slot','from':indices[2],'to':indices[0]}))
            # Already-full destination is rejected without discarding anything.
            with self.assertRaises(asyncio.TimeoutError):
                await asyncio.wait_for(ws.recv(),.06)
            self.assertEqual(inv_count(player['inventory'],'stone'),23)
            await ws.send(json.dumps({'type':'split_slot','slot':indices[0]}))
            updated=await self.receive(ws,'inventory_state')
            self.assertEqual(sum(item['count'] for item in updated['inventory']['slots']
                if item and item['id']=='stone'),23)
            self.assertEqual(updated['inventory']['quickIds'][2],'stone')

    async def test_four_bench_rotations_survive_server_save_and_invalid_angles_rejected(self):
        async with connect(self.url) as ws:
            await self.receive(ws,'welcome')
            player=next(iter(self.world.clients.values()))
            for angle in range(4):
                player['inventory'][1]={'id':'bench','count':1}
                player['last_build']=0
                player['selected']=1
                player['quick_refs'][1]=1
                player['quick_ids'][1]='bench'
                x,z=((4,0),(0,4),(-4,0),(0,-4))[angle]
                await ws.send(json.dumps({'type':'place_item','x':x,'z':z,'orientation':angle}))
                placed=await self.receive(ws,'furniture_add')
                self.assertEqual(placed['item']['orientation'],angle)
                await self.receive(ws,'inventory_state')
            self.assertEqual({v['orientation'] for v in self.world.furniture.values()},set(range(4)))
            saved=World(self.path)
            self.assertEqual({v['orientation'] for v in saved.furniture.values()},set(range(4)))
            player['inventory'][1]={'id':'bench','count':1}
            player['last_build']=0
            await ws.send(json.dumps({'type':'place_item','x':5,'z':0,'orientation':4}))
            with self.assertRaises(asyncio.TimeoutError):
                await asyncio.wait_for(ws.recv(),.06)
            self.assertEqual(len(self.world.furniture),4)

    async def test_stamina_drain_recovery_hit_cost_and_sprint_lock(self):
        player={'health':5,'hunger':5,'stamina':5.0,'last_stamina_at':0.0,
                'sprinting':True,'stamina_sprint_locked':False}
        self.assertAlmostEqual(STAMINA_SPRINT_DRAIN,.8)
        self.assertAlmostEqual(STAMINA_REGEN,.65)
        for t in range(1,6):
            self.assertTrue(advance_stamina(player,float(t)))
        self.assertAlmostEqual(player['stamina'],1.0)
        self.assertTrue(server_can_sprint(player))
        self.assertFalse(server_can_hit(player))
        advance_stamina(player,6.0)
        self.assertTrue(server_can_sprint(player))
        advance_stamina(player,7.0)
        self.assertAlmostEqual(player['stamina'],0)
        self.assertFalse(server_can_sprint(player))
        player['sprinting']=False
        advance_stamina(player,8.0)
        self.assertTrue(server_can_sprint(player))
        self.assertFalse(server_can_hit(player))
        advance_stamina(player,9.0)
        self.assertTrue(server_can_hit(player))
        old=player['stamina']
        self.assertTrue(spend_hit_stamina(player))
        self.assertAlmostEqual(player['stamina'],old-1)
        self.assertFalse(spend_hit_stamina(player))
        self.assertGreaterEqual(player['stamina'],0)

    async def test_server_rejects_exhausted_sprint_and_tree_hit(self):
        async with connect(self.url) as ws:
            await self.receive(ws,'welcome')
            player=next(iter(self.world.clients.values()))
            player['stamina']=0.0
            player['stamina_sprint_locked']=True
            player['last_pos']=time.monotonic()-.1
            await ws.send(json.dumps({'type':'move','x':.9,'z':0,'yaw':0,
                                       'sprinting':True}))
            denial=await self.receive(ws,'vitals_state')
            self.assertLess(denial['vitals']['stamina'],2)
            self.assertEqual(player['x'],0,'fast movement must be rejected when exhausted')
            self.assertFalse(player['sprinting'])
            player['stamina']=0.0
            key=next(k for k in (f'{x},{z}:{i}' for x in range(-2,3)
                for z in range(-2,3) for i in range(8)) if tree_info(k,self.world.seed))
            tx,tz,_=tree_info(key,self.world.seed)
            player.update(x=tx+1.5,z=tz,last_hit=0)
            await ws.send(json.dumps({'type':'hit','tree':key}))
            await self.receive(ws,'vitals_state')
            denied=await self.receive(ws,'action_denied')
            self.assertEqual(denied['reason'],'Нет сил')
            self.assertNotIn(key,self.world.damage)
            player.update(stamina=3.0,stamina_sprint_locked=False,last_hit=0)
            await ws.send(json.dumps({'type':'hit','tree':key}))
            await self.receive(ws,'tree_hit')
            changed=await self.receive(ws,'vitals_state')
            self.assertAlmostEqual(changed['vitals']['stamina'],2.0,places=1)

    async def test_lumberjack_damage_is_calculated_by_server_not_client(self):
        async with connect(self.url) as ws:
            await self.receive(ws,'welcome')
            player=next(iter(self.world.clients.values()))
            key=next(k for k in (f'{x},{z}:{i}' for x in range(-2,3)
                        for z in range(-2,3) for i in range(8))
                     if tree_info(k,self.world.seed) and tree_info(k,self.world.seed)[2]>4)
            tx,tz,hp=tree_info(key,self.world.seed)
            player.update(x=tx+1.5,z=tz,health=4,stamina=5,last_hit=0)
            player['lumberjack_until']=time.time()+45
            await ws.send(json.dumps({'type':'hit','tree':key,'damage':99999}))
            hit=await self.receive(ws,'tree_hit')
            self.assertEqual(hit['hp'],hp-2,'server doubles axe damage, ignores client damage claim')
            await self.receive(ws,'vitals_state')
            player['lumberjack_until']=time.time()-1
            player['last_hit']=0
            await ws.send(json.dumps({'type':'hit','tree':key,'damage':99999}))
            hit=await self.receive(ws,'tree_hit')
            self.assertEqual(hit['hp'],hp-3,'expired buff gives default damage, not double')

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
            self.assertEqual(hit['by'], player['id'])
            self.assertEqual((await self.receive(ws,'vitals_state'))['vitals']['stamina'],4)
            self.assertEqual(self.world.damage[key], hp - 1)
            await ws.send(json.dumps({'type': 'hit', 'tree': key}))
            with self.assertRaises(asyncio.TimeoutError):
                await asyncio.wait_for(ws.recv(), .08)  # cooldown rejects immediate second hit
            player['last_hit'] = 0
            self.world.damage[key] = 1
            await ws.send(json.dumps({'type': 'hit', 'tree': key}))
            fell = await self.receive(ws, 'tree_fell')
            self.assertEqual(fell['wood'], 0,'tree fall must not award inventory logs')
            drop=await self.receive(ws,'box_add')
            self.assertEqual(drop['box']['kind'],'fallen_logs')
            self.assertEqual(drop['box']['item'],{'id':'log','count':3})
            self.assertGreater(drop['box']['expires_at'],time.time()+BOX_TTL_SECONDS-5)
            self.assertLessEqual(drop['box']['expires_at'],time.time()+BOX_TTL_SECONDS)
            self.assertEqual(inv_logs(player['inventory']),0)
            await self.receive(ws,'vitals_state')
            self.assertIn(key, self.world.felled)
            self.world.damage['0,0:0'] = 3
            self.world.logs[99] = {'x': 5, 'y': .29, 'z': 7, 'height': 0, 'orientation': 0}
            self.world.save()
        restored = World(self.path)
        self.assertEqual(restored.seed, self.world.seed)
        self.assertEqual(restored.felled, self.world.felled)
        self.assertEqual(restored.damage, self.world.damage)
        self.assertEqual(restored.logs, self.world.logs)
        self.assertEqual(restored.next_log, 100)


    async def test_weight_prevents_pickup_and_resource_collection_without_consuming_world_items(self):
        async with connect(self.url) as alice:
            welcome=await self.receive(alice,'welcome')
            player=next(p for p in self.world.clients.values() if p['id']==welcome['id'])
            # Still free slots, but already exactly 100 kg.
            player['inventory'][1]={'id':'log','count':5}
            player['inventory'][2]={'id':'stone','count':10}
            player['inventory'][3]={'id':'stone','count':10}
            player['inventory'][4]={'id':'stone','count':3}
            player['inventory'][5]={'id':'branch','count':2}
            player['wood']=5
            self.assertEqual(inv_weight(player['inventory']),100)
            # Server cannot remove a box until the carry limit is satisfied.
            box_id=123456
            self.world.boxes[box_id]={'x':0,'z':0,'expires_at':time.time()+600,
                                      'item':{'id':'branch','count':1}}
            await alice.send(json.dumps({'type':'pickup_box','id':box_id}))
            denied=await self.receive(alice,'action_denied')
            self.assertIn('100 кг',denied['reason'])
            self.assertIn(box_id,self.world.boxes)
            resource=next((node for node in welcome['resources'] if node['kind'] in ('branch','stone')),None)
            self.assertIsNotNone(resource)
            player['x']=resource['x'];player['z']=resource['z']
            await alice.send(json.dumps({'type':'collect_resource','id':resource['id']}))
            denied=await self.receive(alice,'action_denied')
            self.assertIn('100 кг',denied['reason'])
            self.assertNotIn(resource['id'],self.world.resource_cooldowns)
            self.assertEqual(inv_weight(player['inventory']),100)


class WeightInventoryTests(unittest.TestCase):
    def test_server_weight_matches_client_and_caps_additions(self):
        inv=[{'id':'axe','tier':0}]+[None]*11
        self.assertEqual(inv_weight(inv),3)
        self.assertEqual(inv_give_logs(inv,10),9)
        self.assertEqual(inv_weight(inv),93)
        self.assertEqual(inv_weight_space(inv,'log'),0)
        self.assertTrue(inv_take_logs(inv,2))
        self.assertEqual(inv_weight(inv),73)
        self.assertTrue(inv_add(inv,{'id':'stone','count':10}))
        self.assertEqual(inv_weight(inv),93)
        self.assertFalse(inv_add(inv,{'id':'stone','count':4}))
        self.assertTrue(inv_add(inv,{'id':'stone','count':3}))
        self.assertEqual(inv_weight(inv),99)
        self.assertTrue(inv_add(inv,{'id':'branch','count':2}))
        self.assertEqual(inv_weight(inv),MAX_CARRY_WEIGHT)
        self.assertFalse(inv_can_add(inv,{'id':'branch','count':1}))
        self.assertEqual(inv_give_logs(inv,5),0)

    def test_existing_overweight_items_are_not_removed(self):
        inv=[{'id':'axe','tier':0},{'id':'log','count':5},
             {'id':'log','count':5}]+[None]*9
        self.assertEqual(inv_weight(inv),103)
        self.assertFalse(inv_add(inv,{'id':'stone','count':1}))
        self.assertEqual(inv_logs(inv),10)
        self.assertEqual(inv_weight_space(inv,'log'),0)
        self.assertTrue(inv_take_logs(inv,2))
        self.assertEqual(inv_weight(inv),83)
