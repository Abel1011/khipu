import math
from datetime import datetime, timezone

from app.domain.enums import MemoryType, Tier

BASE_HALF_LIFE_DAYS = {
    MemoryType.PREFERENCE: 180,
    MemoryType.SEMANTIC: 90,
    MemoryType.EPISODIC: 14,
    MemoryType.PROCEDURAL: 365,
}
REINFORCE_K = 0.5
ARCHIVE_THRESHOLD = 0.3


def strength(
    salience: float,
    mem_type: MemoryType,
    last_accessed_at: datetime,
    access_count: int,
    now: datetime | None = None,
) -> float:
    """Forgetting-curve strength, boosted by reinforcement (spaced repetition)."""
    now = now or datetime.now(timezone.utc)
    dt_days = max(0.0, (now - last_accessed_at).total_seconds() / 86400)
    half_life = BASE_HALF_LIFE_DAYS[mem_type] * (1 + REINFORCE_K * math.log1p(access_count))
    return round(salience * math.exp(-dt_days / half_life), 4)


def next_tier(tier: Tier, strength_value: float, *, authoritative: bool, pinned: bool) -> Tier:
    """Working memories fade to dormant once weak; locked/pinned never fade."""
    if authoritative or pinned:
        return tier
    if tier == Tier.WORKING and strength_value < ARCHIVE_THRESHOLD:
        return Tier.DORMANT
    return tier
