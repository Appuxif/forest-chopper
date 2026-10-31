"""Structural QA for generated 10k modular 53-bone humanoid and outfits.

Run: python3 -m unittest discover -s tests -p test_humanoid_lite.py -v
"""
from pathlib import Path
import json,struct,unittest

ROOT=Path(__file__).resolve().parents[1]/'characters'/'humanoid'
SRC=ROOT/'source'
LITE=ROOT/'lite'

def doc(file):
    buf=file.read_bytes()
    if len(buf)<20 or buf[:4]!=b'glTF':raise ValueError(file)
    v,n=struct.unpack_from('<II',buf,4)
    if v!=2 or n!=len(buf):raise ValueError('Invalid GLB: '+str(file))
    size,kind=struct.unpack_from('<II',buf,12)
    if kind!=0x4e4f534a:raise ValueError(file)
    return json.loads(buf[20:20+size])

def triangles(gltf):
    return sum(gltf['accessors'][p['indices']]['count']//3
               for m in gltf['meshes'] for p in m['primitives'])

def joints(gltf):
    return {gltf['nodes'][n]['name'] for n in gltf['skins'][0]['joints']}

def shape_keys(gltf):
    return sum(len(p.get('targets',[])) for m in gltf['meshes'] for p in m['primitives'])

class HumanoidLiteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.body={gender:doc(LITE/f'body_{gender}.glb') for gender in ('male','female')}
        cls.clothing=json.loads((SRC/'clothing.json').read_text())['items']
        cls.hair=json.loads((SRC/'hair.json').read_text())['styles']

    def test_two_gender_bases_share_complete_rig(self):
        male,female=self.body.values()
        self.assertEqual(joints(male),joints(female))
        self.assertEqual(len(joints(male)),53)
        self.assertTrue({'hand_l','hand_r','pelvis','ball_l','head'}<=joints(male))
        self.assertEqual(shape_keys(male),0)
        self.assertEqual(shape_keys(female),0)

    def test_fixed_face_presets_have_no_runtime_morphs(self):
        for gender in self.body:
            for face in ('angular','soft'):
                candidate=doc(LITE/f'body_{gender}_{face}.glb')
                with self.subTest(gender=gender,face=face):
                    self.assertEqual(joints(candidate),joints(self.body[gender]))
                    self.assertEqual(shape_keys(candidate),0)
                    self.assertEqual(len(candidate.get('animations',[])),12)
                    self.assertLessEqual(triangles(candidate),6200)

    def test_animations_preserved_and_target_skeleton(self):
        for gender,model in self.body.items():
            with self.subTest(gender=gender):
                self.assertEqual(len(model.get('animations',[])),12)
                for a in model['animations']:
                    for channel in a['channels']:
                        node=model['nodes'][channel['target']['node']]
                        self.assertIn(node['name'],joints(model))

    def test_every_clothing_and_hair_variant(self):
        for gender in self.body:
            for item in self.clothing+self.hair:
                with self.subTest(gender=gender,item=item['id']):
                    filename=item['file'].removesuffix('.glb')+'_'+gender+'.glb'
                    obj=doc(LITE/filename)
                    self.assertEqual(len(obj.get('skins',[])),1)
                    self.assertEqual(joints(obj),joints(self.body[gender]))
                    self.assertEqual(shape_keys(obj),0)
                    self.assertEqual(len(obj['meshes']),1)
                    self.assertGreater(triangles(obj),100)

    def test_budget_default_dressed_avatar(self):
        for gender,model in self.body.items():
            files=[f'clothing_{s}_{gender}.glb' for s in ('shirt','jeans','shoes')]
            files.append(f'hair_short02_{gender}.glb')
            total=triangles(model)+sum(triangles(doc(LITE/file)) for file in files)
            with self.subTest(gender=gender):
                self.assertLessEqual(total,10300)
                self.assertGreater(total,8500)

    def test_lite_code_and_standalone_viewer(self):
        self.assertTrue((ROOT/'humanoid-lite.js').exists())
        self.assertTrue((ROOT/'preview-lite.html').exists())
        self.assertTrue((ROOT/'build_lite.py').exists())

if __name__=='__main__':unittest.main()
