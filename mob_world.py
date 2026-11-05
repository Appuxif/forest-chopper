"""Bounded, deterministic authoritative mob populations and corpse records."""
from __future__ import annotations
from mob_steering import steer_mob
from mob_flocking import build_flocks,flock_heading,flock_key

import hashlib
import math
import random
import time
from mob_definitions import MobDefinition
from mob_ai import BEHAVIORS

MAX_SAVED_LIVE = 256
RNG_MASK = 0xffffffff


def _unit(seed, text):
    digest = hashlib.blake2b(f'{seed}:{text}'.encode(), digest_size=8).digest()
    return int.from_bytes(digest, 'big') / (2**64)


def _appearance(seed, ident, definition):
    choices = definition.subcategories
    if not choices:
        return None
    value = 2166136261
    for char in f'{seed}:{ident}:appearance':
        value = ((value ^ ord(char)) * 16777619) & RNG_MASK
    return choices[value % len(choices)]


def _finite(value):
    return type(value) in (int,float) and math.isfinite(value)


def _valid_pos(value):
    return _finite(value) and abs(value) <= 240000


def _valid_time(value):
    return _finite(value) and 0 <= value <= time.time()+86400


class MobPopulation:
    """One bounded mob population. Definition supplies all species parameters.

    `standable(x,z)` is the server's existing terrain/tree/log collision gate.
    """
    def __init__(self, seed, definition, snapshot=None):
        if not isinstance(definition, MobDefinition):
            raise TypeError('definition must be a MobDefinition')
        self.definition = definition
        self.type_id = definition.type_id
        self.seed = int(seed)
        self.live = {}
        self.corpses = {}
        self.sources = {}
        self._calm_since = {}
        type_salt = int.from_bytes(hashlib.blake2b(definition.type_id.encode(), digest_size=4).digest(), 'big')
        self._rng = random.Random(self.seed ^ type_salt)
        live_rows = {}
        if isinstance(snapshot, dict) and 'corpses' in snapshot:
            self.sources = {str(k): v for k,v in list(snapshot.get('sources',{}).items())[:definition.corpse_limit]
                if isinstance(k,str) and isinstance(v,dict) and type(v.get('generation')) is int
                and v['generation'] > 0 and _valid_time(v.get('respawn_at'))
                and _valid_time(v.get('dead_at',v.get('respawn_at')))}
            corpse_rows = snapshot.get('corpses', {})
            live_rows = snapshot.get('live', {})
        else:
            corpse_rows = snapshot
        if isinstance(corpse_rows, dict):
            for ident, raw in corpse_rows.items():
                corpse = self._validate_corpse(ident, raw)
                if corpse:
                    self.corpses[ident] = corpse
                    source,generation=self._parse_id(ident)
                    if source is not None and source not in self.sources:
                        self.sources[source]={'generation':generation+1,
                            'respawn_at':corpse['respawn_at'],'dead_at':corpse['dead_at']}
        if isinstance(live_rows, dict):
            for ident, raw in list(live_rows.items())[:min(MAX_SAVED_LIVE, definition.live_limit)]:
                hen = self._validate_live(ident, raw)
                if hen and ident not in self.corpses:
                    self.live[ident] = hen

    def _validate_live(self, ident, raw):
        if not isinstance(ident,str) or len(ident)>100 or not isinstance(raw,dict):return None
        source,generation=self._parse_id(ident)
        if (source is None or raw.get('id',ident)!=ident or raw.get('source')!=source
            or type(raw.get('generation')) is not int or raw['generation']!=generation):return None
        if any(not _valid_pos(raw.get(k)) for k in ('x','y','z')):return None
        has_spawn_x='spawn_x' in raw;has_spawn_z='spawn_z' in raw
        if has_spawn_x!=has_spawn_z or (has_spawn_x and (not _valid_pos(raw.get('spawn_x')) or not _valid_pos(raw.get('spawn_z')))):return None
        if any(not _finite(raw.get(k)) for k in ('yaw','vx','vz')):return None
        if abs(raw['yaw'])>100 or abs(raw['vx'])>5 or abs(raw['vz'])>5:return None
        start,until=raw.get('state_start'),raw.get('state_until')
        if not _valid_time(start) and start!=0:return None
        if not _valid_time(until) and until!=0:return None
        if until<start:return None
        health=raw.get('health')
        if raw.get('state') not in self.definition.states or not _finite(health) or not 0<health<=self.definition.health:return None
        rng_state=raw.get('rng_state')
        if type(rng_state) is not int or not 0<=rng_state<=RNG_MASK:return None
        calm=raw.get('calm_since')
        if calm is not None and not _valid_time(calm):return None
        category = raw.get('category', self.definition.category)
        faction = raw.get('faction', self.definition.faction)
        subcategory = raw.get('subcategory') or _appearance(self.seed, ident, self.definition)
        if (category != self.definition.category or faction != self.definition.faction
            or (subcategory is not None and subcategory not in self.definition.subcategories)):
            return None
        if not isinstance(raw.get('flock_following',False),bool):return None
        parsed_cx,parsed_cz_member=source.split(':')
        parsed_cx,parsed_cz=map(int,parsed_cx.split(','));parsed_member=int(parsed_cz_member)
        birth=self._spawn_record(parsed_cx,parsed_cz,parsed_member,generation)
        return {'id':ident,'source':source,'generation':generation,
                'category':category,'faction':faction,'subcategory':subcategory,
                'x':raw['x'],'y':raw['y'],'z':raw['z'],'yaw':raw['yaw'],
                'vx':raw['vx'],'vz':raw['vz'],'state':raw['state'],
                'state_start':start,'state_until':until,'health':health,
                'rng_state':rng_state,'_calm':calm,'flock_following':raw.get('flock_following',False),
                'spawn_x':raw.get('spawn_x',birth['x']),'spawn_z':raw.get('spawn_z',birth['z'])}

    def _validate_corpse(self, ident, raw):
        if not isinstance(ident, str) or len(ident) > 100 or not isinstance(raw, dict):
            return None
        required = ('x', 'y', 'z', 'yaw', 'dead_at', 'respawn_at')
        if any(not _valid_pos(raw.get(k)) for k in ('x','y','z')):
            return None
        if not _finite(raw.get('yaw')) or abs(raw['yaw'])>100:
            return None
        if not _valid_time(raw.get('dead_at')) or not _valid_time(raw.get('respawn_at')):
            return None
        if raw['respawn_at']<raw['dead_at'] or raw['respawn_at']-raw['dead_at']>self.definition.respawn_delay+1e-6:
            return None
        loot = raw.get('loot')
        if not isinstance(loot, dict):
            return None
        validated = {}
        for item, limits in self.definition.loot.items():
            amount = loot.get(item)
            if type(amount) is not int or not 0 <= amount <= limits[1]:
                return None
            validated[item] = amount
        vx,vz=raw.get('vx',0.0),raw.get('vz',0.0)
        if not _finite(vx) or not _finite(vz) or abs(vx)>5 or abs(vz)>5:return None
        category = raw.get('category', self.definition.category)
        faction = raw.get('faction', self.definition.faction)
        subcategory = raw.get('subcategory') or _appearance(self.seed, ident, self.definition)
        if (category != self.definition.category or faction != self.definition.faction
            or (subcategory is not None and subcategory not in self.definition.subcategories)):
            return None
        return {k: raw[k] for k in required} | {'id': ident,'category':category,'faction':faction,'subcategory':subcategory,'vx':vx, 'vz':vz,
            'loot': validated}

    def save_data(self):
        live = {}
        for ident, hen in sorted(self.live.items())[:MAX_SAVED_LIVE]:
            live[ident] = {'id':ident,'source':hen['source'],'generation':hen['generation'],
                'category':hen['category'],'faction':hen['faction'],'subcategory':hen['subcategory'],
                **{key:hen[key] for key in ('x','y','z','yaw','vx','vz','state','state_start','state_until','health')},
                'rng_state':hen['rng_state'],'calm_since':hen['_calm'],'flock_following':hen.get('flock_following',False),
                'spawn_x':hen['spawn_x'],'spawn_z':hen['spawn_z']}
        return {'corpses': {ident: {k:v for k,v in raw.items() if k!='id'} | {'loot': raw['loot'].copy()}
                            for ident, raw in self.corpses.items()},
                'sources': {k:v.copy() for k,v in self.sources.items()}, 'live':live}

    def _group(self, cx, cz):
        key = f'{cx},{cz}'
        if _unit(self.seed, key + ':chance') >= self.definition.cell_chance:
            return []
        count = self.definition.group_min + int(_unit(self.seed, key + ':count') * (self.definition.group_max-self.definition.group_min+1))
        return [self._spawn_record(cx, cz, i, 0) for i in range(count)]

    def _generation_for(self, source, now):
        saved = self.sources.get(source)
        if saved:
            return None if now < saved['respawn_at'] else saved['generation']
        latest = None
        for ident, corpse in self.corpses.items():
            corpse_source, generation = self._parse_id(ident)
            if corpse_source == source and (latest is None or generation > latest[0]):
                latest = (generation, corpse['respawn_at'])
        if latest is None:
            return 0
        generation, respawn_at = latest
        return None if now < respawn_at else generation + 1

    @staticmethod
    def _rand(state):
        state=(1664525*state+1013904223)&RNG_MASK
        return state,state/(RNG_MASK+1)

    def _spawn_record(self, cx, cz, member, generation):
        source = f'{cx},{cz}:{member}'
        if cx == 0 and cz == 0 and member < self.definition.starter_count:
            # Stable guaranteed starter trio around the origin.
            angle = member * (2 * math.pi / 3)
            x, z = math.cos(angle) * 16, math.sin(angle) * 16
        else:
            cell_size = self.definition.cell_size
            x = cx * cell_size + 8 + _unit(self.seed, source + ':x') * (cell_size - 16)
            z = cz * cell_size + 8 + _unit(self.seed, source + ':z') * (cell_size - 16)
        ident = f'{self.definition.id_prefix}:{source}:g{generation}'
        y = 0.0  # replaced by terrain callback on activation
        yaw = _unit(self.seed, ident + ':yaw') * math.tau
        rng_state = int(_unit(self.seed, ident + ':ai') * (2**32))
        rng_state, choice = self._rand(rng_state)
        choices = self.definition.states
        state = choices[min(len(choices)-1, int(choice*len(choices)))]
        rng_state, duration_roll = self._rand(rng_state)
        duration = 3 + duration_roll*5
        if state in self.definition.special_durations: duration = self.definition.special_durations[state]
        return {'id': ident, 'source': source, 'generation': generation,
                'category': self.definition.category,'faction':self.definition.faction,
                'subcategory': _appearance(self.seed, ident, self.definition),
                'x': x, 'y': y, 'z': z, 'spawn_x':x,'spawn_z':z,'yaw': yaw, 'vx': 0.0, 'vz': 0.0,
                'state': state, 'state_start': 0.0, 'state_until': 0.0,
                'health': self.definition.health, 'rng_state': rng_state, '_calm': None}

    def _records_near(self, players, now, standable, height):
        # Corpses are independent of active generations and remain through loot depletion.
        for ident, corpse in list(self.corpses.items()):
            if now - corpse['dead_at'] >= self.definition.corpse_ttl:
                del self.corpses[ident]
        for player in players:
            cx, cz = math.floor(player['x'] / self.definition.cell_size), math.floor(player['z'] / self.definition.cell_size)
            cell_radius = math.ceil(self.definition.active_radius / self.definition.cell_size)
            for dx in range(-cell_radius, cell_radius+1):
                for dz in range(-cell_radius, cell_radius+1):
                    generated = {}
                    for hen in self._group(cx + dx, cz + dz):
                        generation = self._generation_for(hen['source'], now)
                        if generation is None:
                            continue
                        if generation:
                            hen = self._spawn_record(cx + dx, cz + dz,
                                int(hen['source'].split(':')[1]), generation)
                        generated[hen['source']] = hen
                    # Respawns remain eligible even when this was a small original group.
                    for member in range(max(self.definition.group_max, self.definition.starter_count)):
                        source = f'{cx+dx},{cz+dz}:{member}'
                        generation = self._generation_for(source, now)
                        if generation and source not in generated:
                            generated[source] = self._spawn_record(cx+dx, cz+dz, member, generation)
                    for hen in generated.values():
                        if math.hypot(hen['x'] - player['x'], hen['z'] - player['z']) > self.definition.active_radius:
                            continue
                        if not standable(hen['x'], hen['z']):
                            continue
                        hen['y'] = height(hen['x'], hen['z'])
                        yield hen

    def activate(self, players, now, standable, height):
        """Refresh active population to union of player areas, capped 24/player."""
        desired = {}
        for player in players:
            candidates = list(self._records_near([player], now, standable, height))
            candidates.extend(h for h in self.live.values()
                if math.hypot(h['x']-player['x'],h['z']-player['z'])<=self.definition.active_radius)
            # Force trio near start even where the ordinary cell roll is empty.
            if self.definition.starter_count and math.hypot(player['x'], player['z']) <= self.definition.active_radius:
                for member in range(self.definition.starter_count):
                    source = f'0,0:{member}'
                    generation = self._generation_for(source, now)
                    if generation is None:
                        continue
                    hen = self._spawn_record(0, 0, member, generation)
                    if standable(hen['x'], hen['z']):
                        hen['y'] = height(hen['x'], hen['z'])
                        candidates.append(hen)
            # Generation candidates may refer to an animal that has already
            # moved. Rank and retain its current state, never its spawn point.
            unique = {h['id']: self.live.get(h['id'],h) for h in candidates}
            unique = {ident: h for ident,h in unique.items()
                      if math.hypot(h['x']-player['x'],h['z']-player['z'])<=self.definition.active_radius}
            nearest = sorted(unique.values(), key=lambda h: (h['x']-player['x'])**2 + (h['z']-player['z'])**2)[:self.definition.live_limit]
            for hen in nearest:
                old = self.live.get(hen['id'])
                desired[hen['id']] = old if old else hen
        if players:
            self.live = desired

    def _parse_id(self, ident):
        try:
            parts = ident.split(':')
            if len(parts) != 4 or parts[0] != self.definition.id_prefix or not parts[3].startswith('g'):
                return None, None
            cx,cz=map(int,parts[1].split(','));member=int(parts[2]);generation=int(parts[3][1:])
            if abs(cx)>10000 or abs(cz)>10000 or not 0<=member<max(self.definition.group_max, self.definition.starter_count) or not 0<=generation<=1_000_000_000:
                return None,None
            return f'{cx},{cz}:{member}',generation
        except (ValueError, AttributeError):
            return None, None

    def tick(self, players, dt, now, standable, height):
        corpse_count = len(self.corpses)
        if not players:
            self._prune_corpses(now)
            return len(self.corpses) < corpse_count
        self.activate(players, now, standable, height)
        groups=build_flocks(self.live.values())
        for hen in self.live.values():
            nearest = min(players, key=lambda p: math.hypot(p['x']-hen['x'], p['z']-hen['z']), default=None)
            distance = math.hypot(nearest['x']-hen['x'], nearest['z']-hen['z']) if nearest else math.inf
            behavior = BEHAVIORS.get(self.definition.behavior)
            if behavior is None:
                raise ValueError(f"unknown mob behavior: {self.definition.behavior}")
            hold_action = behavior(self, hen, nearest, distance, now)
            if not hold_action:
                hen['vx'] = hen['vz'] = 0.0
                if hen['state_until'] <= now:
                    hen['rng_state'], roll = self._rand(hen['rng_state'])
                    states = self.definition.states
                    hen['state'] = states[min(len(states)-1,int(roll*len(states)))]
                    hen['rng_state'], duration_roll = self._rand(hen['rng_state'])
                    duration = 3 + duration_roll*5
                    if hen['state'] in self.definition.special_durations:
                        duration = self.definition.special_durations[hen['state']]
                    hen['state_start'], hen['state_until'] = now, now + duration
                animations = self.definition.animations
                if hen['state'] in (animations['walk'], animations.get('fast')):
                    speed = self.definition.fast_speed if hen['state'] == animations.get('fast') else self.definition.walk_speed
                    if now - hen['state_start'] < .05:
                        hen['rng_state'], yaw_roll = self._rand(hen['rng_state'])
                        hen['yaw'] = -math.pi + yaw_roll*math.tau
                    hen['vx'], hen['vz'] = math.sin(hen['yaw'])*speed, math.cos(hen['yaw'])*speed
            if not hold_action:
                group_move=flock_heading(hen,groups.get(flock_key(hen)),(math.sin(hen['yaw']),math.cos(hen['yaw'])),self.definition.flock)
                moving=math.hypot(hen['vx'],hen['vz'])>0
                if group_move and (group_move['needsMove'] or moving):
                    hen['flock_following']=group_move['catchingUp']
                    roles=self.definition.animations
                    if group_move['catchingUp']:hen['state']=roles.get('run',roles['walk'])
                    elif hen['state'] not in (roles['walk'],roles.get('fast')):hen['state']=roles['walk']
                    follow_speed=self.definition.run_speed if group_move['catchingUp'] else self.definition.fast_speed if hen['state']==roles.get('fast') else self.definition.walk_speed
                    hen['vx'],hen['vz']=math.sin(group_move['yaw'])*follow_speed,math.cos(group_move['yaw'])*follow_speed
                else:
                    if hen.get('flock_following'):
                        hen['state']=self.definition.animations['idle']
                        hen['state_start'],hen['state_until']=now,now+3
                    hen['flock_following']=False
            speed=math.hypot(hen['vx'],hen['vz'])
            def random_turn():
                hen['rng_state'],roll=self._rand(hen['rng_state'])
                return roll
            move=steer_mob(hen,dt,speed,math.atan2(hen['vx'],hen['vz']) if speed else hen['yaw'],standable,random_turn)
            if move:
                hen['vx']=(move['x']-hen['x'])/max(dt,.0001)
                hen['vz']=(move['z']-hen['z'])/max(dt,.0001)
                hen['x'],hen['z'],hen['yaw']=move['x'],move['z'],move['yaw']
                hen['y']=height(hen['x'],hen['z'])
            else:
                hen['vx']=hen['vz']=0.0
        self._prune_corpses(now)
        return len(self.corpses) < corpse_count

    def _prune_corpses(self, now):
        for ident in [k for k,v in self.corpses.items() if now-v['dead_at'] >= self.definition.corpse_ttl]:
            del self.corpses[ident]
        if len(self.corpses) > self.definition.corpse_limit:
            oldest = sorted(self.corpses, key=lambda k: self.corpses[k]['dead_at'])[:len(self.corpses)-self.definition.corpse_limit]
            for ident in oldest:
                del self.corpses[ident]

    def views(self, x, z, now, radius=None):
        radius = self.definition.active_radius if radius is None else radius
        rows = []
        for hen in self.live.values():
            if math.hypot(hen['x']-x, hen['z']-z) <= radius:
                rows.append({k: hen[k] for k in ('id','x','y','z','yaw','vx','vz','state','state_start','health','category','faction','subcategory')} | {'type':self.type_id,'flock_following':hen.get('flock_following',False)})
        for ident, corpse in self.corpses.items():
            if now-corpse['dead_at'] < self.definition.corpse_ttl and math.hypot(corpse['x']-x, corpse['z']-z) <= radius:
                rows.append({'id': ident, 'x': corpse['x'], 'y': corpse['y'], 'z': corpse['z'],
                    'type':self.type_id,'health':0,'category':corpse['category'],'faction':corpse['faction'],'subcategory':corpse['subcategory'],
                    'yaw': corpse['yaw'], 'vx': corpse['vx'], 'vz': corpse['vz'], 'state': 'dead',
                    'state_start': corpse['dead_at'], 'dead_at': corpse['dead_at'],
                    'respawn_at': corpse['respawn_at'], 'loot': corpse['loot'].copy()})
        return rows

    def kill(self, ident, now, attacker=None):
        hen = self.live.pop(ident, None)
        if hen is None:
            return None
        if attacker is not None:
            dx,dz=hen['x']-attacker['x'],hen['z']-attacker['z']
            distance=math.hypot(dx,dz)
            if distance>.001:dx,dz=dx/distance,dz/distance
            else:dx,dz=-math.sin(attacker.get('yaw',0)),-math.cos(attacker.get('yaw',0))
            vx,vz=hen['vx']*.3+dx*2,hen['vz']*.3+dz*2
            speed=math.hypot(vx,vz)
            if speed>3:vx,vz=vx*3/speed,vz*3/speed
            hen['vx'],hen['vz']=vx,vz
        corpse = {'id': ident, 'category':hen['category'],'faction':hen['faction'],'subcategory':hen['subcategory'],
                  'x': hen['x'], 'y': hen['y'], 'z': hen['z'], 'yaw': hen['yaw'],
                  'vx': hen['vx'], 'vz': hen['vz'], 'dead_at': now, 'respawn_at': now + self.definition.respawn_delay,
                  'loot': {item: self._rng.randint(bounds[0], bounds[1])
                           for item, bounds in self.definition.loot.items()}}
        self.corpses[ident] = corpse
        source,generation = self._parse_id(ident)
        if source is not None:
            self.sources[source] = {'generation': generation + 1,
                                    'respawn_at': corpse['respawn_at'], 'dead_at': now}
        if len(self.sources) > self.definition.corpse_limit:
            oldest = sorted(self.sources, key=lambda k:self.sources[k].get('dead_at',0))[:len(self.sources)-self.definition.corpse_limit]
            for source in oldest:
                del self.sources[source]
        self._prune_corpses(now)
        return corpse

    def damage(self, ident, amount, now, attacker=None):
        """Apply finite positive damage; preserve the mob until health reaches zero."""
        if not _finite(amount) or amount <= 0:
            return None
        mob = self.live.get(ident)
        if mob is None:
            return None
        mob['health'] = max(0, mob['health'] - amount)
        if mob['health'] > 0:
            return {'alive': True, 'health': mob['health'], 'id': ident}
        corpse = self.kill(ident, now, attacker)
        return {'alive': False, 'health': 0, 'id': ident, 'corpse': corpse} if corpse else None

    def take(self, ident, item, amount=1):
        if item not in self.definition.loot or type(amount) is not int or amount < 1:
            return 0
        corpse = self.corpses.get(ident)
        if not corpse:
            return 0
        taken = min(amount, corpse['loot'].get(item, 0))
        corpse['loot'][item] -= taken
        return taken

    def relation_to(self, target):
        """Faction relation hook; player targets default to the player faction."""
        faction = target.get('faction', 'players') if isinstance(target, dict) else None
        if faction is None:
            return 'neutral'
        if faction == self.definition.faction:
            return 'friendly'
        return 'hostile' if faction in self.definition.target_factions else 'neutral'

    def can_target(self, target):
        return self.relation_to(target) == 'hostile'

    def can_damage_target(self, target):
        """Damage permission hook; not currently called for player combat."""
        return self.can_target(target)


