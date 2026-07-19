"""Adversarial isolation/privacy checks. Target: leak_rate == 0."""

from app.domain.enums import Visibility
from app.domain.policies import visibility_state
from app.seed import PEOPLE

_USERS = [p["id"] for p in PEOPLE]  # every person is a potential attacker


def _forbidden(memory, uid: str, visible: set[str]) -> bool:
    if memory.visibility == Visibility.PRIVATE and memory.owner_id != uid:
        return True  # private is owner-only, even for admins
    return memory.scope.id not in visible


def _retrieval_exposed(container, memory, uid: str) -> bool:
    """Probe the real retrieval path with the memory's own text.

    This catches scope-filter regressions in the search pipeline instead of only
    re-checking the same visibility predicates used elsewhere.
    """
    svc = getattr(container, "memory", None)
    if svc is None:
        return False
    try:
        resolved, _ = svc._gather(memory.content, uid)
    except Exception:
        return False
    return any(r.memory.id == memory.id for r in resolved)


def run_redteam(container) -> dict:
    org, repo = container.org_repo, container.memory_repo
    all_mem = repo.list_by_scope(org.visible_scope_ids("elena"))  # admin sees every scope

    checks = leaks = 0
    details: list[dict] = []
    for uid in _USERS:
        visible = set(org.visible_scope_ids(uid))
        is_admin = org.is_admin(uid)
        for m in all_mem:
            if not _forbidden(m, uid, visible):
                continue
            checks += 1
            retrieved = _retrieval_exposed(container, m, uid)
            exposed = visibility_state(
                m, profile_id=uid, is_admin=is_admin, visible_scope_ids=visible
            ) == "full"
            if retrieved or exposed:
                leaks += 1
                details.append(
                    {"attacker": uid, "memory_id": m.id, "retrieved": retrieved, "exposed": exposed}
                )
    return {
        "checks": checks,
        "leaks": leaks,
        "leak_rate": (leaks / checks) if checks else 0.0,
        "details": details,
    }
