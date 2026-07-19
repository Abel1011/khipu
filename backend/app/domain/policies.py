from app.domain.enums import Tier, Visibility
from app.domain.models import Memory

VisibilityState = str  # "full" | "hidden"


def visibility_state(
    m: Memory, *, profile_id: str, is_admin: bool, visible_scope_ids: set[str]
) -> VisibilityState:
    """How a viewer perceives a memory. A private memory is owner-only: everyone
    else - admins included - gets `hidden`, so they never see it at all (not even a
    placeholder). You cannot perceive a memory you have no access to."""
    if m.visibility == Visibility.PRIVATE:
        return "full" if m.owner_id == profile_id else "hidden"
    return "full" if m.scope.id in visible_scope_ids else "hidden"


def can_promote(m: Memory) -> bool:
    """Private or PII memories can never be promoted to team/org."""
    return m.visibility != Visibility.PRIVATE and not m.pii


def usable_in_answer(m: Memory, *, requester_id: str, include_dormant: bool = False) -> bool:
    """What may ground an answer: consented, not expired, and private only for its owner.
    Dormant memories are a cold archive - out of normal recall; they only come back
    through reactivation on a strong retrieval cue (see MemoryService)."""
    if not m.consent:  # the owner withdrew consent to use this memory in answers
        return False
    if m.expired_at is not None:  # time-expired facts are no longer current
        return False
    if m.tier == Tier.DORMANT and not include_dormant:
        return False
    if m.visibility == Visibility.PRIVATE:
        return m.owner_id == requester_id
    return True
