"""Validate the editable three-character .blend, without changing it.

Use blender -b path/to/humanoid_animation_workbench.blend --python-exit-code 1
--python path/to/validate_multi_workbench.py
"""
import bpy

NAME_TO_RIG={
    'male':'Humanoid_Rig53',
    'female':'Female_Rig53',
    'lumberjack':'Lumberjack_Rig53',
}
CLIPS={
    'idle','idle_breathe','idle_fidget','idle_look','walk',
    'walk_backward','run','run_backward','strafe_left','strafe_right',
    'jump','fall','land','Chop',
}
scene=bpy.context.scene
bones_by_variant={}
for variant,rig_name in NAME_TO_RIG.items():
    rig=bpy.data.objects[rig_name]
    bones_by_variant[variant]=[
        (b.name, b.parent.name if b.parent else None)
        for b in rig.data.bones
    ]
    assert len(bones_by_variant[variant])==53
    # The artist may have any Action selected while editing. Do not require
    # an idle clip: validation must respect their saved workspace state.
    assert rig.animation_data is not None
    own={a.name[len(variant)+2:] for a in bpy.data.actions
         if a.name.startswith(variant+'__')}
    assert own==CLIPS,(variant,own^CLIPS)
    layer=scene.view_layers['EDIT · '+variant]
    count=0
    for child in layer.layer_collection.children:
        if child.collection.name.startswith('CHARACTER · '):
            visible=not child.exclude
            assert visible==(child.collection.name=='CHARACTER · '+variant)
            count+=int(visible)
    assert count==1,(variant,count)
    print('VARIANT_OK',variant,'53 bones','14 own clips',flush=True)
assert bones_by_variant['male']==bones_by_variant['female']==bones_by_variant['lumberjack']

# All Lumberjack Actions have the same Blender Action Editor organization
# as male/female: 53 collapsible per-bone groups, 10 channels in each.
for action in bpy.data.actions:
    if not action.name.startswith(('lumberjack__','REF_Lumberjack_')):
        continue
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                assert len(bag.fcurves)==530,(action.name,len(bag.fcurves))
                assert len(bag.groups)==53,(action.name,len(bag.groups))
                assert all(len(group.channels)==10 for group in bag.groups)
                # Do not assert collapsed UI state: artists can open/save
                # their preferred bone groups in the Action Editor.
                assert all(curve.group is not None for curve in bag.fcurves)
print('LUMBERJACK_CHANNEL_GROUPS_VALID',16,'Actions',53,'bone groups per Action',flush=True)

lumberjack=bpy.data.objects['Lumberjack_Rig53']
parts=[o for o in bpy.data.objects if o.name.startswith('Lumberjack.')
       and o.type=='MESH' and 'Axe' not in o.name]
assert len(parts)==56,len(parts)
# The original footwear has no independently skinned ball mesh: the entire
# sole is weighted to foot_l / foot_r, not to the new toe joints.
for original,side in [('Boot L','l'),('Boot R','r'),
                      ('Boot lace','r'),('Boot lace.003','l')]:
    shoe=bpy.data.objects['Lumberjack.'+original]
    assert {g.name for g in shoe.vertex_groups}=={'foot_'+side},original
for part in parts:
    assert part.parent==lumberjack
    assert any(m.type=='ARMATURE' and m.object==lumberjack for m in part.modifiers)
    assert all(v.groups for v in part.data.vertices),part.name
    assert all(g.name in lumberjack.data.bones for g in part.vertex_groups)
socket=bpy.data.objects['Socket.handRight · Lumberjack']
assert socket.parent==lumberjack and socket.parent_bone=='hand_r'
assert {o.name for o in socket.children}=={
    'Lumberjack.Axe blade','Lumberjack.Axe handle'}
assert all(not any(m.type=='ARMATURE' for m in o.modifiers)
           for o in socket.children)
female_grip=bpy.data.objects['AXE_GRIP · Female']
assert female_grip.parent==bpy.data.objects['Female_Rig53']
assert female_grip.parent_bone=='hand_r'
assert len(female_grip.children)==5
for extra in ('REF_Lumberjack_Death_original',
              'REF_Lumberjack_Chop_alternative_original'):
    assert bpy.data.actions.get(extra)
assert not bpy.data.objects.get('Lumberjack Rig')

# Regression: the original Forearm.L controlled both sleeve and left hand.
# The new hand_l must remain at the end of lowerarm_l in every Action.
if bpy.context.window:
    bpy.context.window.view_layer=scene.view_layers['EDIT · lumberjack']
