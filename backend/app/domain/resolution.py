from dataclasses import dataclass

from app.domain.enums import ScopeLevel
from app.domain.models import Memory

# More specific = higher rank (user overrides team overrides org for defaults).
_SPECIFICITY = {ScopeLevel.USER: 3, ScopeLevel.TEAM: 2, ScopeLevel.ORG: 1}


@dataclass
class ResolvedFact:
    memory: Memory
    superseded: list[Memory]
    reason: str  # unique | authoritative-lock | most-specific


def resolve(candidates: list[Memory]) -> list[ResolvedFact]:
    """Resolve competing memories by precedence.

    1) An authoritative (locked) fact wins and cannot be overridden; the
       highest-authority level (org over team) prevails.
    2) Otherwise the most specific scope wins (user > team > org).
    3) Ties are broken deterministically by bi-temporal recency (valid_at).
    Unique facts (no shared semantic_key) pass through untouched.
    """
    groups: dict[str, list[Memory]] = {}
    for m in candidates:
        groups.setdefault(m.semantic_key or m.id, []).append(m)

    out: list[ResolvedFact] = []
    for group in groups.values():
        if len(group) == 1:
            out.append(ResolvedFact(group[0], [], "unique"))
            continue
        winner, reason = _pick(group)
        out.append(ResolvedFact(winner, [m for m in group if m.id != winner.id], reason))
    return out


def _pick(group: list[Memory]) -> tuple[Memory, str]:
    locked = [m for m in group if m.authoritative]
    if locked:
        # org lock (specificity 1) outranks team lock; newest breaks ties.
        locked.sort(key=lambda m: (_SPECIFICITY[m.scope.level], -m.valid_at.timestamp()))
        return locked[0], "authoritative-lock"
    ordered = sorted(group, key=lambda m: (-_SPECIFICITY[m.scope.level], -m.valid_at.timestamp()))
    return ordered[0], "most-specific"
