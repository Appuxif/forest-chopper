"""Structural QA for generated 10k modular 53-bone humanoid and outfits.

Run: python3 -m unittest discover -s tests -p test_humanoid_lite.py -v
"""
from pathlib import Path
import json,struct,unittest

ROOT=Path(__file__).resolve().parents[1]/'characters'/'humanoid'
SRC=ROOT/'source'
LITE=ROOT/'lite'
GAME=ROOT/'game'

def doc(file):
    buf=file.read_bytes()
    if len(buf)<20 or buf[:4]!=b'glTF':raise ValueError(file)
    v,n=struct.unpack_from('<II',buf,4)
    if v!=2 or n!=len(buf):raise ValueError('Invalid GLB: '+str(file))
    size,kind=struct.unpack_from('<II',buf,12)
    if kind!=0x4e4f534a:raise ValueError(file)
    return json.loads(buf[20:20+size])

def glb_animation_samples(buf, model, animation, bone, channel):
    """Read a float animation sampler from the binary GLB chunk."""
    json_size=struct.unpack_from('<I',buf,12)[0]
    binary_start=20+json_size
    binary_size,tag=struct.unpack_from('<II',buf,binary_start)
    assert tag==0x004e4942
    binary=buf[binary_start+8:binary_start+8+binary_size]
    for track in animation['channels']:
        target=track['target']
        if model['nodes'][target['node']].get('name')!=bone or target['path']!=channel:
            continue
        accessor_id=animation['samplers'][track['sampler']]['output']
        accessor=model['accessors'][accessor_id]
        view=model['bufferViews'][accessor['bufferView']]
        components={'VEC3':3,'VEC4':4}[accessor['type']]
        assert accessor['componentType']==5126
        stride=view.get('byteStride',4*components)
        offset=view.get('byteOffset',0)+accessor.get('byteOffset',0)
        return [struct.unpack_from('<'+components*'f',binary,offset+i*stride)
                for i in range(accessor['count'])]
    raise AssertionError(f'No animation channel {animation["name"]}:{bone}:{channel}')


def triangles(gltf):
    return sum(gltf['accessors'][p['indices']]['count']//3
               for m in gltf['meshes'] for p in m['primitives'])

def joints(gltf):
    return {gltf['nodes'][n]['name'] for n in gltf['skins'][0]['joints']}

def shape_keys(gltf):
    return sum(len(p.get('targets',[])) for m in gltf['meshes'] for p in m['primitives'])

def quaternion_multiply(a,b):
    """Multiply xyzw glTF quaternions, without a Blender runtime dependency."""
    x,y,z,w=a
    X,Y,Z,W=b
    return (w*X+x*W+y*Z-z*Y, w*Y-x*Z+y*W+z*X,
            w*Z+x*Y-y*X+z*W, w*W-x*X-y*Y-z*Z)


def quaternion_rotate(q,vector):
    return quaternion_multiply(quaternion_multiply(q,(*vector,0)),
                               (-q[0],-q[1],-q[2],q[3]))[:3]


def rest_joint_positions(gltf):
    """Reconstruct world rest-pose joint positions from glTF parent/TRS."""
    nodes=gltf['nodes']
    parents={child:i for i,node in enumerate(nodes) for child in node.get('children',[])}
    cached={}
    def transform(index):
        if index in cached:return cached[index]
        node=nodes[index]
        position=node.get('translation',(0,0,0))
        rotation=node.get('rotation',(0,0,0,1))
        scale=node.get('scale',(1,1,1))
        if index in parents:
            pp,pq,ps=transform(parents[index])
            rotated=quaternion_rotate(pq,[position[i]*ps[i] for i in range(3)])
            position=[pp[i]+rotated[i] for i in range(3)]
            rotation=quaternion_multiply(pq,rotation)
            scale=[ps[i]*scale[i] for i in range(3)]
        cached[index]=(position,rotation,scale)
        return cached[index]
    return {nodes[i]['name']:transform(i)[0] for i in gltf['skins'][0]['joints']}


def rest_joint_transforms(gltf):
    """The body's outfit skeletons must share precisely the same local bind pose."""
    return {gltf['nodes'][i]['name']:gltf['nodes'][i] for i in gltf['skins'][0]['joints']}


class HumanoidLiteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.body={gender:doc(GAME/f'body_{gender}.glb') for gender in ('male','female')}
        cls.clothing=json.loads((SRC/'clothing.json').read_text())['items']
        cls.hair=json.loads((SRC/'hair.json').read_text())['styles']

    def test_two_gender_bases_share_complete_rig(self):
        male,female=self.body.values()
        self.assertEqual(joints(male),joints(female))
        self.assertEqual(len(joints(male)),53)
        self.assertTrue({'hand_l','hand_r','pelvis','ball_l','head'}<=joints(male))
        self.assertGreater(shape_keys(male),0)
        self.assertGreater(shape_keys(female),0)

    def test_gender_morph_moves_all_rest_joints(self):
        """Baked mesh morphs must also move all 53 skeleton pivots."""
        source=json.loads((SRC/'base_body.joints.json').read_text())
        for gender,model in self.body.items():
            positions=rest_joint_positions(model)
            deltas=source['morphs']['gender_'+gender]
            self.assertEqual(len(positions),53)
            self.assertEqual(set(positions),set(source['bones']))
            for name,base in source['bones'].items():
                expected=[base[i]+0.8*deltas[name][i] for i in range(3)]
                for i in range(3):
                    with self.subTest(gender=gender,joint=name,axis=i):
                        self.assertAlmostEqual(positions[name][i],expected[i],delta=0.001)
        # Male and female rest skeletons must no longer be identical.
        male=rest_joint_positions(self.body['male'])
        female=rest_joint_positions(self.body['female'])
        self.assertGreater(abs(male['hand_r'][0]-female['hand_r'][0]),0.03)

    def test_garments_have_same_bind_joint_transforms_as_body(self):
        for gender,model in self.body.items():
            expected=rest_joint_transforms(model)
            for item in self.clothing+self.hair:
                filename=item['file'].removesuffix('.glb')+'_'+gender+'.glb'
                obj=doc(LITE/filename)
                actual=rest_joint_transforms(obj)
                with self.subTest(gender=gender,item=item['id']):
                    self.assertEqual(set(actual),set(expected))
                    self.assertEqual(obj['accessors'][obj['skins'][0]['inverseBindMatrices']]['count'],53)
                    for name,node in actual.items():
                        reference=expected[name]
                        for field in ('translation','rotation','scale'):
                            a=node.get(field,[])
                            b=reference.get(field,[])
                            self.assertEqual(len(a),len(b))
                            for i in range(len(a)):
                                self.assertAlmostEqual(a[i],b[i],delta=0.0001,
                                    msg=f'{filename} {name} {field}[{i}]')

    def test_face_presets_embedded_in_two_gender_models(self):
        for gender,model in self.body.items():
            self.assertTrue(all(mesh['weights']==[0.,0.] for mesh in model['meshes']))
            self.assertTrue(all(mesh.get('extras',{}).get('targetNames')==['angular','soft']
                                for mesh in model['meshes']))
            self.assertTrue(all(len(p.get('targets',[]))==2
                                for mesh in model['meshes'] for p in mesh['primitives']))
            self.assertLessEqual(triangles(model),6200)
        self.assertFalse(list(LITE.glob('body_*.glb')))

    def test_animations_preserved_and_target_skeleton(self):
        for gender,model in self.body.items():
            with self.subTest(gender=gender):
                self.assertEqual(len(model.get('animations',[])),13)
                for a in model['animations']:
                    for channel in a['channels']:
                        node=model['nodes'][channel['target']['node']]
                        self.assertIn(node['name'],joints(model))

    def test_gender_action_override_preserves_other_gender_bank(self):
        """An authored female__run replaces female Run only, never male Run."""
        import sys
        sys.path.insert(0,str(ROOT))
        from build_game_bodies import animation_bank
        original=list(self.body['male']['animations'])
        other=dict(original[0])
        other['name']='female__run'
        other['marker']='female-specific'
        collection={'animations':original+[other]}
        male=animation_bank(collection,'male')
        female=animation_bank(collection,'female')
        self.assertEqual(len(male),13)
        self.assertEqual(len(female),13)
        self.assertNotIn('marker',male['run'])
        self.assertEqual(female['run']['marker'],'female-specific')
        self.assertEqual(male['walk'],female['walk'])

    def test_single_animation_authoring_workbench(self):
        animation=ROOT/'animation'
        self.assertEqual([p.name for p in animation.glob('*.blend')],
                         ['humanoid_animation_workbench.blend'])
        # Local Blender backup files are ignored and must not fail asset tests.
        self.assertTrue(all(x.name.startswith('humanoid_animation_workbench')
                            for x in animation.glob('*.blend1')))

    def test_all_humanoid_animations_keep_chop_finger_pose(self):
        """All 11 stock clips retain the common Chop finger pose; idle is artist-authored."""
        shared_pose=json.loads((ROOT/'animation/chop_finger_pose.json').read_text())
        names=set(shared_pose['finger_bones'])
        self.assertEqual(len(names),30)
        self.assertNotIn('hand_r',names)
        self.assertNotIn('hand_l',names)
        self.assertEqual(shared_pose['frame'],1)
        self.assertEqual(shared_pose['axe_reference_only']['parent_bone'],'hand_r')
        for gender in ('male','female'):
          for face in ('default',):
            path=GAME/f'body_{gender}.glb'
            gltf=doc(path)
            payload=path.read_bytes()
            reference={}
            for clip in gltf['animations']:
                if clip['name'].startswith('REF_'):continue # experimental actions need their own finger poses
                if clip['name'] in ('Chop','run','walk'):continue # hand-authored actions have intentional grip variation
                if clip['name']=='idle':
                    continue  # Entire Action comes from the user's Blender file.
                for name in names:
                    for channel in ('translation','rotation'):
                        samples=glb_animation_samples(payload,gltf,clip,name,channel)
                        first=samples[0]
                        for sample in (samples[len(samples)//2],samples[-1]):
                            for a,b in zip(first,sample):
                                self.assertAlmostEqual(a,b,delta=0.0001,
                                    msg=f'{gender}:{face}:{clip["name"]}:{name}:{channel}')
                        key=(name,channel)
                        if key not in reference:reference[key]=first
                        else:
                            for a,b in zip(reference[key],first):
                                self.assertAlmostEqual(a,b,delta=0.0001,
                                    msg=f'{gender}:{face}:{clip["name"]}:{name}:{channel}')
            self.assertEqual(len(reference),60)

    def test_authored_actions_have_valid_complete_per_bone_channels(self):
        """Compare working rig ownership, not old source's exact NLA endpoints."""
        originals={'idle','idle_breathe','idle_fidget','idle_look','run','walk',
                   'walk_back','strafe_left','strafe_right','jump','land','fall','Chop'}
        for gender in ('male','female'):
            model=self.body[gender]
            actions={a['name']:a for a in model['animations']}
            self.assertEqual(len(actions),13)
            for name in originals:
                channels={(model['nodes'][c['target']['node']]['name'],c['target']['path'])
                          for c in actions[name]['channels']}
                self.assertEqual(len(channels),159,(gender,name))

    def test_artist_authored_idle_exported_for_both_genders(self):
        """The user-authored 47-frame Blender Action replaces 8-second stock idle."""
        import math
        for gender in ('male','female'):
            for face in ('default',):
                path=GAME/f'body_{gender}.glb'
                model=doc(path)
                idle=next(a for a in model['animations'] if a['name']=='idle')
                self.assertEqual(len(idle['channels']),159)
                durations=[]
                for sampler in idle['samplers']:
                    accessor=model['accessors'][sampler['input']]
                    durations.append(accessor['max'][0]-accessor['min'][0])
                # Blender workbench: 47 frames at 30fps, retimed for 24fps source export.
                self.assertTrue(all(1.45 <= duration <= 1.60 for duration in durations),
                                (gender,face,durations[:5]))
                self.assertTrue(any(model['accessors'][s['input']]['count']>30
                                    for s in idle['samplers']))
                stock=next(a for a in model['animations'] if a['name']=='idle_breathe')
                stock_accessor=model['accessors'][stock['samplers'][0]['input']]
                self.assertGreater(stock_accessor['max'][0]-stock_accessor['min'][0],7.9)

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
                self.assertLessEqual(total,10800)  # Original open cuffs/hem, no fake caps
                self.assertGreater(total,8500)

    def test_shirt_and_tshirt_keep_original_open_rims(self):
        """Prevent accidentally reintroducing triangular collar/cuff/hem caps."""
        builder=(ROOT/'build_lite.py').read_text()
        self.assertNotIn('seal_garment_openings(',builder)
        for gender in self.body:
            for garment,expected_triangles in [('shirt',1209),('tshirt',687)]:
                with self.subTest(gender=gender,garment=garment):
                    obj=doc(LITE/f'clothing_{garment}_{gender}.glb')
                    self.assertEqual(triangles(obj),expected_triangles)
                    self.assertEqual(joints(obj),joints(self.body[gender]))
                    self.assertEqual(shape_keys(obj),0)
                    self.assertTrue(all('JOINTS_0' in p['attributes'] and
                        'WEIGHTS_0' in p['attributes'] for m in obj['meshes']
                        for p in m['primitives']))

    def test_lite_code_and_standalone_viewer(self):
        self.assertTrue((ROOT/'humanoid-lite.js').exists())
        self.assertTrue((ROOT/'preview-lite.html').exists())
        self.assertTrue((ROOT/'build_lite.py').exists())

if __name__=='__main__':unittest.main()
