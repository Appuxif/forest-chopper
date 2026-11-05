"""Bounded reactive collision steering shared by mob behaviors."""
import math


def steer_mob(mob, dt, speed, yaw, standable, random):
    mob['avoid_time'] = max(0, mob.get('avoid_time', 0)-dt)
    mob['avoid_retry'] = max(0, mob.get('avoid_retry', 0)-dt)
    if not speed > 0 or not dt > 0:
        if not speed:
            mob['avoid_time'] = 0
            mob['avoid_retry'] = 0
        return None
    travel = speed*min(dt, .25)

    def corridor(angle, distance):
        steps = max(1, math.ceil(distance/.2))
        return all(standable(mob['x']+math.sin(angle)*distance*i/steps,
                             mob['z']+math.cos(angle)*distance*i/steps)
                   for i in range(1, steps+1))

    angle = mob['avoid_yaw'] if mob['avoid_time'] > 0 else yaw
    turned = False
    if not corridor(angle, travel):
        mob['avoid_time'] = 0
        if mob['avoid_retry'] > 0:
            return None
        side = -1 if random() < .5 else 1
        offsets = [side*math.pi/4, -side*math.pi/4, side*math.pi/2,
                   -side*math.pi/2, side*3*math.pi/4, -side*3*math.pi/4, math.pi]
        for offset in offsets:
            candidate = yaw+offset
            if not corridor(candidate, max(.8, travel)):
                continue
            angle, turned = candidate, True
            mob['avoid_yaw'], mob['avoid_time'] = angle, .6+random()*.4
            break
        else:
            mob['avoid_retry'] = .3
            return None
    return {'x':mob['x']+math.sin(angle)*travel,
            'z':mob['z']+math.cos(angle)*travel,'yaw':angle,'turned':turned}
