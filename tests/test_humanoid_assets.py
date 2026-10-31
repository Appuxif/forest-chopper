"""Structural regression tests for a modular, open-source 53-bone humanoid.

Run: python3 -m unittest discover -s tests -p 'test_humanoid_assets.py' -v
"""
import json
from pathlib import Path
import struct
import unittest

ROOT=Path(__file__).resolve().parents[1]/'characters'/'humanoid'
SRC=ROOT/'source'

def parse_glb(filename):
    data=(SRC/filename).read_bytes()
    assert data[:4]==b'glTF',filename
    version,length=struct.unpack_from('<II',data,4)
    assert version==2 and length==len(data),filename
    size,kind=struct.unpack_from('<II',data,12)
    assert kind==0x4e4f534a,filename
    return json.loads(data[20:20+size])

def bone_names(doc):
    return {doc['nodes'][n].get('name') for n in doc['skins'][0]['joints']}

def morph_names(doc):
    # Files generated from the same CC0 morph-target dictionary.
    for mesh in doc.get('meshes',[]):
        names=mesh.get('extras',{}).get('targetNames')
        if names:return names
    return []

class TestModularHumanoid(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base=parse_glb('makehuman-morph-base.cc0.glb')
        cls.animated=parse_glb('humanoid-base-animated.cc0.glb')
        cls.clothes=json.loads((SRC/'clothing.json').read_text())
        cls.hair=json.loads((SRC/'hair.json').read_text())
        cls.joints=json.loads((SRC/'base_body.joints.json').read_text())

    def test_humanoid_anatomical_bones(self):
        joints=bone_names(self.base)
        self.assertEqual(len(joints),53)
        self.assertTrue({'Root','pelvis','head','neck_01','hand_l','hand_r',
                         'foot_l','foot_r','ball_l','ball_r','clavicle_l','clavicle_r'}<=joints)
        for side in ('l','r'):
            for finger in ('thumb','index','middle','ring','pinky'):
                for i in (1,2,3):
                    self.assertIn(f'{finger}_{i:02d}_{side}',joints)

    def test_skin_morphs_and_anatomy(self):
        mesh=self.base['meshes'][0]
        attributes=mesh['primitives'][0]['attributes']
        self.assertIn('JOINTS_0',attributes)
        self.assertIn('WEIGHTS_0',attributes)
        self.assertIn('_CCZONE',attributes)
        names=morph_names(self.base)
        self.assertEqual(len(names),92)
        self.assertEqual(len(set(names)),92)
        self.assertTrue({'gender_male','gender_female','muscle_max',
                         'weight_min','weight_max','height_tall'}<=set(names))

    def test_animation_clip_names_and_targets(self):
        animations=self.animated['animations']
        self.assertEqual(len(animations),12)
        self.assertTrue({'idle','walk','run','walk_back','strafe_left','strafe_right',
                         'jump','land','fall'}<={a['name'] for a in animations})
        joints=set(self.animated['skins'][0]['joints'])
        for anim in animations:
            self.assertTrue(anim['channels'])
            self.assertTrue(all(c['target']['node'] in joints for c in anim['channels']))

    def test_catalog_assets_match_identical_skeleton(self):
        base_bones=bone_names(self.base)
        morphs=morph_names(self.base)
        for item in self.clothes['items']+self.hair['styles']:
            with self.subTest(item=item['id']):
                path=SRC/item['file']
                self.assertTrue(path.is_file())
                doc=parse_glb(item['file'])
                self.assertEqual(bone_names(doc),base_bones)
                self.assertEqual(morph_names(doc),morphs)
                self.assertEqual(len(doc['skins']),1)

    def test_joint_offsets_cover_rig(self):
        self.assertEqual(set(self.joints['bones']),bone_names(self.base))
        self.assertTrue({'gender_male','gender_female','weight_max'} <= set(self.joints['morphs']))

    def test_editable_blender_scene_and_runtime(self):
        self.assertTrue((ROOT/'humanoid-workbench.blend').is_file())
        self.assertTrue((ROOT/'humanoid.js').is_file())
        self.assertTrue((ROOT/'preview.html').is_file())

if __name__=='__main__':
    unittest.main()
