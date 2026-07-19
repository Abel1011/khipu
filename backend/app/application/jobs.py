import logging
from datetime import datetime, timezone

from app.application.memory_service import _rekey
from app.domain.decay import next_tier, strength
from app.domain.enums import MemoryType, ScopeLevel, Status, Tier, Visibility

logger = logging.getLogger(__name__)

_ADMIN = "elena"
_DURABLE = {MemoryType.SEMANTIC, MemoryType.PREFERENCE, MemoryType.PROCEDURAL}
_RANK = {ScopeLevel.ORG: 1, ScopeLevel.TEAM: 2, ScopeLevel.USER: 3}


def _all_memories(container):
    return container.memory_repo.list_by_scope(container.org_repo.visible_scope_ids(_ADMIN))


def run_decay(container, now: datetime | None = None) -> dict:
    """Recompute strength, expire past-due facts, and fade weak memories to dormant."""
    now = now or datetime.now(timezone.utc)
    repo = container.memory_repo
    updated = expired = 0
    for m in _all_memories(container):
        s = strength(m.salience, m.type, m.last_accessed_at, m.access_count, now)
        t = next_tier(m.tier, s, authoritative=m.authoritative, pinned=m.pinned)
        # Hard expiry: a time-bound fact past its valid_until fades to dormant.
        just_expired = (
            m.invalid_at is not None and now >= m.invalid_at and m.expired_at is None
            and m.status == Status.ACTIVE and not m.authoritative and not m.pinned
        )
        if just_expired:
            t = Tier.DORMANT
        if abs(s - m.strength) > 1e-6 or t != m.tier or just_expired:
            m.strength, m.tier = s, t
            if just_expired:
                m.expired_at = now
                expired += 1
            repo.patch(m)
            updated += 1
    return {"updated": updated, "expired": expired}


def run_consolidation(container) -> dict:
    """Sleep pass: dedup same-key facts and promote stable working -> consolidated."""
    repo = container.memory_repo
    merged = promoted = 0

    # Same conflict judge cascade uses: a group shares a (scope, key) but may hold
    # genuinely distinct facts; only fold in the ones that are actually the same/update.
    judge = getattr(getattr(container, "memory", None), "_conflict", None)
    if judge is None:
        logger.warning("run_consolidation: no conflict judge; dedup by semantic_key alone "
                       "(distinct same-key facts may be archived).")
    groups: dict[tuple[str, str], list] = {}
    for m in _all_memories(container):
        if m.status == Status.ACTIVE and m.semantic_key:
            groups.setdefault((m.scope.id, m.semantic_key), []).append(m)
    for group in groups.values():
        if len(group) > 1:
            group.sort(key=lambda x: x.valid_at, reverse=True)
            survivor = group[0]
            for old in group[1:]:
                if old.authoritative:  # never archive a lock during dedup
                    continue
                if judge is not None and judge(survivor.content, old.content) == "unrelated":
                    continue  # distinct fact that merely shares a key: keep it
                old.status, old.superseded_by = Status.ARCHIVED, survivor.id
                repo.patch(old)
                merged += 1

    for m in _all_memories(container):
        stable = m.strength >= 0.5 or m.access_count > 0
        if m.status == Status.ACTIVE and m.tier == Tier.WORKING and m.type in _DURABLE and stable:
            m.tier = Tier.CONSOLIDATED
            repo.patch(m)
            promoted += 1
    return {"merged": merged, "promoted": promoted}


def run_cascade(container, memory) -> dict:
    """Confirming an authoritative fact supersedes same-key conflicts: lower scopes
    (org over team over user) and any prior policy at the same scope. A conflict judge
    (when available) skips genuinely unrelated facts that merely share a key so distinct
    knowledge (e.g. a different segment) coexists rather than being archived."""
    if memory is None or not memory.authoritative or not memory.semantic_key:
        return {"invalidated": 0}
    repo = container.memory_repo
    # The conflict judge is the only reason cascade needs the memory service. Resolve
    # it explicitly; if it is missing (e.g. a minimal shim or a job wired without the
    # service) say so loudly instead of silently degrading to key-only archiving,
    # which can archive distinct facts that merely share a semantic_key.
    judge = getattr(getattr(container, "memory", None), "_conflict", None)
    if judge is None:
        logger.warning("run_cascade: no conflict judge available; archiving by "
                       "semantic_key alone (distinct same-key facts may be archived).")
    now = datetime.now(timezone.utc)
    invalidated = 0
    for m in _all_memories(container):
        conflict = (
            m.id != memory.id
            and m.status == Status.ACTIVE
            and m.visibility == Visibility.SHARED  # governance never archives personal/private
            and m.semantic_key == memory.semantic_key
            and (_RANK[m.scope.level] > _RANK[memory.scope.level] or m.scope.id == memory.scope.id)
        )
        if not conflict:
            continue
        if judge is not None and judge(memory.content, m.content) == "unrelated":
            # A distinct fact that merely shares a key: re-key it so the read path
            # (which groups by semantic_key) keeps surfacing it instead of collapsing
            # it into the lock. Mirrors the write path's coexistence rule.
            _rekey(m)
            repo.patch(m)
            continue
        m.status, m.superseded_by = Status.ARCHIVED, memory.id
        m.invalid_at = m.expired_at = now
        repo.patch(m)
        invalidated += 1
    return {"invalidated": invalidated}


def preview_cascade(container, memory) -> list:
    """What confirming `memory` as a lock WOULD supersede: active SHARED same-key facts
    at a lower-or-equal scope. Deterministic and read-only (no LLM, no mutation), and it
    mirrors run_cascade's filters - personal/private facts are never governed, so they
    never appear here. The real cascade is conflict-aware, so this is an upper bound."""
    if memory is None or not memory.semantic_key:
        return []
    return [
        m for m in _all_memories(container)
        if m.id != memory.id
        and m.status == Status.ACTIVE
        and m.visibility == Visibility.SHARED
        and m.semantic_key == memory.semantic_key
        and (_RANK[m.scope.level] > _RANK[memory.scope.level] or m.scope.id == memory.scope.id)
    ]
