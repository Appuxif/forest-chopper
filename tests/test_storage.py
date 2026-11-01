import tempfile
import unittest
from pathlib import Path
from forest_server import (new_storage, valid_storage, storage_transfer, storage_move_slot, new_inventory,
                           inv_add, inv_count, inv_weight, World, CHEST_MAX_WEIGHT,
                           RACK_MAX_LOGS)

class StorageTests(unittest.TestCase):
    def player(self):
        return {'inventory':new_inventory(),'wood':0}

    def test_chest_weight_slots_and_safe_transfer(self):
        player=self.player()
        chest=new_storage('chest',1,0,0)
        self.assertEqual(len(chest['slots']),24)
        self.assertTrue(inv_add(player['inventory'],{'id':'stone','count':10}))
        self.assertTrue(storage_transfer(player,chest,'deposit',1,10))
        self.assertEqual(inv_count(player['inventory'],'stone'),0)
        self.assertEqual(chest['slots'][0]['count'],10)
        self.assertTrue(storage_transfer(player,chest,'withdraw',0,3))
        self.assertEqual(inv_count(player['inventory'],'stone'),3)
        self.assertEqual(chest['slots'][0]['count'],7)
        self.assertFalse(storage_transfer(player,chest,'withdraw',0,9))
        for i in range(14):
            self.assertTrue(inv_add_storage_safe(chest,{'id':'stone','count':10}))
        self.assertFalse(valid_storage(chest) and inv_weight(chest['slots'])>CHEST_MAX_WEIGHT)
        self.assertFalse(storage_transfer(player,chest,'deposit',1,100))

    def test_chest_move_exact_slots_and_half_split(self):
        player=self.player()
        chest=new_storage('chest',1,0,0)
        self.assertTrue(inv_add(player['inventory'],{'id':'stone','count':8}))
        self.assertTrue(storage_move_slot(player,chest,'bag',1,'chest',7))
        self.assertIsNone(player['inventory'][1])
        self.assertEqual(chest['slots'][7]['count'],8)
        self.assertTrue(storage_move_slot(player,chest,'chest',7,'chest',3,True))
        self.assertEqual(chest['slots'][3]['count'],4)
        self.assertEqual(chest['slots'][7]['count'],4)
        self.assertTrue(storage_move_slot(player,chest,'chest',3,'chest',7))
        self.assertIsNone(chest['slots'][3])
        self.assertEqual(chest['slots'][7]['count'],8)
        self.assertTrue(storage_move_slot(player,chest,'chest',7,'bag',4))
        self.assertEqual(player['inventory'][4]['count'],8)
        self.assertIsNone(chest['slots'][7])
        self.assertFalse(storage_move_slot(player,chest,'bag',4,'chest',24))
        self.assertEqual(player['inventory'][4]['count'],8)

    def test_chest_move_swap_and_rejected_overweight_stay_atomic(self):
        player=self.player()
        chest=new_storage('chest',1,0,0)
        self.assertTrue(inv_add(player['inventory'],{'id':'stone','count':10}))
        self.assertTrue(storage_move_slot(player,chest,'bag',1,'chest',6))
        self.assertTrue(storage_move_slot(player,chest,'chest',6,'bag',0))
        self.assertEqual(player['inventory'][0]['id'],'stone')
        self.assertEqual(chest['slots'][6]['id'],'axe')
        for i in range(7,12):chest['slots'][i]={'id':'log','count':5}
        chest['slots'][12]={'id':'stone','count':10}
        chest['slots'][13]={'id':'stone','count':10}
        self.assertAlmostEqual(inv_weight(chest['slots']),293)
        before=[x.copy() if x else None for x in player['inventory']]
        self.assertFalse(storage_move_slot(player,chest,'bag',0,'chest',14))
        self.assertEqual(player['inventory'],before)
        self.assertEqual(chest['slots'][14],None)

    def test_rack_bound_and_wood_accounting(self):
        player=self.player()
        rack=new_storage('rack',1,0,0)
        from forest_server import inv_give_logs
        self.assertEqual(inv_give_logs(player['inventory'],5),5)
        player['wood']=5
        self.assertTrue(storage_transfer(player,rack,'deposit',0,2))
        self.assertEqual(player['wood'],3)
        self.assertEqual(rack['logs'],2)
        self.assertTrue(storage_transfer(player,rack,'withdraw',0,1))
        self.assertEqual(player['wood'],4)
        self.assertEqual(rack['logs'],1)
        rack['logs']=RACK_MAX_LOGS
        self.assertFalse(storage_transfer(player,rack,'deposit',0,1))
        self.assertTrue(valid_storage(rack))

    def test_world_storage_save_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'forest.json'
            w=World(path)
            w.storages[1]=new_storage('chest',1,5,6)
            w.storages[1]['name']='Камни и ягоды'
            w.save()
            restored=World(path)
            self.assertEqual(restored.storages[1]['name'],'Камни и ягоды')
            self.assertEqual(restored.next_storage,2)

def inv_add_storage_safe(storage,item):
    from forest_server import inv_add_storage
    if inv_weight(storage['slots'])+item['count']*2>CHEST_MAX_WEIGHT:
        return False
    return inv_add_storage(storage['slots'],item)

