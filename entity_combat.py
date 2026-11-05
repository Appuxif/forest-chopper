"""Server-side entity relation and damage policy shared by combat adapters."""
import math


def entity_relation(source, target):
    if source is target:
        return 'self'
    if not isinstance(source, dict) or not isinstance(target, dict):
        return 'neutral'
    source_id, target_id = source.get('id'), target.get('id')
    if source_id is not None and source_id == target_id:
        return 'self'
    source_faction = source.get('faction', 'players')
    target_faction = target.get('faction', 'players')
    if source_faction == target_faction:
        return 'friendly'
    return 'neutral'


def can_damage_entity(source, target, amount):
    """Neutral entities are attackable; self and same-faction hits are rejected.

    This policy does not enable player-vs-player combat: no server gameplay path
    currently submits another player as a damage target.
    """
    if (not isinstance(amount, (int, float)) or isinstance(amount, bool)
        or not math.isfinite(amount) or amount <= 0):
        return False
    if not isinstance(target, dict) or target.get('dead') or target.get('health', 1) <= 0:
        return False
    return entity_relation(source, target) not in ('self', 'friendly')
