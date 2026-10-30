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