class StorageNetworkTests(unittest.IsolatedAsyncioTestCase):
    async def test_place_transfer_rename_roundtrip_and_two_clients(self):
        import asyncio
        import json
        from websockets.asyncio.server import serve
        from websockets.asyncio.client import connect
        with tempfile.TemporaryDirectory() as tmp:
            world=World(Path(tmp)/'world.json')
            server=await serve(world.handler,'127.0.0.1',0)
            port=server.sockets[0].getsockname()[1]
            async def receive(ws,wanted):
                for _ in range(12):
                    packet=json.loads(await asyncio.wait_for(ws.recv(),2))
                    if packet['type']==wanted:return packet
                self.fail('missing packet '+wanted)
            try:
                async with connect(f'ws://127.0.0.1:{port}') as alice,connect(f'ws://127.0.0.1:{port}') as bob:
                    aw=await receive(alice,'welcome')
                    bw=await receive(bob,'welcome')
                    owner=next(p for p in world.clients.values() if p['id']==aw['id'])
                    # Three logs + four branches; materials fit within 100kg.
                    from forest_server import inv_give_logs
                    self.assertEqual(inv_give_logs(owner['inventory'],3),3)
                    self.assertTrue(inv_add(owner['inventory'],{'id':'branch','count':4}))
                    owner['wood']=3
                    await alice.send(json.dumps({'type':'craft_structure','recipe':'chest'}))
                    await receive(alice,'inventory_state')
                    self.assertEqual(inv_count(owner['inventory'],'chest'),1)
                    slot=next(i for i,it in enumerate(owner['inventory']) if it and it['id']=='chest')
                    owner['quick_refs'][2]=slot
                    owner['quick_ids'][2]='chest'
                    owner['selected']=2
                    await alice.send(json.dumps({'type':'storage_place','kind':'chest','x':1,'z':0}))
                    update=await receive(bob,'storage_update')
                    storage_id=update['storage']['id']
                    await receive(alice,'storage_update')
                    await receive(alice,'inventory_state')
                    self.assertEqual(owner['wood'],1)
                    self.assertEqual(len(world.storages),1)
                    await alice.send(json.dumps({'type':'storage_transfer','id':storage_id,'direction':'deposit','slot':1,'qty':1}))
                    deposited=await receive(bob,'storage_update')
                    self.assertEqual(deposited['storage']['slots'][0],{'id':'log','count':1})
                    await receive(alice,'storage_update')
                    await receive(alice,'inventory_state')
                    # Slot-specific DnD is server authoritative and broadcasts to others.
                    await alice.send(json.dumps({
                        'type':'storage_move','id':storage_id,
                        'fromArea':'chest','from':0,'toArea':'chest','to':4,'half':False}))
                    shifted=await receive(bob,'storage_update')
                    self.assertIsNone(shifted['storage']['slots'][0])
                    self.assertEqual(shifted['storage']['slots'][4],{'id':'log','count':1})
                    await receive(alice,'storage_update')
                    await receive(alice,'inventory_state')
                    self.assertEqual(World(world.path).storages[storage_id]['slots'][4]['count'],1)
                    # Bob is too far away to withdraw from this storage.
                    owner2=next(p for p in world.clients.values() if p['id']==bw['id'])
                    owner2['x']=100
                    await bob.send(json.dumps({'type':'storage_transfer','id':storage_id,'direction':'withdraw','slot':4,'qty':1}))
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(bob.recv(),.06)
                    self.assertEqual(world.storages[storage_id]['slots'][4]['count'],1)
                    await alice.send(json.dumps({'type':'storage_rename','id':storage_id,'name':'Лесной запас'}))
                    renamed=await receive(bob,'storage_update')
                    self.assertEqual(renamed['storage']['name'],'Лесной запас')
                    self.assertEqual(World(world.path).storages[storage_id]['name'],'Лесной запас')
            finally:
                server.close();await server.wait_closed()

class BotRackTests(unittest.IsolatedAsyncioTestCase):
    async def test_bot_delivery_and_collection_are_bounded_and_persisted(self):
        with tempfile.TemporaryDirectory() as tmp:
            world=World(Path(tmp)/'world.json')
            rack=new_storage('rack',1,0,0)
            world.storages[1]=rack
            bot=await world.bots.create('Лесоруб')
            bot['wood']=7
            task=world.bots.start(bot,'depositLogs',{'storageId':1,'amount':5})
            self.assertEqual(task['type'],'depositLogs')
            await world.bots.tick(.05)
            self.assertEqual(rack['logs'],3)
            self.assertEqual(bot['wood'],4)
            self.assertEqual(bot['last_task']['phase'],'transferred')
            bot['wood']=0
            world.bots.start(bot,'withdrawLogs',{'storageId':1,'amount':4})
            await world.bots.tick(.05)
            self.assertEqual(rack['logs'],0)
            self.assertEqual(bot['wood'],3, 'bot carry weight caps at three logs')
            world.bots.start(bot,'depositLogs',{'storageId':1,'amount':48})
            await world.bots.tick(.05)
            self.assertEqual(rack['logs'],3)
            self.assertEqual(World(world.path).storages[1]['logs'],3)
            with self.assertRaisesRegex(ValueError,'storageId'):
                world.bots.start(bot,'depositLogs',{'storageId':999,'amount':1})
            await world.bots.remove(bot['id'])
