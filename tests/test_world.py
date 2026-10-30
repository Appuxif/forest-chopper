"""Regression coverage for real-player WebSocket and isolated save/load."""
import asyncio
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from websockets.asyncio.server import serve
from websockets.asyncio.client import connect
from forest_server import World, tree_info


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
                owner = next(p for p in self.world.clients.values() if p['id'] == welcome['id'])
                # No wood cannot place; server must not emit a log_add.
                await alice.send(json.dumps({'type': 'place', 'x': 2, 'z': 0, 'orientation': 0}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(), .08)
                self.assertFalse(self.world.logs)
                owner['wood'] = 4
                owner['last_build'] = 0
                await alice.send(json.dumps({'type': 'place', 'x': 2, 'z': 0, 'orientation': 0}))
                placed = await self.receive(bob, 'log_add')
                self.assertEqual(placed['by'], welcome['id'])
                self.assertEqual(placed['log']['level'], 0)
                self.assertEqual(placed['wood'], 3)
                lid = placed['log']['id']
                self.assertEqual(self.world.logs[lid]['x'], 2)
                # Alice received the same broadcast. Consume it to avoid stale events.
                self.assertEqual((await self.receive(alice, 'log_add'))['log']['id'], lid)
                # Invalid coordinates and orientations are ignored.
                for payload in ({'x': 1.3, 'z': 0, 'orientation': 0},
                                {'x': 2, 'z': 0, 'orientation': 7},
                                {'x': 200, 'z': 0, 'orientation': 0},
                                {'x': float('nan'), 'z': 0, 'orientation': 0}):
                    owner['last_build'] = 0
                    await alice.send(json.dumps({'type': 'place', **payload}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(bob.recv(), .035)
                self.assertEqual(len(self.world.logs), 1)
                # Height cap must not silently spend wood.
                owner['last_build'] = 0
                self.world.logs[lid]['level'] = 15
                await alice.send(json.dumps({'type': 'place', 'x': 2, 'z': 0, 'orientation': 0}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(), .06)
                self.assertEqual(owner['wood'], 3)
                self.world.logs[lid]['level'] = 0
                self.world.save()
                persisted = World(self.path)
                self.assertIn(lid, persisted.logs)
                self.assertEqual(persisted.logs[lid]['level'], 0)
                owner['last_build'] = 0
                await alice.send(json.dumps({'type': 'remove', 'id': lid + 999}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(), .06)
                owner['last_build'] = 0
                await alice.send(json.dumps({'type': 'remove', 'id': lid}))
                removed = await self.receive(bob, 'log_remove')
                self.assertEqual(removed, {'type': 'log_remove', 'id': lid,
                                           'by': welcome['id'], 'wood': 4})
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
                cmd={'type':'craft','recipe':'bench','x':4,'z':0,'orientation':0}
                await alice.send(json.dumps(cmd))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(),.07)
                owner['wood']=10
                owner['last_build']=0
                await alice.send(json.dumps(cmd))
                add=await self.receive(bob,'furniture_add')
                self.assertEqual(add['wood'],7)
                fid=add['item']['id']
                self.assertEqual(add['item']['kind'],'bench')
                self.assertEqual(self.world.furniture[fid]['x'],4)
                self.assertEqual((await self.receive(alice,'furniture_add'))['item']['id'],fid)
                self.assertEqual(len(World(self.path).furniture),1)
                for payload in ({**cmd,'x':999}, {**cmd,'orientation':9},
                                {**cmd,'x':float('nan')}, {**cmd,'x':4},
                                {**cmd,'recipe':'gold'}):
                    owner['last_build']=0
                    await alice.send(json.dumps(payload))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(bob.recv(),.035)
                self.assertEqual(len(self.world.furniture),1)
                owner['last_build']=0
                await alice.send(json.dumps({'type':'remove_furniture','id':fid+50}))
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(bob.recv(),.05)
                owner['last_build']=0
                await alice.send(json.dumps({'type':'remove_furniture','id':fid}))
                removed=await self.receive(bob,'furniture_remove')
                self.assertEqual(removed['wood'],9)
                self.assertFalse(self.world.furniture)
                self.assertFalse(World(self.path).furniture)


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