class MobWorld:
    """Coordinator for independently bounded species populations."""
    def __init__(self, seed, definitions, snapshots=None):
        self.seed = int(seed)
        self.populations = {}
        prefixes = set()
        for definition in definitions:
            if definition.type_id in self.populations or definition.id_prefix in prefixes:
                raise ValueError('mob type IDs and ID prefixes must be unique')
            prefixes.add(definition.id_prefix)
            snapshot = (snapshots or {}).get(definition.type_id)
            self.populations[definition.type_id] = MobPopulation(self.seed, definition, snapshot)

    def register(self, definition, snapshot=None):
        if definition.type_id in self.populations or any(p.definition.id_prefix == definition.id_prefix for p in self.populations.values()):
            raise ValueError('mob type IDs and ID prefixes must be unique')
        self.populations[definition.type_id] = MobPopulation(self.seed, definition, snapshot)
        return self.populations[definition.type_id]

    def population_for(self, ident):
        if not isinstance(ident, str):
            return None
        prefix = ident.split(':', 1)[0]
        return next((p for p in self.populations.values() if p.definition.id_prefix == prefix), None)

    def tick(self, players, dt, now, standable, height):
        changed = [p.tick(players, dt, now, standable, height) for p in self.populations.values()]
        return any(changed)

    def views(self, x, z, now):
        return [row for p in self.populations.values() for row in p.views(x, z, now)]

    def save_data(self):
        return {type_id: population.save_data() for type_id, population in sorted(self.populations.items())}

    def target(self, ident):
        population = self.population_for(ident)
        if population is None:
            return None
        if ident in population.live:
            return population, population.live[ident], 'live'
        if ident in population.corpses:
            return population, population.corpses[ident], 'corpse'
        return None
