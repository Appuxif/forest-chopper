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
from forest_server import World, tree_info, inv_give_logs, inv_logs, inventory_view, resources_update, inv_add, BOX_TTL_SECONDS


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
                await self.receive(alice,'resources_state')
                state=await self.receive(alice,'inventory_state')
                self.assertEqual(sum(x['count'] for x in state['inventory']['slots'] if x and x['id']==node['kind']),1)
                self.assertNotIn(node['id'],owner['resources'])
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

    async def test_ephemeral_resources_only_exist_within_10m_and_are_not_world_saved(self):
        player={'x':0,'z':0,'last_resources':-9999,'resources':{},'resource_seq':0}
        first=resources_update(player,3)
        self.assertEqual(len(first['resources']),10)
        self.assertTrue(all(0<math.hypot(n['x'],n['z'])<10 for n in first['resources']))
        player['x']=50;player['z']=50
        second=resources_update(player,7)
        self.assertEqual(len(second['resources']),10)
        self.assertTrue(all(math.hypot(n['x']-50,n['z']-50)<10 for n in second['resources']))
        self.assertFalse(set(n['id'] for n in first['resources']) & set(n['id'] for n in second['resources']))
        self.world.save()
        self.assertNotIn('resources',json.loads(self.path.read_text()))

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
