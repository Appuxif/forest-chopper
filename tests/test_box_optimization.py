"""Loot indexing, deadline queue and multiplayer area-of-interest regression."""
import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path
from box_registry import BoxRegistry,AOI_RADIUS
from forest_server import World


def box(x,z,expiry=None):
    return {'x':x,'z':z,'expires_at':expiry if expiry is not None else time.time()+3600,
            'item':{'id':'stone','count':1}}


class CaptureSocket:
    def __init__(self):self.packets=[]
    async def send(self,raw):self.packets.append(json.loads(raw))
    def take(self):return self.packets[:]


class BoxRegistryTests(unittest.TestCase):
    def test_3000_box_deadlines_are_heap_sorted_without_global_scan(self):
        registry=BoxRegistry()
        now=time.time()
        for ident in range(1,3001):
            registry[ident]=box(ident*3,0,now+3600+(ident%5))
        self.assertEqual(len(registry),3000)
        self.assertEqual(len(registry.expired(now+3599)),0)
        self.assertEqual(registry.expired(now+3600),list(range(5,3001,5)))
        self.assertEqual(len(registry),2400)
        self.assertEqual(len(registry.expired(now+3605)),2400)
        self.assertEqual(len(registry),0)
        self.assertLessEqual(len(registry.heap),3000)

    def test_in_place_expiry_update_and_overwrite_do_not_lose_new_entry(self):
        now=time.time()
        registry=BoxRegistry({1:box(0,0,now+12),2:box(300,0,now+30)})
        registry[1]['expires_at']=now+50
        registry[1]['item']['count']=7
        self.assertEqual(registry.expired(now+13),[])
        registry[2]=box(300,0,now+99)
        self.assertEqual(registry.expired(now+31),[])
        self.assertEqual(registry.expired(now+51),[1])
        self.assertEqual(registry[2]['expires_at'],now+99)
        registry[2]['x']=0
        self.assertEqual([x[0] for x in registry.nearby(0,0,12)],[2])
        self.assertEqual(registry.expired(now+100),[2])
        self.assertEqual(registry.expired(now+1000),[])

    def test_spatial_lookup_filters_far_boxes_even_with_thousands_present(self):
        registry=BoxRegistry()
        for ident in range(3000):
            registry[ident+1]=box(3000+ident*2,400)
        registry[5000]=box(0,0)
        registry[5001]=box(119,0)
        registry[5002]=box(121,0)
        found={ident for ident,_ in registry.nearby(0,0,AOI_RADIUS)}
        self.assertEqual(found,{5000,5001})


class ServerAreaOfInterestTests(unittest.IsolatedAsyncioTestCase):
    async def test_join_receives_nearby_loot_and_movement_streams_add_remove(self):
        with tempfile.TemporaryDirectory() as folder:
            world=World(Path(folder)/'aoi.json')
            world.boxes[1]=box(0,0)
            world.boxes[2]=box(900,0)
            world.boxes[3]=box(920,0)
            ws=CaptureSocket()
            player={'x':0,'z':0,'visible_boxes':set(), 'last_box_sync':(0,0)}
            world.clients[ws]=player
            await world.sync_boxes(ws,player)
            self.assertEqual([m['box']['id'] for m in ws.take() if m['type']=='box_add'],[1])
            self.assertEqual(player['visible_boxes'],{1})
            # Move across the world: the original far box is discarded from
            # the client, the new nearby boxes arrive.
            player.update(x=908,z=0)
            await world.sync_boxes(ws,player)
            self.assertEqual([m['id'] for m in ws.take() if m['type']=='box_remove'],[1])
            self.assertEqual([m['box']['id'] for m in ws.take() if m['type']=='box_add'],[1,2,3])
            self.assertEqual(player['visible_boxes'],{2,3})
            # No repeated packets for an unchanged viewport.
            previous=len(ws.take())
            await world.sync_boxes(ws,player)
            self.assertEqual(len(ws.take()),previous)

    async def test_new_boxes_only_broadcast_in_range_and_expiry_only_to_subscribers(self):
        with tempfile.TemporaryDirectory() as folder:
            world=World(Path(folder)/'aoi2.json')
            near,far=CaptureSocket(),CaptureSocket()
            world.clients[near]={'x':0,'z':0,'visible_boxes':set()}
            world.clients[far]={'x':500,'z':0,'visible_boxes':set()}
            expiry=time.time()+10
            world.boxes[1]=box(2,0,expiry)
            await world.broadcast({'type':'box_add','box':{'id':1,**world.boxes[1]}})
            self.assertEqual(len(near.take()),1)
            self.assertEqual(far.take(),[])
            world.boxes[2]=box(505,0,expiry)
            await world.broadcast({'type':'box_add','box':{'id':2,**world.boxes[2]}})
            self.assertEqual(len(far.take()),1)
            self.assertEqual(len(near.take()),1)
            self.assertEqual(await world.prune_boxes(expiry+1),[1,2])
            self.assertEqual([m['id'] for m in near.take() if m['type']=='box_remove'],[1])
            self.assertEqual([m['id'] for m in far.take() if m['type']=='box_remove'],[2])
            self.assertEqual(world.boxes,{})


class TenThousandLimitTests(unittest.TestCase):
    def test_world_save_and_load_accepts_10000_boxes_then_rejects_10001(self):
        from forest_server import MAX_GROUND_DROPS
        self.assertEqual(MAX_GROUND_DROPS,10000)
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'large-world.json'
            world=World(path)
            now=time.time()+3600
            world.boxes.update((i,box(i%100,i//100,now))
                               for i in range(1,MAX_GROUND_DROPS+1))
            world.next_box=MAX_GROUND_DROPS+1
            self.assertEqual(len(world.boxes),MAX_GROUND_DROPS)
            world.save()
            loaded=World(path)
            self.assertEqual(len(loaded.boxes),MAX_GROUND_DROPS)
            self.assertEqual(len(list(loaded.boxes.nearby(2,2,8)))>0,True)
            self.assertEqual(loaded.boxes.expired(now-1),[])
            invalid=json.loads(path.read_text())
            invalid['boxes'][str(MAX_GROUND_DROPS+1)]=box(1,2,now)
            path.write_text(json.dumps(invalid))
            overloaded=World(path)
            self.assertEqual(len(overloaded.boxes),0,'invalid world save must be rejected')
