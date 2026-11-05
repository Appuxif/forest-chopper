"""Centroid cohesion for spawned groups; independent of species and rendering."""
import math


def flock_key(mob):
    return mob.get('flock_id') or mob['source'].split(':')[0]


def build_flocks(records):
    groups = {}
    for mob in records:
        if mob.get('health',0) <= 0:
            continue
        group = groups.setdefault(flock_key(mob), {'x':0.0,'z':0.0,'birth_x':0.0,'birth_z':0.0,'anchored':True,'members':[]})
        group['x'] += mob['x']
        group['z'] += mob['z']
        group['members'].append({'id':mob['id'],'x':mob['x'],'z':mob['z']})
        if _finite(mob.get('spawn_x')) and _finite(mob.get('spawn_z')):
            group['birth_x'] += mob['spawn_x']
            group['birth_z'] += mob['spawn_z']
        else:
            group['anchored'] = False
    for group in groups.values():
        group['x'] /= len(group['members'])
        group['z'] /= len(group['members'])
        if group['anchored']:
            group['birth_x'] /= len(group['members'])
            group['birth_z'] /= len(group['members'])
            group['x'] = (group['x'] + group['birth_x']) / 2
            group['z'] = (group['z'] + group['birth_z']) / 2
    return groups


def flock_heading(mob, group, desired, settings):
    if not settings or not group or (len(group['members']) < 2 and not group.get('anchored',False)):
        return None
    dx,dz = group['x']-mob['x'],group['z']-mob['z']
    distance = math.hypot(dx,dz)
    catching_up = distance > settings['catchUpRadius'] or (mob.get('flock_following',False) and distance > settings['radius'])
    x,z = desired
    length = math.hypot(x,z) or 1
    x,z = x/length,z/length
    bias = 1 if catching_up else min(settings['cohesion'],max(0,(distance-settings['radius'])/settings['radius'])*settings['cohesion'])
    if distance > 0 and bias > 0:
        angle = math.atan2(dx,dz)+math.sin(mob.get('rng_state',0)*.01)*.25
        x,z = x*(1-bias)+math.sin(angle)*bias,z*(1-bias)+math.cos(angle)*bias
    for neighbor in group['members']:
        if neighbor['id']==mob['id']:
            continue
        sx,sz = mob['x']-neighbor['x'],mob['z']-neighbor['z']
        d = math.hypot(sx,sz)
        if 0 < d < settings['separation']:
            weight = (1-d/settings['separation'])*1.2
            x,z = x+sx/d*weight,z+sz/d*weight
    return {'yaw':math.atan2(x,z),'distance':distance,'needsMove':distance>settings['radius'],'catchingUp':catching_up}


def _finite(value):
    return type(value) in (int,float) and math.isfinite(value)
