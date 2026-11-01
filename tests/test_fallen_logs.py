"""Log piles created on tree fall: persistent, shared, and individually collectable."""
import asyncio
import json
import math
import tempfile
import time
import unittest
from pathlib import Path

from websockets.asyncio.server import serve
from websockets.asyncio.client import connect

from forest_server import (
    World, tree_info, inv_count, inv_weight, fallen_logs_box, is_fallen_logs,
    fallen_log_mask, fallen_log_segments, BOX_TTL_SECONDS,
)


class FallenLogTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.world=World(Path(self.folder.name)/'test-world.json')
        self.server=await serve(self.world.handler,'127.0.0.1',0)
        self.url=f'ws://127.0.0.1:{self.server.sockets[0].getsockname()[1]}'

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()
        self.folder.cleanup()

    async def receive(self,ws,kind):
        for _ in range(14):
            message=json.loads(await asyncio.wait_for(ws.recv(),2))
            if message['type']==kind:
                return message
        self.fail('No message of kind: '+kind)

    async def test_full_inventory_felling_produces_three_timed_logs_and_partial_pickup(self):
        async with connect(self.url) as alice, connect(self.url) as bob:
            aw=await self.receive(alice,'welcome')
            bw=await self.receive(bob,'welcome')
            owner=next(p for p in self.world.clients.values() if p['id']==aw['id'])
            other=next(p for p in self.world.clients.values() if p['id']==bw['id'])
            tree=next(k for k in (f'{x},{z}:{i}' for x in range(-2,3)
                       for z in range(-2,3) for i in range(8))
                       if tree_info(k,self.world.seed))
            tx,tz,_=tree_info(tree,self.world.seed)
            owner.update(x=tx+1.5,z=tz)
            other.update(x=tx+1.4,z=tz)
            # Fill 100kg: axe 3kg, 3 logs 30kg, stones 60kg, branches 7kg.
            owner['inventory'][1]={'id':'log','count':3}
            for i in (2,3,4):
                owner['inventory'][i]={'id':'stone','count':10}
            owner['inventory'][5]={'id':'branch','count':10}
            owner['inventory'][6]={'id':'branch','count':4}
            owner['wood']=3
            self.assertEqual(inv_weight(owner['inventory']),100)
            self.world.damage[tree]=1
            self.assertTrue(await self.world.hit_tree(owner,tree,time.monotonic()))
            self.assertEqual((await self.receive(alice,'tree_fell'))['wood'],3)
            box_alice=await self.receive(alice,'box_add')
            self.assertEqual((await self.receive(bob,'tree_fell'))['tree'],tree)
            box_bob=await self.receive(bob,'box_add')
            self.assertEqual(box_alice,box_bob)
            box=box_alice['box']
            ident=box['id']
            self.assertEqual(box['kind'],'fallen_logs')
            self.assertEqual(box['item'],{'id':'log','count':3})
            self.assertGreater(box['expires_at'],time.time()+BOX_TTL_SECONDS-5)
            self.assertLessEqual(box['expires_at'],time.time()+BOX_TTL_SECONDS)
            self.assertEqual(inv_count(owner['inventory'],'log'),3)
            self.assertEqual(len(self.world.boxes),1)
            self.assertEqual((await self.world.prune_boxes(now=time.time()+10)),[])
            self.assertEqual(World(self.world.path).boxes[ident]['item']['count'],3)

            self.assertAlmostEqual(box['direction'],self.world.boxes[ident]['direction'])
            self.assertGreater(self.world.boxes[ident]['ready_at'],time.time(),
                               'server locks the pile until tree-fall animation completes')
            self.world.boxes[ident]['ready_at']=time.time()-1
            first, middle, last=fallen_log_segments(box)
            self.assertEqual([v[0] for v in (first,middle,last)],[0,1,2])
            # A complete tree gives a continuous row of three equal segments.
            self.assertAlmostEqual(math.dist(first[1:],middle[1:]),3.08,places=5)
            owner.update(x=first[1],z=first[2])
            await alice.send(json.dumps({'type':'pickup_box','id':ident,'segment':0}))
            denied=await self.receive(alice,'action_denied')
            self.assertIn('100',denied['reason'])
            self.assertEqual(self.world.boxes[ident]['item']['count'],3)

            # Remove the FAR segment first, leaving the middle and near
            # segments at their exact original world coordinates.
            other.update(x=last[1],z=last[2])
            await bob.send(json.dumps({'type':'pickup_box','id':ident,'segment':2}))
            update=await self.receive(bob,'box_add')
            self.assertEqual(update['box']['mask'],0b011)
            self.assertEqual(update['box']['expires_at'],box['expires_at'],
                             'partial pickup must not refresh TTL')
            self.assertEqual(fallen_log_segments(update['box']),[first,middle])
            self.assertEqual(update['box']['item']['count'],2)
            self.assertEqual((await self.receive(alice,'box_add'))['box']['item']['count'],2)
            received=await self.receive(bob,'inventory_state')
            self.assertEqual(sum(it['count'] for it in received['inventory']['slots']
                                 if it and it['id']=='log'),1)
            self.assertEqual(World(self.world.path).boxes[ident]['item']['count'],2)
            self.assertEqual(self.world.boxes[ident]['item']['count'],2)
            self.assertEqual(fallen_log_mask(self.world.boxes[ident]),0b011)

            # Full inventory never destroys the rest.
            other['inventory'][1]={'id':'log','count':3}
            for i in (2,3,4):
                other['inventory'][i]={'id':'stone','count':10}
            other['inventory'][5]={'id':'branch','count':10}
            other['inventory'][6]={'id':'branch','count':4}
            other['wood']=3
            self.assertEqual(inv_weight(other['inventory']),100)
            other.update(x=first[1],z=first[2])
            await bob.send(json.dumps({'type':'pickup_box','id':ident,'segment':0}))
            await self.receive(bob,'action_denied')
            self.assertEqual(self.world.boxes[ident]['item']['count'],2)
            # Free capacity and consume the entire pile in subsequent interactions.
            other['inventory'][1]=None
            other['inventory'][2]=None
            other['inventory'][3]=None
            other['wood']=0
            for segment,expected in ((0,1),(1,0)):
                # Leave capacity for the next trip to the pile.
                other['inventory'][1]=None
                other['wood']=0
                point=(first,middle)[segment]
                other.update(x=point[1],z=point[2])
                await bob.send(json.dumps({'type':'pickup_box','id':ident,'segment':segment}))
                if expected:
                    remaining=await self.receive(bob,'box_add')
                    self.assertEqual(remaining['box']['item']['count'],expected)
                    self.assertEqual(remaining['box']['mask'],0b010)
                    self.assertEqual(fallen_log_segments(remaining['box']),[middle])
                    await self.receive(bob,'inventory_state')
                else:
                    self.assertEqual((await self.receive(bob,'box_remove'))['id'],ident)
                    await self.receive(bob,'inventory_state')
            self.assertNotIn(ident,self.world.boxes)
            self.assertNotIn(ident,World(self.world.path).boxes)

    async def test_bot_chopping_leaves_logs_until_harvest_gathers_them(self):
        bot=await self.world.bots.create('Forager')
        key=next(k for k in (f'{x},{z}:{i}' for x in range(-2,3)
                 for z in range(-2,3) for i in range(8))
                 if tree_info(k,self.world.seed))
        tx,tz,_=tree_info(key,self.world.seed)
        bot.update(x=tx+1.5,z=tz)
        self.world.damage[key]=1
        self.assertTrue(await self.world.hit_tree(bot,key,time.monotonic()))
        self.assertEqual(bot['wood'],0)
        self.assertEqual(next(iter(self.world.boxes.values()))['item']['count'],3)
        self.assertEqual(await self.world.collect_bot_fallen_logs(bot,key),3)
        self.assertEqual(bot['wood'],3)
        self.assertFalse(self.world.boxes)
        self.assertEqual(await self.world.collect_bot_fallen_logs(bot,key),0)
        await self.world.bots.remove(bot['id'])

    def test_box_and_fallen_pile_ttl_survive_restart(self):
        now=time.time()
        self.world.boxes[1]={'x':0,'z':0,'item':{'id':'log','count':3},
                             'expires_at':now+3600}
        self.world.boxes[2]=fallen_logs_box(0,0)
        self.assertTrue(is_fallen_logs(self.world.boxes[2]))
        self.world.save()
        restored=World(self.world.path)
        self.assertEqual(restored.boxes.keys(),self.world.boxes.keys())
        self.assertEqual(restored.boxes[2]['expires_at'],self.world.boxes[2]['expires_at'])
        # Pre-segment saves lack direction/mask. Keep counts without loss.
        self.world.boxes[2].pop('direction')
        self.world.boxes[2].pop('mask')
        self.world.save()
        compatible=World(self.world.path)
        self.assertEqual(len(fallen_log_segments(compatible.boxes[2])),3)
        self.assertEqual(fallen_log_mask(compatible.boxes[2]),0b111)


    async def test_expired_fallen_logs_are_removed_and_cannot_be_collected(self):
        async with connect(self.url) as ws:
            welcome=await self.receive(ws,'welcome')
            player=next(p for p in self.world.clients.values() if p['id']==welcome['id'])
            self.world.boxes[5]=fallen_logs_box(0,0)
            expires=self.world.boxes[5]['expires_at']
            self.world.boxes[5]['mask']=0b010
            self.world.boxes[5]['item']['count']=1
            self.world.save()
            self.assertEqual(World(self.world.path).boxes[5]['expires_at'],expires)
            self.assertEqual(World(self.world.path).boxes[5]['mask'],0b010)
            # Expired loot cannot be collected even before the pruning loop.
            self.world.boxes[5]['expires_at']=time.time()-1
            player.update(x=0,z=1.5)
            await ws.send(json.dumps({'type':'pickup_box','id':5,'segment':1}))
            with self.assertRaises(asyncio.TimeoutError):
                await asyncio.wait_for(ws.recv(),.08)
            self.assertEqual(inv_count(player['inventory'],'log'),0)
            self.assertEqual(await self.world.prune_boxes(),[5])
            self.assertEqual((await self.receive(ws,'box_remove'))['id'],5)
            self.assertNotIn(5,World(self.world.path).boxes)

    def test_legacy_permanent_piles_receive_one_persisted_deadline(self):
        self.world.boxes[6]=fallen_logs_box(4,5)
        self.world.boxes[6]['expires_at']=0
        self.world.save()
        first=World(self.world.path)
        expiry=first.boxes[6]['expires_at']
        self.assertGreater(expiry,time.time()+BOX_TTL_SECONDS-5)
        self.assertLessEqual(expiry,time.time()+BOX_TTL_SECONDS)
        second=World(self.world.path)
        self.assertEqual(second.boxes[6]['expires_at'],expiry)
        self.assertEqual(fallen_log_mask(second.boxes[6]),0b111)
