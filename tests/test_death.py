"""Starvation, death loot, beds and authoritative respawn."""
import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path
from websockets.asyncio.server import serve
from websockets.asyncio.client import connect
from forest_server import (World, new_inventory, advance_hunger, inv_add,
                           BOX_TTL_SECONDS, MAX_GROUND_DROPS, CAMP_RECIPES)


def player_at(x=8,z=9):
    return {
        'id':1,'x':x,'z':z,'y':0,'yaw':0,'selected':0,
        'inventory':new_inventory(),'wood':0,'health':0,'hunger':0,
        'hunger_progress':0,'starvation_progress':0,'last_hunger_at':0,
        'stamina':5,'stamina_sprint_locked':False,'axe_equipped':True,
        'quick_refs':[0,1,2,3],'quick_ids':['axe',None,None,None],
    }


class DummySocket:
    def __init__(self):self.messages=[]
    async def send(self,raw):self.messages.append(json.loads(raw))


class StarvationTests(unittest.TestCase):
    def test_zero_hunger_damages_one_health_every_ten_seconds_and_stops_on_food(self):
        player=player_at()
        player.update(health=5,last_hunger_at=0)
        self.assertFalse(advance_hunger(player,9))
        self.assertEqual(player['health'],5)
        self.assertTrue(advance_hunger(player,10))
        self.assertEqual(player['health'],4)
        self.assertFalse(advance_hunger(player,19))
        self.assertTrue(advance_hunger(player,20))
        self.assertEqual(player['health'],3)
        player['hunger']=1
        self.assertFalse(advance_hunger(player,21))
        self.assertEqual(player['health'],3)
        self.assertEqual(CAMP_RECIPES['bed'],{'log':3,'branch':4,'dry_grass':5})


class DeathServerTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_inventory_stacks_drop_spread_expire_and_restore(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'world.json'
            world=World(path)
            ws=DummySocket()
            player=player_at()
            player['inventory'][2]={'id':'stone','count':10}
            player['inventory'][3]={'id':'mushroom:boletus','count':2}
            world.clients[ws]=player
            now=time.time()
            self.assertTrue(await world.handle_death(ws,player))
            self.assertEqual(len(world.boxes),3)
            boxes=list(world.boxes.values())
            self.assertEqual([box['item']['id'] for box in boxes],
                             ['axe','stone','mushroom:boletus'])
            self.assertEqual(len({(b['x'],b['z']) for b in boxes}),3)
            self.assertTrue(all(now+BOX_TTL_SECONDS-1<b['expires_at']<
                                now+BOX_TTL_SECONDS+2 for b in boxes))
            self.assertEqual(player['inventory'],[None]*12)
            self.assertEqual((player['x'],player['z']),(0,0))
            self.assertEqual((player['health'],player['hunger']),(5,3))
            markers=[m for m in ws.messages if m.get('type')=='player_respawn']
            self.assertEqual(len(markers),1)
            self.assertEqual((markers[0]['marker']['x'],markers[0]['marker']['z']),(8,9))
            restored=World(path)
            self.assertEqual(len(restored.boxes),3)
            self.assertEqual([b['item']['id'] for b in restored.boxes.values()],
                             ['axe','stone','mushroom:boletus'])
            await world.prune_boxes(now+BOX_TTL_SECONDS+3)
            self.assertEqual(world.boxes,{},'all death boxes obey one-hour TTL')
            self.assertEqual(World(path).boxes,{},'expired boxes stay removed after reload')

    async def test_occupied_box_limit_preserves_inventory_and_health_zero(self):
        with tempfile.TemporaryDirectory() as folder:
            world=World(Path(folder)/'world.json')
            ws=DummySocket()
            player=player_at()
            world.clients[ws]=player
            world.boxes={i:{'x':0,'z':0,'expires_at':time.time()+300,
                            'item':{'id':'branch','count':1}}
                         for i in range(1,MAX_GROUND_DROPS+1)}
            world.next_box=MAX_GROUND_DROPS+1
            self.assertFalse(await world.handle_death(ws,player))
            self.assertEqual(player['inventory'][0]['id'],'axe')
            self.assertEqual(player['health'],0)
            self.assertFalse(any(x['type']=='player_respawn' for x in ws.messages))

    async def test_server_starvation_loop_auto_respawns_an_idle_player(self):
        with tempfile.TemporaryDirectory() as folder:
            world=World(Path(folder)/'hungry.json')
            server=await serve(world.handler,'127.0.0.1',0)
            task=asyncio.create_task(world.box_expiration_loop())
            try:
                async with connect(f'ws://127.0.0.1:{server.sockets[0].getsockname()[1]}') as ws:
                    hello=json.loads(await asyncio.wait_for(ws.recv(),3))
                    self.assertEqual(hello['type'],'welcome')
                    p=next(p for p in world.clients.values() if p['id']==hello['id'])
                    p.update(health=1,hunger=0,starvation_progress=0,
                             last_hunger_at=time.monotonic()-10)
                    for _ in range(25):
                        msg=json.loads(await asyncio.wait_for(ws.recv(),3))
                        if msg['type']=='player_respawn':break
                    else:self.fail('Server never respawned starving idle player')
                    self.assertEqual((p['health'],p['hunger']),(5,3))
                    self.assertEqual(len(world.boxes),1,'axe dropped automatically')
                    self.assertEqual(p['inventory'][0],None)
            finally:
                task.cancel()
                await asyncio.gather(task,return_exceptions=True)
                server.close()
                await server.wait_closed()

    async def test_network_bed_selection_requires_proximity_and_respawn_is_authoritative(self):
        with tempfile.TemporaryDirectory() as folder:
            world=World(Path(folder)/'world.json')
            world.camp_structures[19]={'kind':'bed','x':3,'z':0,
                                       'orientation':0,'lit':False}
            server=await serve(world.handler,'127.0.0.1',0)
            port=server.sockets[0].getsockname()[1]
            async def receive(ws,kind):
                for _ in range(22):
                    message=json.loads(await asyncio.wait_for(ws.recv(),2))
                    if message['type']==kind:return message
                self.fail('missing packet '+kind)
            try:
                async with connect(f'ws://127.0.0.1:{port}') as ws:
                    hello=await receive(ws,'welcome')
                    p=next(p for p in world.clients.values() if p['id']==hello['id'])
                    p['x']=20
                    await ws.send(json.dumps({'type':'bed_spawn','id':19}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(ws.recv(),.05)
                    self.assertIsNone(p['spawn_bed'])
                    p['x']=3
                    await ws.send(json.dumps({'type':'bed_spawn','id':19}))
                    ack=await receive(ws,'spawn_bed_set')
                    self.assertEqual(ack['id'],19)
                    self.assertEqual(p['spawn_bed'],19)
                    p['health']=0
                    server_ws=next(w for w,value in world.clients.items() if value is p)
                    self.assertTrue(await world.handle_death(server_ws,p))
                    await receive(ws,'player_respawn')
                    self.assertAlmostEqual(p['x'],5.5)
                    self.assertAlmostEqual(p['z'],0)
                    # The server does not allow clients to invent their
                    # respawn coordinates; it chooses bed position itself.
            finally:
                server.close();await server.wait_closed()
