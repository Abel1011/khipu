from app.domain.ports import OrgRepo


class IsolationError(PermissionError):
    pass


def require_visible(scope_id: str, requester_id: str, org: OrgRepo) -> None:
    """Fail if a scope is outside the requester's jurisdiction."""
    if scope_id not in set(org.visible_scope_ids(requester_id)):
        raise IsolationError(f"scope '{scope_id}' is not visible to '{requester_id}'")
