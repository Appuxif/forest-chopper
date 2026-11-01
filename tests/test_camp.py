import asyncio
import json
import time
import tempfile
import unittest
from pathlib import Path
from websockets.asyncio.server import serve
from websockets.asyncio.client import connect
from forest_server import (World,inv_add,inv_count,inv_give_logs,
                           valid_camp_structure,CAMP_RECIPES,MAX_CAMP_STRUCTURES,
                           advance_stamina,apply_food,vitals_view,STATUS_DURATION,POTION_RECIPES,FOOD_RECIPES,STATUS_REGEN_MULTIPLIER,has_crafting_station,CRAFT_STATION_RADIUS,
                           active_status_ids,chop_damage_multiplier,sprint_drain_multiplier,STATUS_EFFECT_DURATIONS)

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

    def test_workstation_rules_are_geometrically_bounded(self):
        self.assertEqual(CRAFT_STATION_RADIUS,10)
        world={1:{'kind':'campfire','x':0,'z':0},
               2:{'kind':'alchemy_table','x':20,'z':0}}
        self.assertTrue(has_crafting_station(world,'campfire',10,0))
        self.assertTrue(has_crafting_station(world,'alchemy_table',10,0))
        self.assertFalse(has_crafting_station(world,'campfire',10,.001))
        self.assertFalse(has_crafting_station(world,'alchemy_table',10,.001))
        self.assertFalse(has_crafting_station(world,'torch',0,0))
        self.assertEqual(FOOD_RECIPES,{
            'food:mushroom_stew':{'mushroom:boletus':1,'mushroom:milkcap':1},
            'food:herbal_mushroom_stew':{
                'mushroom:boletus':1,'mushroom:milkcap':1,'flower:blue_wildflower':1},
        })
        player={'health':2,'hunger':0}
        self.assertTrue(apply_food(player,'food:mushroom_stew'))
        self.assertEqual((player['health'],player['hunger']),(2,3))
        self.assertTrue(apply_food(player,'food:mushroom_stew'))
        self.assertEqual(player['hunger'],5)
        player['hunger']=0
        player['health']=2
        self.assertTrue(apply_food(player,'food:herbal_mushroom_stew'))
        self.assertEqual((player['health'],player['hunger']),(3,3))

    def test_potion_economy_and_stamina_recipe(self):
        self.assertEqual(POTION_RECIPES['potion:health'],{
            'flower:daisy':2,'mushroom:boletus':1})
        self.assertEqual(POTION_RECIPES['potion:stamina'],{
            'flower:blue_wildflower':2,'flower:pink_wildflower':2})
        self.assertEqual(STATUS_REGEN_MULTIPLIER,2)
        player={'health':1,'hunger':1,'stamina':0,'hunger_progress':0,
                'stamina_sprint_locked':True}
        self.assertTrue(apply_food(player,'potion:health'))
        self.assertEqual((player['health'],player['hunger']),(4,2))
        self.assertTrue(apply_food(player,'potion:stamina'))
        self.assertEqual(player['stamina'],0,'potion does not restore stamina directly')
        self.assertTrue(player['stamina_sprint_locked'],'cannot bypass sprint exhaustion')
        self.assertEqual(vitals_view(player)['effects'][0]['id'],'stamina_regen')

    def test_advanced_elixirs_server_timers_and_side_effects(self):
        self.assertEqual(POTION_RECIPES['potion:lumberjack'],{
            'mushroom:fly_agaric':1,'flower:pink_wildflower':2,'flower:daisy':1})
        self.assertEqual(POTION_RECIPES['potion:light_feet'],{
            'flower:blue_wildflower':2,'flower:pink_wildflower':1,'flower:buttercup':1})
        self.assertEqual(POTION_RECIPES['potion:night_vision'],{
            'mushroom:fly_agaric':1,'flower:blue_wildflower':1,'flower:buttercup':1})
        player={'health':5,'hunger':5,'stamina':5,'hunger_progress':0,
                'last_stamina_at':0,'stamina_sprint_locked':False,'sprinting':True}
        self.assertTrue(apply_food(player,'potion:lumberjack'))
        self.assertTrue(apply_food(player,'potion:light_feet'))
        self.assertTrue(apply_food(player,'potion:night_vision'))
        self.assertEqual((player['health'],player['hunger']),(3,4))
        self.assertEqual(chop_damage_multiplier(player),2)
        self.assertEqual(sprint_drain_multiplier(player),.5)
        self.assertEqual(active_status_ids(player),{'lumberjack','light_feet','night_vision'})
        by_id={item['id']:item['expires_at'] for item in vitals_view(player)['effects']}
        for kind,duration in [('lumberjack',45),('light_feet',45),('night_vision',300)]:
            self.assertAlmostEqual(by_id[kind]-time.time(),duration,delta=1)
        self.assertEqual(STATUS_EFFECT_DURATIONS['night_vision'],300)
        before=player['stamina']
        advance_stamina(player,1)
        self.assertAlmostEqual(player['stamina'],before-.4)
        # Using another dose refreshes only its own status timer.
        earlier=player['lumberjack_until']
        self.assertTrue(apply_food(player,'potion:lumberjack'))
        self.assertGreaterEqual(player['lumberjack_until'],earlier)
        self.assertEqual(chop_damage_multiplier(player),2)
        player['lumberjack_until']=time.time()-1
        self.assertEqual(chop_damage_multiplier(player),1)
        player['light_feet_until']=time.time()-1
        self.assertEqual(sprint_drain_multiplier(player),1)
        self.assertEqual(active_status_ids(player),{'night_vision'})
        player['night_vision_until']=time.time()-1
        self.assertNotIn('effects',vitals_view(player))

    def test_stamina_potion_boost_expires_and_health_potion_clamps(self):
        player={'health':3,'hunger':5,'stamina':1,'hunger_progress':0,'last_stamina_at':0,
                'stamina_sprint_locked':False}
        self.assertTrue(apply_food(player,'potion:health'))
        self.assertEqual(player['health'],5)
        self.assertTrue(apply_food(player,'potion:stamina'))
        self.assertEqual(player['stamina'],1)
        self.assertEqual(vitals_view(player)['effects'][0]['id'],'stamina_regen')
        self.assertGreater(player['stamina_boost_until'],0)
        player['last_stamina_at']=1000
        player['stamina_boost_until']=0
        advance_stamina(player,1001)
        self.assertAlmostEqual(player['stamina'],1.65)

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
                    await alice.send(json.dumps({'type':'craft_structure','recipe':'campfire'}))
                    await recv(alice,'inventory_state')
                    self.assertEqual(inv_count(player['inventory'],'campfire'),1)
                    camp_slot=next(i for i,it in enumerate(player['inventory']) if it and it['id']=='campfire')
                    player['quick_refs'][1]=camp_slot
                    player['quick_ids'][1]='campfire'
                    player['selected']=1
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
                    # Craft a torch into the bag before attempting placement.
                    await alice.send(json.dumps({'type':'craft_structure','recipe':'torch'}))
                    await recv(alice,'inventory_state')
                    self.assertEqual(inv_count(player['inventory'],'torch'),1)
                    torch_slot=next(i for i,it in enumerate(player['inventory']) if it and it['id']=='torch')
                    player['quick_refs'][1]=torch_slot
                    player['quick_ids'][1]='torch'
                    await alice.send(json.dumps({'type':'camp_place','kind':'torch','x':1,'z':0,'orientation':0}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(bob.recv(),.07)
                    self.assertEqual(inv_count(player['inventory'],'dry_grass'),0)
                    self.assertEqual(inv_count(player['inventory'],'torch'),1)
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
                    world.camp_structures[101]={'kind':'alchemy_table','x':0,'z':0,
                                                'orientation':0,'lit':False}
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
                    self.assertEqual(healed['vitals']['health'],5)
                    self.assertEqual(inv_count(player['inventory'],'potion:health'),0)
                    self.assertEqual(healed['vitals']['hunger'],5)
                    await ws.send(json.dumps({'type':'consume_food','slot':slot}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(ws.recv(),.07)
                    # In multiplayer, the stamina potion uses blue and PINK
                    # wildflowers, not dry grass; its boost does not refill.
                    self.assertTrue(inv_add(player['inventory'],{'id':'flower:blue_wildflower','count':2}))
                    self.assertTrue(inv_add(player['inventory'],{'id':'flower:pink_wildflower','count':2}))
                    self.assertTrue(inv_add(player['inventory'],{'id':'dry_grass','count':2}))
                    player['stamina']=0
                    player['stamina_sprint_locked']=True
                    await ws.send(json.dumps({'type':'craft_potion','recipe':'potion:stamina'}))
                    await recv(ws,'inventory_state')
                    self.assertEqual(inv_count(player['inventory'],'potion:stamina'),1)
                    self.assertEqual(inv_count(player['inventory'],'flower:blue_wildflower'),0)
                    self.assertEqual(inv_count(player['inventory'],'flower:pink_wildflower'),0)
                    self.assertEqual(inv_count(player['inventory'],'dry_grass'),2)
                    slot=next(i for i,x in enumerate(player['inventory']) if x and x['id']=='potion:stamina')
                    await ws.send(json.dumps({'type':'consume_food','slot':slot}))
                    await recv(ws,'inventory_state')
                    active=await recv(ws,'vitals_state')
                    self.assertEqual(active['vitals']['stamina'],0)
                    self.assertTrue(active['vitals']['staminaLocked'])
                    self.assertEqual(active['vitals']['effects'][0]['id'],'stamina_regen')
                    self.assertEqual(inv_count(player['inventory'],'potion:stamina'),0)
            finally:
                server.close();await server.wait_closed()

class CookingStationWebsocketTests(unittest.IsolatedAsyncioTestCase):
    async def test_food_needs_campfire_and_potions_need_alchemy_table(self):
        with tempfile.TemporaryDirectory() as tmp:
            world=World(Path(tmp)/'world.json')
            server=await serve(world.handler,'127.0.0.1',0)
            port=server.sockets[0].getsockname()[1]
            async def receive(ws,typ):
                for _ in range(12):
                    msg=json.loads(await asyncio.wait_for(ws.recv(),2))
                    if msg['type']==typ:return msg
                self.fail('No packet: '+typ)
            try:
                async with connect(f'ws://127.0.0.1:{port}') as ws:
                    welcome=await receive(ws,'welcome')
                    player=next(p for p in world.clients.values() if p['id']==welcome['id'])
                    player['hunger']=0
                    self.assertTrue(inv_add(player['inventory'],{'id':'mushroom:boletus','count':2}))
                    self.assertTrue(inv_add(player['inventory'],{'id':'mushroom:milkcap','count':2}))
                    await ws.send(json.dumps({'type':'craft_potion','recipe':'food:mushroom_stew'}))
                    denied=await receive(ws,'action_denied')
                    self.assertIn('10 м',denied['reason'])
                    self.assertEqual(inv_count(player['inventory'],'mushroom:boletus'),2)
                    world.camp_structures[1]={'kind':'torch','x':0,'z':0,'orientation':0,'lit':True}
                    await ws.send(json.dumps({'type':'craft_potion','recipe':'food:mushroom_stew'}))
                    await receive(ws,'action_denied')
                    self.assertEqual(inv_count(player['inventory'],'food:mushroom_stew'),0)
                    world.camp_structures[2]={'kind':'campfire','x':0,'z':0,'orientation':0,'lit':False}
                    player['x']=10.01
                    await ws.send(json.dumps({'type':'craft_potion','recipe':'food:mushroom_stew'}))
                    await receive(ws,'action_denied')
                    player['x']=10
                    await ws.send(json.dumps({'type':'craft_potion','recipe':'food:mushroom_stew'}))
                    await receive(ws,'inventory_state')
                    self.assertEqual(inv_count(player['inventory'],'food:mushroom_stew'),1)
                    self.assertEqual(inv_count(player['inventory'],'mushroom:boletus'),1)
                    self.assertEqual(inv_count(player['inventory'],'mushroom:milkcap'),1)
                    stew_slot=next(i for i,x in enumerate(player['inventory'])
                                   if x and x['id']=='food:mushroom_stew')
                    await ws.send(json.dumps({'type':'consume_food','slot':stew_slot}))
                    await receive(ws,'inventory_state')
                    food=await receive(ws,'vitals_state')
                    self.assertEqual(food['vitals']['hunger'],3)
                    # The herbal variant must also require the campfire: it
                    # adds one blue wildflower and restores health as well.
                    player['hunger']=0
                    player['health']=2
                    self.assertTrue(inv_add(player['inventory'],{
                        'id':'flower:blue_wildflower','count':1}))
                    player['x']=10.01
                    await ws.send(json.dumps({
                        'type':'craft_potion','recipe':'food:herbal_mushroom_stew'}))
                    await receive(ws,'action_denied')
                    self.assertEqual(inv_count(player['inventory'],'flower:blue_wildflower'),1)
                    self.assertEqual(inv_count(player['inventory'],'mushroom:boletus'),1)
                    player['x']=10
                    await ws.send(json.dumps({
                        'type':'craft_potion','recipe':'food:herbal_mushroom_stew'}))
                    await receive(ws,'inventory_state')
                    self.assertEqual(inv_count(player['inventory'],'food:herbal_mushroom_stew'),1)
                    self.assertEqual(inv_count(player['inventory'],'flower:blue_wildflower'),0)
                    self.assertEqual(inv_count(player['inventory'],'mushroom:boletus'),0)
                    self.assertEqual(inv_count(player['inventory'],'mushroom:milkcap'),0)
                    herb_slot=next(i for i,x in enumerate(player['inventory'])
                                   if x and x['id']=='food:herbal_mushroom_stew')
                    await ws.send(json.dumps({'type':'consume_food','slot':herb_slot}))
                    await receive(ws,'inventory_state')
                    herbs=await receive(ws,'vitals_state')
                    self.assertEqual(herbs['vitals']['health'],3)
                    self.assertEqual(herbs['vitals']['hunger'],3)
                    # Food stations cannot substitute for the alchemy table.
                    player['x']=0
                    self.assertTrue(inv_add(player['inventory'],{'id':'mushroom:boletus','count':1}))
                    self.assertTrue(inv_add(player['inventory'],{'id':'flower:daisy','count':2}))
                    await ws.send(json.dumps({'type':'craft_potion','recipe':'potion:health'}))
                    await receive(ws,'action_denied')
                    self.assertEqual(inv_count(player['inventory'],'potion:health'),0)
                    self.assertEqual(inv_count(player['inventory'],'flower:daisy'),2)
                    world.camp_structures[3]={'kind':'alchemy_table','x':0,'z':0,
                                               'orientation':0,'lit':False}
                    await ws.send(json.dumps({'type':'craft_potion','recipe':'potion:health'}))
                    await receive(ws,'inventory_state')
                    self.assertEqual(inv_count(player['inventory'],'potion:health'),1)
                    world.save()
                    self.assertEqual(World(world.path).camp_structures[3]['kind'],'alchemy_table')
            finally:
                server.close();await server.wait_closed()

    async def test_alchemy_table_is_crafted_as_an_item_then_placed_authoritatively(self):
        with tempfile.TemporaryDirectory() as tmp:
            world=World(Path(tmp)/'world.json')
            server=await serve(world.handler,'127.0.0.1',0)
            port=server.sockets[0].getsockname()[1]
            async def receive(ws,typ):
                for _ in range(12):
                    data=json.loads(await asyncio.wait_for(ws.recv(),2))
                    if data['type']==typ:return data
                self.fail('Missing packet: '+typ)
            try:
                async with connect(f'ws://127.0.0.1:{port}') as ws:
                    welcome=await receive(ws,'welcome')
                    player=next(p for p in world.clients.values() if p['id']==welcome['id'])
                    cost=CAMP_RECIPES['alchemy_table']
                    for kind,amount in cost.items():
                        self.assertTrue(inv_add(player['inventory'],{'id':kind,'count':amount}),kind)
                    await ws.send(json.dumps({'type':'craft_structure','recipe':'alchemy_table'}))
                    await receive(ws,'inventory_state')
                    for kind in cost:self.assertEqual(inv_count(player['inventory'],kind),0)
                    self.assertEqual(inv_count(player['inventory'],'alchemy_table'),1)
                    slot=next(i for i,x in enumerate(player['inventory'])
                              if x and x['id']=='alchemy_table')
                    player['quick_refs'][1]=slot;player['quick_ids'][1]='alchemy_table'
                    player['selected']=1
                    await ws.send(json.dumps({'type':'camp_place','kind':'alchemy_table',
                                              'x':3,'z':0,'orientation':1}))
                    added=await receive(ws,'camp_add')
                    self.assertEqual(added['structure']['kind'],'alchemy_table')
                    self.assertFalse(added['structure']['lit'])
                    await receive(ws,'inventory_state')
                    self.assertEqual(inv_count(player['inventory'],'alchemy_table'),0)
                    restored=World(world.path)
                    self.assertEqual(len(restored.camp_structures),1)
                    self.assertEqual(next(iter(restored.camp_structures.values()))['orientation'],1)
            finally:
                server.close();await server.wait_closed()

class AuthoritativeElixirWebsocketTests(unittest.IsolatedAsyncioTestCase):
    async def test_server_crafts_consumes_tracks_and_expires_effects_for_idle_players(self):
        with tempfile.TemporaryDirectory() as tmp:
            world=World(Path(tmp)/'elixirs.json')
            server=await serve(world.handler,'127.0.0.1',0)
            port=server.sockets[0].getsockname()[1]
            async def receive(ws,typ):
                for _ in range(16):
                    result=json.loads(await asyncio.wait_for(ws.recv(),3))
                    if result['type']==typ:return result
                self.fail('Expected '+typ)
            try:
                async with connect(f'ws://127.0.0.1:{port}') as ws:
                    welcome=await receive(ws,'welcome')
                    player=next(p for p in world.clients.values()
                                if p['id']==welcome['id'])
                    world.camp_structures[1]={'kind':'alchemy_table','x':0,'z':0,
                                               'orientation':0,'lit':False}
                    specs=[
                        ('potion:lumberjack', 'lumberjack',45),
                        ('potion:light_feet','light_feet',45),
                        ('potion:night_vision','night_vision',300),
                    ]
                    for kind,status,duration in specs:
                        for reagent,count in POTION_RECIPES[kind].items():
                            self.assertTrue(inv_add(player['inventory'],{
                                'id':reagent,'count':count}),reagent)
                        await ws.send(json.dumps({'type':'craft_potion','recipe':kind}))
                        await receive(ws,'inventory_state')
                        self.assertEqual(inv_count(player['inventory'],kind),1)
                        slot=next(i for i,item in enumerate(player['inventory'])
                                  if item and item['id']==kind)
                        await ws.send(json.dumps({'type':'consume_food','slot':slot}))
                        await receive(ws,'inventory_state')
                        vitals=(await receive(ws,'vitals_state'))['vitals']
                        self.assertEqual(inv_count(player['inventory'],kind),0)
                        effects={e['id']:e['expires_at'] for e in vitals['effects']}
                        self.assertIn(status,effects)
                        self.assertAlmostEqual(effects[status]-time.time(),duration,delta=1.5)
                    self.assertEqual((player['health'],player['hunger']),(3,4))
                    self.assertEqual(chop_damage_multiplier(player),2)
                    self.assertEqual(sprint_drain_multiplier(player),.5)
                    self.assertEqual(len(active_status_ids(player)),3)
                    # A client cannot submit a fabricated buff as a network message.
                    await ws.send(json.dumps({'type':'vitals_state','vitals':{
                        'effects':[{'id':'night_vision','expires_at':time.time()+999999}]}}))
                    self.assertLess(player['night_vision_until'],time.time()+301)
                    # No stamina or hunger changes required to trigger expiry sync.
                    player['lumberjack_until']=time.time()-.01
                    player['light_feet_until']=time.time()-.01
                    player['night_vision_until']=time.time()-.01
                    player['stamina']=5
                    player['sprinting']=False
                    player['last_effect_ids']=frozenset({'lumberjack','light_feet','night_vision'})
                    task=asyncio.create_task(world.box_expiration_loop())
                    try:
                        expired=(await receive(ws,'vitals_state'))['vitals']
                        self.assertNotIn('effects',expired)
                        self.assertEqual(active_status_ids(player),frozenset())
                    finally:
                        task.cancel()
                        await asyncio.gather(task,return_exceptions=True)
            finally:
                server.close();await server.wait_closed()
