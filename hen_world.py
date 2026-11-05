"""Backward-compatible chicken population import."""
from mob_world import MobPopulation
from mob_definitions import CHICKEN

# Historical constants remain importable for existing server callers/tests.
CELL_SIZE = CHICKEN.cell_size
CELL_CHANCE = CHICKEN.cell_chance
ACTIVE_PER_PLAYER = CHICKEN.live_limit
ACTIVE_RADIUS = CHICKEN.active_radius
CORPSE_TTL = CHICKEN.corpse_ttl
RESPAWN_DELAY = CHICKEN.respawn_delay
WALK_SPEED = CHICKEN.walk_speed
FAST_SPEED = CHICKEN.fast_speed
FLEE_SPEED = CHICKEN.run_speed
STATES = CHICKEN.states
PECK_STATES = frozenset(CHICKEN.special_durations)
PECK_DURATIONS = CHICKEN.special_durations
MAX_CORPSES = CHICKEN.corpse_limit


class HenWorld(MobPopulation):
    """Legacy API backed by the generic chicken population engine."""
    def __init__(self, seed, corpses=None):
        super().__init__(seed, CHICKEN, corpses)
