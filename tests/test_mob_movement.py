import math
import unittest
from mob_steering import steer_mob
from mob_flocking import build_flocks,flock_heading
from mob_world import MobPopulation
from mob_definitions import CHICKEN

SETTINGS={'radius':6,'catchUpRadius':12,'separation':1,'cohesion':.7}

class MobMovementTests(unittest.TestCase):
    def test_blocked_direction_changes_and_is_held(self):
        mob={'x':0,'z':0}
        standable=lambda x,z: not (x>.1 and abs(z)<2)
        a=steer_mob(mob,.1,3.6,math.pi/2,standable,lambda:.25)
        self.assertTrue(a['turned']);self.assertLess(abs(a['x']),.1);self.assertGreater(a['z'],0)
        mob.update(a);b=steer_mob(mob,.1,3.6,math.pi/2,standable,lambda:.25)
        self.assertGreater(b['z'],a['z']);self.assertLess(abs(b['x']),.1)

    def test_enclosed_mob_does_not_move_or_probe_unboundedly(self):
        mob={'x':0,'z':0};calls=[]
        def blocked(x,z):calls.append((x,z));return False
        self.assertIsNone(steer_mob(mob,.1,3.6,0,blocked,lambda:.5))
        self.assertLessEqual(len(calls),40);before=len(calls)
        self.assertIsNone(steer_mob(mob,.1,3.6,0,blocked,lambda:self.fail('retry must not reroll yet')))
        self.assertEqual(len(calls)-before,1)

    def test_flock_tracks_its_members_not_a_fixed_spawn_or_other_group(self):
        rows=[{'id':'a','source':'0,0:0','health':1,'x':0,'z':0},
              {'id':'b','source':'0,0:1','health':1,'x':1,'z':0},
              {'id':'c','source':'0,0:2','health':1,'x':50,'z':0},
              {'id':'other','source':'1,0:0','health':1,'x':999,'z':0},
              {'id':'dead','source':'0,0:3','health':0,'x':999,'z':0}]
        group=build_flocks(rows)['0,0'];self.assertEqual(group['x'],17);self.assertEqual(len(group['members']),3)
        result=flock_heading(rows[0],group,(0,1),SETTINGS)
        self.assertTrue(result['catchingUp']);self.assertGreater(math.sin(result['yaw']),0)
        self.assertLess(math.sin(flock_heading(rows[2],group,(1,0),SETTINGS)['yaw']),0)
        rows[2]['x']=2;self.assertEqual(build_flocks(rows)['0,0']['x'],1)

    def test_birth_anchors_halve_centroid_drift_and_attract_singleton_home(self):
        rows=[{'id':i,'source':'0,0:'+str(i),'health':1,'x':20,'z':0,'spawn_x':0,'spawn_z':0} for i in range(2)]
        self.assertEqual(build_flocks(rows)['0,0']['x'],10)
        solo=dict(rows[0],id='solo',x=40);group=build_flocks([solo])['0,0']
        result=flock_heading(solo,group,(0,1),SETTINGS)
        self.assertEqual(result['distance'],20);self.assertTrue(result['catchingUp'])
        solo['x']=1;near_home=flock_heading(solo,build_flocks([solo])['0,0'],(0,1),SETTINGS)
        self.assertFalse(near_home['catchingUp']);self.assertFalse(near_home['needsMove'])

    def test_panic_has_priority_over_the_centroid_and_follow_state_survives_save(self):
        p=MobPopulation(1,CHICKEN)
        for i,x in enumerate((5,-20,-21)):
            r=p._spawn_record(0,0,i,0);r.update(x=x,z=0,y=0);p.live[r['id']]=r
        first=p.live['h:0,0:0:g0']
        p.tick([{'x':4,'z':0}],.1,1000,lambda x,z:True,lambda x,z:0)
        self.assertGreater(first['x'],5)
        p.tick([{'x':90,'z':0}],.1,1004,lambda x,z:True,lambda x,z:0)
        row=p.live['h:0,0:1:g0'];row['flock_following']=True
        saved=p.save_data();restored=MobPopulation(1,CHICKEN,saved)
        self.assertTrue(restored.live[row['id']]['flock_following'])

    def test_live_save_retains_birth_anchor_and_legacy_save_derives_original_site(self):
        p=MobPopulation(84,CHICKEN);row=p._spawn_record(0,0,0,0);home=(row['spawn_x'],row['spawn_z'])
        row.update(x=row['x']+80,z=row['z']-30);p.live[row['id']]=row
        saved=p.save_data();self.assertEqual((saved['live'][row['id']]['spawn_x'],saved['live'][row['id']]['spawn_z']),home)
        restored=MobPopulation(84,CHICKEN,saved);self.assertEqual((restored.live[row['id']]['spawn_x'],restored.live[row['id']]['spawn_z']),home)
        legacy=p.save_data();legacy['live'][row['id']].pop('spawn_x');legacy['live'][row['id']].pop('spawn_z')
        self.assertEqual((MobPopulation(84,CHICKEN,legacy).live[row['id']]['spawn_x'],
                          MobPopulation(84,CHICKEN,legacy).live[row['id']]['spawn_z']),home)
        bad=p.save_data();bad['live'][row['id']].pop('spawn_z')
        self.assertNotIn(row['id'],MobPopulation(84,CHICKEN,bad).live)

    def test_scattered_flock_stays_bounded_around_birth_centroid(self):
        p=MobPopulation(12,CHICKEN);ids=[];homes=[]
        for i,x in enumerate((0,1,50)):
            row=p._spawn_record(0,0,i,0);homes.append((row['spawn_x'],row['spawn_z']));row.update(x=x,y=0,z=0);p.live[row['id']]=row;ids.append(row['id'])
        for step in range(1200):
            rows=[p.live[ident] for ident in ids]
            x,z=sum(r['x'] for r in rows)/3,sum(r['z'] for r in rows)/3
            p.tick([{'x':x,'z':z+40}],.1,1000+step*.1,lambda x,z:True,lambda x,z:0)
        rows=[p.live[ident] for ident in ids]
        self.assertLess(max(math.hypot(a['x']-b['x'],a['z']-b['z']) for a in rows for b in rows),18)
        home_x=sum(x for x,_ in homes)/3
        self.assertLess(abs(sum(r['x'] for r in rows)/3-home_x),12)

    def test_finished_catchup_returns_to_idle_instead_of_entering_a_false_panic(self):
        p=MobPopulation(2,CHICKEN)
        for i,x in enumerate((0,1,2)):
            row=p._spawn_record(0,0,i,0)
            row.update(x=x,y=0,z=0,state='Run',state_start=999,state_until=1005,flock_following=True)
            p.live[row['id']]=row
        p.tick([{'x':0,'z':40}],.1,1000,lambda x,z:True,lambda x,z:0)
        for row in p.live.values():
            if row['source'].startswith('0,0:'):
                self.assertFalse(row.get('flock_following'))
                self.assertNotEqual(row['state'],'Run')
