"""Small in-process integration test; doesn't touch the running game or its save."""
import asyncio
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from websockets.asyncio.server import serve
from websockets.asyncio.client import connect
from forest_server import World
from server_bots import can_stand
from bot_gateway import BotConnection, Gateway


class BotTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.world=World(Path(self.folder.name)/'test-save.json')
        self.server=await serve(self.world.handler,'127.0.0.1',0)
        self.port=self.server.sockets[0].getsockname()[1]
        self.url=f'ws://127.0.0.1:{self.port}/bots'
        self.sim=asyncio.create_task(self.world.bots.run())

    async def asyncTearDown(self):
        self.world.bots.running=False
        self.sim.cancel()
        await asyncio.gather(self.sim,return_exceptions=True)
        self.server.close()
        await self.server.wait_closed()
        self.folder.cleanup()

    async def test_two_sessions_chat_follow_chop_and_collision(self):
        with patch('bot_gateway.BotConnection',side_effect=lambda:BotConnection(self.url)):
            gateway=Gateway()
            try:
                async with connect(f'ws://127.0.0.1:{self.port}') as human:
                    welcome=json.loads(await human.recv())
                    first=await gateway.register('thread-a','Alpha')
                    second=await gateway.register('thread-b','Beta')
                    again=await gateway.register('thread-a','Overridden')
                    self.assertNotEqual(first['bot_id'],second['bot_id'])
                    self.assertEqual(again['bot_id'],first['bot_id'])
                    self.assertTrue(again['reused'])
                    joins=[]
                    for _ in range(2):
                        joins.append(json.loads(await asyncio.wait_for(human.recv(),2)))
                    self.assertEqual({m['player']['name'] for m in joins},{'Alpha','Beta'})
                    await gateway.command('thread-a','say',text='Hello human')
                    msg=json.loads(await asyncio.wait_for(human.recv(),2))
                    self.assertEqual(msg['type'],'chat')
                    self.assertEqual(msg['from'],first['bot_id'])
                    self.assertEqual((await gateway.command('thread-b','brief'))['name'],'Beta')
                    follow=await gateway.command('thread-a','startFollowing',player_id=welcome['id'])
                    self.assertEqual(follow['type'],'followPlayer')
                    await asyncio.sleep(.2)
                    self.assertEqual((await gateway.command('thread-a','getActiveTask'))['status'],'running')
                    await gateway.command('thread-a','stopFollowing')
                    self.assertIsNone(await gateway.command('thread-a','getActiveTask'))
                    obs=await gateway.command('thread-b','observe',radius=60)
                    tree=obs['trees'][0]
                    bot=self.world.bots.bots[second['bot_id']]
                    tx,tz=tree['x'],tree['z']
                    # Observe coordinates are rounded; get precise procedural coordinates.
                    from forest_server import tree_info
                    tx,tz,_=tree_info(tree['id'],self.world.seed)
                    self.assertFalse(can_stand(self.world,tx,tz))
                    for angle in range(12):
                        x=tx+1.85*math.cos(angle*math.pi/6)
                        z=tz+1.85*math.sin(angle*math.pi/6)
                        if can_stand(self.world,x,z):break
                    else:self.fail('No free approach near tree')
                    bot['x'],bot['z']=x,z
                    self.world.damage[tree['id']]=1
                    chop=await gateway.command('thread-b','startTask',task='chopTree',params={'treeId':tree['id']})
                    self.assertEqual(chop['type'],'chopTree')
                    await asyncio.sleep(.3)
                    status=await gateway.command('thread-b','brief')
                    self.assertIn(tree['id'],self.world.felled)
                    self.assertEqual(status['wood'],5)
                    self.assertEqual(status['last_task']['phase'],'felled')
                    human_data=next(iter(self.world.clients.values()))
                    human_data.update(x=tx+1.85,z=tz)
                    # Another intact tree: no teleport/phase through trunk allowed.
                    other=next((key,info) for key,info in __import__('server_bots').trees_near(self.world,tx,tz,35)
                        if key!=tree['id'])
                    key,(hx,hz,_) = other
                    human_data.update(x=hx+1.7,z=hz,last_pos=__import__('time').monotonic())
                    await human.send(json.dumps({'type':'move','x':hx,'z':hz,'yaw':0,'y':0}))
                    await asyncio.sleep(.1)
                    self.assertGreater(math.hypot(human_data['x']-hx,human_data['z']-hz),.7)
            finally:
                await gateway.close()
                await asyncio.sleep(.1)
                self.assertFalse(self.world.bots.bots)


if __name__=='__main__':unittest.main()
