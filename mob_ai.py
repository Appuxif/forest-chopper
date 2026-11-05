"""Small registry of engine-neutral mob behaviors."""
import math


def wary(population, mob, nearest, distance, now):
    """Wary behavior: flee nearby, then resume its current action when calm."""
    if mob.get('flock_following') and distance>=population.definition.notice_radius:
        return False
    if distance < population.definition.safe_radius:
        mob['_calm'] = None
    elif mob['_calm'] is None:
        mob['_calm'] = now
    if distance < population.definition.notice_radius and nearest:
        mob['flock_following']=False
        dx, dz = mob['x']-nearest['x'], mob['z']-nearest['z']
        mag = (dx*dx+dz*dz)**.5 or 1
        mob['vx'], mob['vz'] = dx/mag*population.definition.run_speed, dz/mag*population.definition.run_speed
        mob['yaw'] = math.atan2(mob['vx'], mob['vz'])
        mob['state'], mob['state_start'], mob['state_until'] = population.definition.animations.get('run', population.definition.animations['walk']), now, now+.25
        return True
    if mob['state'] == population.definition.animations.get('run') and mob['_calm'] is not None and now-mob['_calm'] < population.definition.calm_seconds:
        return True
    if mob['state'] == population.definition.animations.get('run') and now < mob['state_until']:
        return True
    return False


def passive(population, mob, nearest, distance, now):
    """Non-hostile ambient behavior; never changes direction in response to players."""
    return False


BEHAVIORS = {'wary': wary, 'passive': passive}


def register_behavior(name, behavior):
    if not isinstance(name, str) or not name or not callable(behavior):
        raise ValueError('behavior requires a name and callable')
    BEHAVIORS[name] = behavior
