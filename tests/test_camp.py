import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from websockets.asyncio.server import serve
from websockets.asyncio.client import connect
from forest_server import (World,inv_add,inv_count,inv_give_logs,
                           valid_camp_structure,CAMP_RECIPES,MAX_CAMP_STRUCTURES,
                           advance_stamina,apply_food,vitals_view,STATUS_DURATION)

class CampRulesTests(unittest.TestCase):
    def test_validation_and_world_save_roundtrip(self):
        item={'kind':'campfire','id':1,'x':3.5,'z':-2,'orientation':2,'lit':True}
        self.assertTrue(valid_camp_structure(item))
        for bad in ({**item,'lit':1},{**item,'kind':'table','lit':True},
                    {**item,'orientation':9},{**item,'x':float('nan')}):
            self.assertFalse(valid_camp_structure(bad))
        self.assertEqual(CAMP_RECIPES['torch'],{'branch':1,'stone':3,'dry_grass':1})
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'world.json'
            world=World(path)
            world.camp_structures[1]={k:v for k,v in item.items() if k!='id'}
            world.save()
            restored=World(path)
            self.assertEqual(restored.camp_structures[1]['lit'],True)
            self.assertEqual(restored.next_camp,2)
            self.assertEqual(len(restored.camp_structures),1)

    def test_stamina_potion_boost_expires_and_health_potion_clamps(self):
        player={'health':3,'hunger':5,'stamina':1,'hunger_progress':0,'last_stamina_at':0,
                'stamina_sprint_locked':False}
        self.assertTrue(apply_food(player,'potion:health'))
        self.assertEqual(player['health'],5)
        self.assertTrue(apply_food(player,'potion:stamina'))
        self.assertEqual(player['stamina'],3)
        self.assertEqual(vitals_view(player)['effects'][0]['id'],'stamina_regen')
        self.assertGreater(player['stamina_boost_until'],0)
        player['last_stamina_at']=1000
        player['stamina_boost_until']=0
        advance_stamina(player,1001)
        self.assertAlmostEqual(player['stamina'],3.65)

class CampWebsocketTests(unittest.IsolatedAsyncioTestCase):
    async def test_fire_and_torch_are_server_authoritative_and_persisted(self):
        with tempfile.TemporaryDirectory() as temp:
            world=World(Path(temp)/'world.json')
            server=await serve(world.handler,'127.0.0.1',0)
            port=server.sockets[0].getsockname()[1]
            async def recv(ws,typ):
                for _ in range(12):
                    data=json.loads(await asyncio.wait_for(ws.recv(),2))
                    if data['type']==typ:return data
                self.fail('missing '+typ)
            try:
                async with connect(f'ws://127.0.0.1:{port}') as alice,connect(f'ws://127.0.0.1:{port}') as bob:
                    welcome=await recv(alice,'welcome')
                    await recv(bob,'welcome')
                    player=next(p for p in world.clients.values() if p['id']==welcome['id'])
                    self.assertEqual(inv_give_logs(player['inventory'],2),2)
                    self.assertTrue(inv_add(player['inventory'],{'id':'stone','count':7}))
                    self.assertTrue(inv_add(player['inventory'],{'id':'branch','count':1}))
                    self.assertTrue(inv_add(player['inventory'],{'id':'dry_grass','count':1}))
                    player['wood']=2
                    await alice.send(json.dumps({'type':'camp_place','kind':'campfire','x':1,'z':0,'orientation':0}))
                    created=await recv(bob,'camp_add')
                    self.assertEqual(created['structure']['kind'],'campfire')
                    self.assertEqual(created['structure']['lit'],False)
                    await recv(alice,'camp_add')
                    await recv(alice,'inventory_state')
                    fid=created['structure']['id']
                    self.assertEqual(player['wood'],0)
                    self.assertEqual(inv_count(player['inventory'],'stone'),4)
                    # Too far -> denied, and cannot spend twice or toggle someone else's fire.
                    intruder=next(p for p in world.clients.values() if p['id']!=welcome['id'])
                    intruder.update(x=200,z=200)
                    await bob.send(json.dumps({'type':'camp_toggle','id':fid}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(bob.recv(),.07)
                    self.assertFalse(world.camp_structures[fid]['lit'])
                    await alice.send(json.dumps({'type':'camp_toggle','id':fid}))
                    on=await recv(bob,'camp_update')
                    self.assertTrue(on['structure']['lit'])
                    await recv(alice,'camp_update')
                    self.assertTrue(World(world.path).camp_structures[fid]['lit'])
                    # New torch cannot overlap the campfire.
                    await alice.send(json.dumps({'type':'camp_place','kind':'torch','x':1,'z':0,'orientation':0}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(bob.recv(),.07)
                    self.assertEqual(inv_count(player['inventory'],'dry_grass'),1)
                    # Farther placement but within 5 m and with all ingredients.
                    await alice.send(json.dumps({'type':'camp_place','kind':'torch','x':4,'z':0,'orientation':1}))
                    torch=await recv(bob,'camp_add')
                    self.assertEqual(torch['structure']['kind'],'torch')
                    await recv(alice,'camp_add')
                    await recv(alice,'inventory_state')
                    self.assertEqual(inv_count(player['inventory'],'dry_grass'),0)
                    self.assertEqual(len(world.camp_structures),2)
                    self.assertEqual(World(world.path).camp_structures[torch['structure']['id']]['orientation'],1)
            finally:
                server.close();await server.wait_closed()

    async def test_potions_craft_and_consume_with_no_item_duplication(self):
        with tempfile.TemporaryDirectory() as temp:
            world=World(Path(temp)/'world.json')
            server=await serve(world.handler,'127.0.0.1',0)
            port=server.sockets[0].getsockname()[1]
            async def recv(ws,typ):
                for _ in range(10):
                    packet=json.loads(await asyncio.wait_for(ws.recv(),2))
                    if packet['type']==typ:return packet
                self.fail('missing '+typ)
            try:
                async with connect(f'ws://127.0.0.1:{port}') as ws:
                    welcome=await recv(ws,'welcome')
                    player=next(p for p in world.clients.values() if p['id']==welcome['id'])
                    self.assertTrue(inv_add(player['inventory'],{'id':'flower:daisy','count':2}))
                    self.assertTrue(inv_add(player['inventory'],{'id':'mushroom:boletus','count':1}))
                    player['health']=2
                    await ws.send(json.dumps({'type':'craft_potion','recipe':'potion:health'}))
                    inventory=await recv(ws,'inventory_state')
                    self.assertEqual(inv_count(player['inventory'],'potion:health'),1)
                    self.assertEqual(inv_count(player['inventory'],'flower:daisy'),0)
                    # Can't craft twice from the same consumed ingredients.
                    await ws.send(json.dumps({'type':'craft_potion','recipe':'potion:health'}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(ws.recv(),.07)
                    slot=next(i for i,x in enumerate(player['inventory']) if x and x['id']=='potion:health')
                    await ws.send(json.dumps({'type':'consume_food','slot':slot}))
                    await recv(ws,'inventory_state')
                    healed=await recv(ws,'vitals_state')
                    self.assertEqual(healed['vitals']['health'],4)
                    self.assertEqual(inv_count(player['inventory'],'potion:health'),0)
                    await ws.send(json.dumps({'type':'consume_food','slot':slot}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(ws.recv(),.07)
            finally:
                server.close();await server.wait_closed()