for clip in sorted(CLIPS):
    action=bpy.data.actions['lumberjack__'+clip]
    lumberjack.animation_data.action=action
    lumberjack.animation_data.action_slot=action.slots[0]
    for frame in (1,max(1,round((action.frame_range[1]+1)/2)),
                  round(action.frame_range[1])):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        forearm=lumberjack.pose.bones['lowerarm_l']
        hand=lumberjack.pose.bones['hand_l']
        gap=(forearm.tail-hand.head).length
        assert gap<0.001,(clip,frame,gap)
        assert forearm==hand.parent,(clip,'wrist parent changed')
        print('LEFT_WRIST_CONNECTED',clip,frame,round(gap,6),flush=True)
        for side in ('l','r'):
            calf=lumberjack.pose.bones['calf_'+side]
            foot=lumberjack.pose.bones['foot_'+side]
            ball=lumberjack.pose.bones['ball_'+side]
            ankle_gap=(calf.tail-foot.head).length
            toe_gap=(foot.tail-ball.head).length
            assert foot.parent==calf and ball.parent==foot,(clip,side,'bone hierarchy')
            assert ankle_gap<0.001 and toe_gap<0.001,(
                clip,frame,side,ankle_gap,toe_gap)
            print('ANKLE_CHAIN_CONNECTED',clip,frame,side,
                  round(ankle_gap,6),round(toe_gap,6),flush=True)
# Locomotion Root X/Y paths must follow male/female curves by normalized
# clip phase. Do not change the artist's saved keyframe timing or durations.
def root_location_curve(action,axis):
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    if fc.data_path=='pose.bones["Root"].location' and fc.array_index==axis:
                        return fc
    raise AssertionError((action.name,'missing Root.location',axis))

for motion in ('walk','walk_backward','run','run_backward',
               'strafe_left','strafe_right'):
    male=bpy.data.actions['male__'+motion]
    female=bpy.data.actions['female__'+motion]
    lumber=bpy.data.actions['lumberjack__'+motion]
    m_start,m_end=male.frame_range
    f_start,f_end=female.frame_range
    l_start,l_end=lumber.frame_range
    assert l_start<l_end and m_start<m_end and f_start<f_end
    if motion.startswith('strafe_'):
        # 26.25 frame span is 0.875 s at 30 FPS, just like male/female.
        assert abs((l_end-l_start)-(m_end-m_start))<1e-4,(
            motion,'duration mismatch',male.frame_range,lumber.frame_range)
        assert abs((l_end-l_start)-(f_end-f_start))<1e-4
        assert abs((l_end-l_start)/scene.render.fps-.875)<1e-4
        print('STRAFE_DURATION_MATCHED',motion,'seconds',round((l_end-l_start)/scene.render.fps,5),flush=True)
    for axis in (0,1):
        mc=root_location_curve(male,axis)
        fc=root_location_curve(female,axis)
        lc=root_location_curve(lumber,axis)
        m_origin=mc.evaluate(m_start)
        f_origin=fc.evaluate(f_start)
        l_origin=lc.evaluate(l_start)
        m_delta=mc.evaluate(m_end)-m_origin
        f_delta=fc.evaluate(f_end)-f_origin
        l_delta=lc.evaluate(l_end)-l_origin
        assert abs(m_delta-f_delta)<1e-4,(motion,'male/female disagree')
        assert abs(m_delta-l_delta)<1e-4,(motion,axis,m_delta,l_delta)
        assert abs(l_origin)<1e-4,(motion,axis,'nonzero start',l_origin)
        for key in lc.keyframe_points:
            phase=(key.co.x-l_start)/(l_end-l_start)
            value=mc.evaluate(m_start+phase*(m_end-m_start))-m_origin
            assert abs(key.co.y-value)<1e-4,(
                motion,axis,key.co.x,key.co.y,value)
    assert lumber.get('fc_root_motion')=='matches_male_female',motion
    print('ROOT_DISTANCE_MATCHED',motion,
          'meters_xy',tuple(round(root_location_curve(lumber,i).evaluate(l_end)-
                                  root_location_curve(lumber,i).evaluate(l_start),5)
                            for i in (0,1)),
          'duration_frames',round(l_end-l_start,4),flush=True)
lumberjack.animation_data.action=bpy.data.actions['lumberjack__idle']
lumberjack.animation_data.action_slot=lumberjack.animation_data.action.slots[0]
scene.frame_set(1)
print('WORKBENCH_VALID: 3 rigs, shared schema, 42 independent Actions, '
      'two original references, separate axes, no old 13-bone rig',flush=True)
