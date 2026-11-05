"""Data definitions for authoritative server-side wildlife populations."""
from dataclasses import dataclass, field
import math


@dataclass(frozen=True)
class MobDefinition:
    type_id: str
    id_prefix: str
    category: str = 'wildlife'
    subcategories: tuple = ()
    faction: str = 'wildlife'
    target_factions: tuple = ()
    health: int = 1
    cell_size: int = 96
    cell_chance: float = .25
    group_min: int = 1
    group_max: int = 3
    starter_count: int = 0
    active_radius: float = 120.0
    live_limit: int = 24
    corpse_limit: int = 10000
    corpse_ttl: float = 3600.0
    respawn_delay: float = 2880.0
    walk_speed: float = .34
    fast_speed: float = 1.17
    run_speed: float = 4.5
    flock: dict = field(default_factory=dict)
    behavior: str = 'passive'
    notice_radius: float = 6.0
    safe_radius: float = 10.0
    calm_seconds: float = 3.0
    states: tuple = ('Idle', 'Walk')
    animations: dict = field(default_factory=lambda: {'idle':'Idle','walk':'Walk','fast':'Walk_Fast','run':'Run','rest':'Sit','forage':'Peck'})
    loot: dict = field(default_factory=dict)
    special_durations: dict = field(default_factory=dict)

    def __post_init__(self):
        if not self.type_id or not self.id_prefix or ':' in self.id_prefix:
            raise ValueError('mob type and ID prefix must be non-empty and prefix cannot contain colon')
        if type(self.health) is not int or not 1 <= self.health <= 100:
            raise ValueError('mob max health must be an integer from 1 to 100')
        if (type(self.cell_size) is not int or self.cell_size < 16
            or not math.isfinite(self.cell_chance) or not 0 <= self.cell_chance <= 1):
            raise ValueError('invalid mob spawn cell')
        if (type(self.group_min) is not int or type(self.group_max) is not int or type(self.starter_count) is not int
            or self.group_min < 1 or self.group_max < self.group_min or self.starter_count < 0):
            raise ValueError('invalid mob group size')
        if (type(self.live_limit) is not int or type(self.corpse_limit) is not int or self.live_limit < 1
            or self.live_limit > 256 or self.corpse_limit < 1 or self.corpse_limit > 10000
            or self.group_max > 100 or self.starter_count > 100
            or not math.isfinite(self.active_radius) or self.active_radius <= 0
            or not math.isfinite(self.corpse_ttl) or self.corpse_ttl <= 0
            or not math.isfinite(self.respawn_delay) or self.respawn_delay <= 0):
            raise ValueError('invalid mob population bounds')
        if (not math.isfinite(self.notice_radius) or self.notice_radius <= 0
            or not math.isfinite(self.safe_radius) or self.safe_radius < self.notice_radius
            or not math.isfinite(self.calm_seconds) or self.calm_seconds < 0):
            raise ValueError('invalid mob AI radii or calm duration')
        if self.flock and (any(not isinstance(self.flock.get(k),(int,float)) or not math.isfinite(self.flock[k]) for k in ('radius','catchUpRadius','separation','cohesion')) or self.flock['radius']<=0 or self.flock['catchUpRadius']<=self.flock['radius'] or self.flock['separation']<=0 or not 0<=self.flock['cohesion']<=1):
            raise ValueError('invalid flock settings')
        if (not self.states or 'idle' not in self.animations or 'walk' not in self.animations
            or any(state not in self.states for state in self.animations.values())):
            raise ValueError('animation roles must reference declared states')
        if any(not math.isfinite(value) or value < 0 for value in
               (self.walk_speed,self.fast_speed,self.run_speed)):
            raise ValueError('mob speeds must be finite and non-negative')
        if any(not isinstance(state,str) or not math.isfinite(duration) or duration <= 0
               for state,duration in self.special_durations.items()):
            raise ValueError('mob action durations must be positive and finite')
        for item, amount_range in self.loot.items():
            if (not isinstance(item, str) or not isinstance(amount_range, tuple) or len(amount_range) != 2
                or any(type(value) is not int for value in amount_range)
                or not 0 <= amount_range[0] <= amount_range[1] <= 10):
                raise ValueError('loot ranges must be integer ranges within item stack cap 10')


CHICKEN = MobDefinition(
    type_id='chicken', id_prefix='h', category='chicken', faction='wildlife',
    subcategories=('russet', 'white', 'black', 'golden', 'speckled'),
    health=1, cell_size=96, cell_chance=.25,
    group_min=1, group_max=3, starter_count=3, active_radius=120.0,
    live_limit=24, corpse_limit=10000, corpse_ttl=3600.0, respawn_delay=2880.0,
    walk_speed=.34, fast_speed=1.17, run_speed=3.6, behavior='wary',
    flock={'radius':6,'catchUpRadius':12,'separation':1,'cohesion':.7},
    states=('Idle', 'Walk', 'Walk_Fast', 'Run', 'Peck_1', 'Peck_2', 'Peck', 'Sit'),
    loot={'chicken_meat': (1, 3), 'feather': (1, 5)},
    special_durations={'Peck_1': 1.583, 'Peck_2': 2.167, 'Peck': 3.0},
)


# A non-gameplay species used to establish that the server engine is reusable.
# It can be registered by a caller without changing the chicken contract.
PASSIVE_TEST_MOB = MobDefinition(
    type_id='forest_spirit', id_prefix='m_forest_spirit', category='test', health=3,
    behavior='passive', states=('Idle', 'Walk'),
    animations={'idle':'Idle','walk':'Walk'},
    loot={'branch': (1, 2), 'stone': (1, 1)},
)


DEFINITIONS = {CHICKEN.type_id: CHICKEN}


def register_definition(definition):
    """Register an enabled species; World validates its loot against item caps."""
    existing = DEFINITIONS.get(definition.type_id)
    if existing and existing != definition:
        raise ValueError(f"mob definition already registered: {definition.type_id}")
    if any(item.id_prefix == definition.id_prefix and item.type_id != definition.type_id
           for item in DEFINITIONS.values()):
        raise ValueError(f"mob ID prefix already registered: {definition.id_prefix}")
    DEFINITIONS[definition.type_id] = definition
    return definition
