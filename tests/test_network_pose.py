"""ORI-07 authoritative orientation: real WebSocket packets and hit geometry."""
import asyncio
import json
import math
import tempfile
import unittest
from pathlib import Path

from websockets.asyncio.server import serve
from websockets.asyncio.client import connect
from forest_server import (
    World,read_network_pose,shortest_yaw_delta,target_within_axe_arc,
    structure_within_axe_arc,tree_info,
)


def facing(x,z,tx,tz):
    return math.atan2(-(tx-x),-(tz-z))


class NetworkPoseUnitTests(unittest.TestCase):
    def test_packet_validation_and_wraparound(self):
        self.assertEqual(read_network_pose({'yaw':0})['torsoYaw'],0)
        self.assertIsNone(read_network_pose({'yaw':True}))
        self.assertIsNone(read_network_pose({'yaw':math.inf}))
        self.assertIsNone(read_network_pose({'yaw':float('nan')}))
        self.assertIsNone(read_network_pose({'yaw':0,'headYaw':math.inf}))
        self.assertIsNone(read_network_pose({'yaw':0,'motion':'Chop2'}))
        self.assertIsNone(read_network_pose({'yaw':0,'torsoYaw':math.radians(91)}))
        self.assertIsNotNone(read_network_pose({'yaw':math.radians(179),'torsoYaw':math.radians(-179)}))
        self.assertAlmostEqual(shortest_yaw_delta(math.radians(179),math.radians(-179)),
                               math.radians(2),places=7)

    def test_attack_front_and_chest_cone(self):
        p={'x':0,'z':0,'yaw':0,'torsoYaw':0}
        self.assertTrue(target_within_axe_arc(p,0,-1.5))
        self.assertFalse(target_within_axe_arc(p,0,-2.5))
        self.assertFalse(target_within_axe_arc(p,0,1.5))
        self.assertFalse(target_within_axe_arc(p,1.5,0))
        self.assertFalse(target_within_axe_arc(p,-1.45,-.2))
        p['torsoYaw']=math.radians(45)
        self.assertTrue(target_within_axe_arc(p,-1.45,-.2))
        self.assertFalse(target_within_axe_arc(p,-1.45,.2))
        self.assertTrue(structure_within_axe_arc(p,{'x':0,'z':-1.2}))
        self.assertFalse(structure_within_axe_arc(p,{'x':0,'z':1.2}))


class NetworkPoseWebSocketTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.world=World(Path(self.folder.name)/'world.json')
        self.server=await serve(self.world.handler,'127.0.0.1',0)
        self.url='ws://127.0.0.1:'+str(self.server.sockets[0].getsockname()[1])

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()
        self.folder.cleanup()

    async def event(self,ws,kind):
        for _ in range(8):
            data=json.loads(await asyncio.wait_for(ws.recv(),1))
            if data.get('type')==kind:return data
        self.fail('No '+kind)

    async def test_move_is_rebroadcast_with_pose_and_join_snapshots(self):
        async with connect(self.url) as alice, connect(self.url) as bob:
            a=await self.event(alice,'welcome')
            await self.event(bob,'welcome')
            await bob.send(json.dumps({'type':'hello','name':'Bob'}))
            await self.event(alice,'join')
            pose={'yaw':0,'torsoYaw':.6,'torsoPitch':-.2,
                  'headYaw':.15,'headPitch':-.25,'motion':'WalkBackward'}
            await alice.send(json.dumps({'type':'move','x':0,'z':0,
                                         'y':0,'jumping':False,**pose}))
            move=await self.event(bob,'move')
            self.assertEqual(move['id'],a['id'])
            for field,value in pose.items():self.assertAlmostEqual(move[field],value) if isinstance(value,float) else self.assertEqual(move[field],value)
            async with connect(self.url) as charlie:
                welcome=await self.event(charlie,'welcome')
                from_alice=next(p for p in welcome['players'] if p['id']==a['id'])
                for field in pose:self.assertIn(field,from_alice)
                self.assertEqual(from_alice['motion'],'WalkBackward')

    async def test_invalid_pose_cannot_mutate_server_or_reach_other_players(self):
        async with connect(self.url) as alice, connect(self.url) as bob:
            await self.event(alice,'welcome')
            await self.event(bob,'welcome')
            await bob.send(json.dumps({'type':'hello','name':'Bob'}))
            await self.event(alice,'join')
            player=next(p for p in self.world.clients.values() if p['id']==1)
            for payload in ({'yaw':0,'torsoYaw':math.pi},
                            {'yaw':0,'headPitch':math.inf},
                            {'yaw':0,'motion':'__proto__'}):
                await alice.send(json.dumps({'type':'move','x':0,'z':0,**payload}))
                await asyncio.sleep(.025)
                self.assertEqual(player['torsoYaw'],0.)
            # Old client: yaw-only packet is still accepted and mirrored.
            await alice.send(json.dumps({'type':'move','x':0,'z':0,'yaw':.3}))
            msg=await self.event(bob,'move')
            self.assertAlmostEqual(msg['torsoYaw'],.3)
            self.assertIsNone(msg['motion'])

    async def test_tree_hit_is_rejected_behind_at_side_or_far_away(self):
        async with connect(self.url) as ws:
            await self.event(ws,'welcome')
            player=next(iter(self.world.clients.values()))
            key=next(k for k in (f'{x},{z}:{i}' for x in range(-2,3)
                      for z in range(-2,3) for i in range(8))
                     if tree_info(k,self.world.seed))
            tx,tz,hp=tree_info(key,self.world.seed)
            player.update(x=tx,z=tz-1.5,yaw=0,torsoYaw=0,last_hit=0)
            await ws.send(json.dumps({'type':'hit','tree':key}))
            await asyncio.sleep(.04)
            self.assertNotIn(key,self.world.damage)
            player.update(x=tx+1.5,z=tz,yaw=0,torsoYaw=0,last_hit=0)
            await ws.send(json.dumps({'type':'hit','tree':key}))
            await asyncio.sleep(.04)
            self.assertNotIn(key,self.world.damage)
            player.update(x=tx+2.5,z=tz,yaw=math.pi/2,torsoYaw=math.pi/2,last_hit=0)
            await ws.send(json.dumps({'type':'hit','tree':key}))
            await asyncio.sleep(.04)
            self.assertNotIn(key,self.world.damage)
            player.update(x=tx+1.5,z=tz,yaw=math.pi/2,torsoYaw=math.pi/2,last_hit=0)
            await ws.send(json.dumps({'type':'hit','tree':key}))
            hit=await self.event(ws,'tree_hit')
            self.assertEqual(hit['hp'],hp-1)

    async def test_structure_must_be_in_front_and_two_metres_away(self):
        async with connect(self.url) as ws:
            await self.event(ws,'welcome')
            player=next(iter(self.world.clients.values()))
            player.update(x=0,z=0,yaw=0,torsoYaw=0)
            self.world.furniture[15]={'kind':'bench','x':0,'z':1.4,'orientation':0}
            await ws.send(json.dumps({'type':'hit_structure','kind':'bench','id':15}))
            await asyncio.sleep(.04)
            self.assertIn(15,self.world.furniture)
            self.world.furniture[15]['z']=-2.4
            await ws.send(json.dumps({'type':'hit_structure','kind':'bench','id':15}))
            await asyncio.sleep(.04)
            self.assertIn(15,self.world.furniture)
            self.world.furniture[15]['z']=-1.4
            await ws.send(json.dumps({'type':'hit_structure','kind':'bench','id':15}))
            removed=await self.event(ws,'furniture_remove')
            self.assertEqual(removed['id'],15)
            self.assertNotIn(15,self.world.furniture)


if __name__=='__main__':
    unittest.main()
