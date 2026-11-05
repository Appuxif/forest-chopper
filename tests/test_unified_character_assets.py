"""Validate the three playable GLBs' common rig and animation contract.

No Blender or network required: read the exported glTF JSON chunks directly.
The classic source GLB stays in lumberjack/ but is no longer loaded by game JS.
"""
import json
import struct
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
GAME=ROOT/'characters/humanoid/game'
ANIMATION_NAME='walk_backward'
CLIPS={
    'idle','idle_breathe','idle_fidget','idle_look','walk','walk_backward',
    'run','run_backward','strafe_left','strafe_right','jump','fall','land','Chop'
}
LOCOMOTION={
    'walk':(0,-1.32),
    'walk_backward':(0,1.32),
    'run':(0,-3.40782),
    'run_backward':(0,1.16),
    'strafe_left':(.60,0),
    'strafe_right':(-.60,0),
}


def metadata(path):
    data=path.read_bytes()
    assert data[:4]==b'glTF'
    size=struct.unpack_from('<I',data,12)[0]
    return json.loads(data[20:20+size])


def hierarchy(gltf):
    parent={}
    for node in gltf['nodes']:
        for child in node.get('children',[]):
            assert child not in parent
            parent[child]=node.get('name')
    joints=gltf['skins'][0]['joints']
    bone_names={gltf['nodes'][n]['name'] for n in joints}
    # The outer Blender armature object has a variant-specific name; the
    # 53 joints themselves must have identical parents and local hierarchy.
    return {gltf['nodes'][n]['name']:(
       parent[n] if parent.get(n) in bone_names else None
    ) for n in joints}


def animation_contract(gltf):
    found={}
    for action in gltf['animations']:
        samplers=[gltf['accessors'][s['input']] for s in action['samplers']]
        first=min(v['min'][0] for v in samplers)
        last=max(v['max'][0] for v in samplers)
        name='walk_backward' if action['name']=='walk_back' else action['name']
        found[name]=(first,last)
    return found


class UnifiedCharacterAssetsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.models={name:metadata(GAME/('body_'+name+'.glb'))
                    for name in ('male','female','legacy')}

    def test_all_three_have_identical_skeleton_names_and_hierarchy(self):
        expected=hierarchy(self.models['male'])
        self.assertEqual(len(expected),53)
        for name,gltf in self.models.items():
            self.assertEqual(len(gltf['skins']),1,name)
            self.assertEqual(hierarchy(gltf),expected,name)
            self.assertIn('hand_r',expected,name)
            self.assertEqual(expected['hand_r'],'lowerarm_r',name)

    def test_each_model_owns_same_14_named_clips_and_absolute_timestamps(self):
        reference=animation_contract(self.models['male'])
        self.assertEqual(set(reference),CLIPS)
        for name,gltf in self.models.items():
            actions=animation_contract(gltf)
            self.assertEqual(set(actions),CLIPS,name)
            for clip in CLIPS:
                for actual,expected in zip(actions[clip],reference[clip]):
                    self.assertAlmostEqual(actual,expected,places=4,
                       msg=name+' / '+clip+' first/last GLB timestamp')

    def test_all_six_ground_motion_distances_agree(self):
        # Read the exported Root translations (VEC3, float32) for each model.
        # The game uses glTF Y-up, so Blender -Y maps to glTF +Z.
        def root_delta(model, motion):
            path=GAME/('body_'+model+'.glb')
            raw=path.read_bytes()
            gltf=self.models[model]
            json_size=struct.unpack_from('<I',raw,12)[0]
            binary_start=20+json_size+8
            runtime_name='walk_back' if model!='legacy' and motion=='walk_backward' else motion
            action=next(a for a in gltf['animations'] if a['name']==runtime_name)
            channels=[c for c in action['channels'] if
                      gltf['nodes'][c['target']['node']]['name']=='Root'
                      and c['target']['path']=='translation']
            self.assertEqual(len(channels),1)
            sampler=action['samplers'][channels[0]['sampler']]
            accessor=gltf['accessors'][sampler['output']]
            self.assertEqual(accessor['componentType'],5126)
            self.assertEqual(accessor['type'],'VEC3')
            view=gltf['bufferViews'][accessor['bufferView']]
            offset=binary_start+view.get('byteOffset',0)+accessor.get('byteOffset',0)
            stride=view.get('byteStride',12)
            first=struct.unpack_from('<fff',raw,offset)
            last=struct.unpack_from('<fff',raw,offset+(accessor['count']-1)*stride)
            return last[0]-first[0],last[2]-first[2]

        for model in ('legacy','male','female'):
            for motion,(x,y_blender) in LOCOMOTION.items():
                dx,dz=root_delta(model,motion)
                self.assertAlmostEqual(dx,x,places=3,msg=model+' '+motion)
                self.assertAlmostEqual(dz,-y_blender,places=3,
                                       msg=model+' '+motion)

    def test_skin_data_is_complete_and_body_has_own_materials(self):
        for name,gltf in self.models.items():
            self.assertGreaterEqual(len(gltf.get('materials',[])),1,name)
            for mesh in gltf['meshes']:
                for prim in mesh['primitives']:
                    self.assertIn('JOINTS_0',prim['attributes'],name)
                    self.assertIn('WEIGHTS_0',prim['attributes'],name)
        self.assertEqual(len(self.models['legacy']['meshes']),56)
        self.assertEqual(len(self.models['male']['meshes']),4)
        self.assertEqual(len(self.models['female']['meshes']),4)

    def test_legacy_handright_axe_is_standalone(self):
        axe=metadata(ROOT/'characters/humanoid/game/axe_shared.glb')
        self.assertEqual(len(axe['meshes']),5)
        self.assertFalse(axe.get('skins'))
        self.assertFalse(axe.get('animations'))
        self.assertEqual(sum(node.get('name','').startswith('AXE_GRIP')
                             for node in axe['nodes']),1)


if __name__=='__main__':
    unittest.main()
