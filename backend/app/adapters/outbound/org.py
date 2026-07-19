from app.domain.enums import ScopeLevel
from app.domain.models import Scope
from app.seed import ORG_ID, PEOPLE, TEAMS


class SeedOrgRepo:
    """In-memory organization structure (Lumina sample org)."""

    def __init__(self):
        self._people = {p["id"]: p for p in PEOPLE}

    def is_admin(self, profile_id: str) -> bool:
        return bool(self._people.get(profile_id, {}).get("admin"))

    def teams_of(self, profile_id: str) -> list[str]:
        team = self._people.get(profile_id, {}).get("team")
        return [team] if team else []

    def can_govern(self, profile_id: str, scope: Scope) -> bool:
        """Who may lock/pin a memory at this scope: an org admin (anywhere),
        the lead of a team (team scope), or the owner (their own user scope)."""
        if self.is_admin(profile_id):
            return True
        person = self._people.get(profile_id, {})
        if scope.level == ScopeLevel.TEAM:
            team_id = scope.id.split(".", 1)[-1]
            return person.get("team") == team_id and bool(person.get("lead"))
        if scope.level == ScopeLevel.USER:
            return scope.id == f"{ORG_ID}.{profile_id}"
        return False  # org scope → admin only

    def visible_scope_ids(self, profile_id: str) -> list[str]:
        if self.is_admin(profile_id):
            ids = [ORG_ID]
            ids += [f"{ORG_ID}.{t['id']}" for t in TEAMS]
            ids += [f"{ORG_ID}.{p['id']}" for p in PEOPLE]
            return ids
        scopes = [ORG_ID, f"{ORG_ID}.{profile_id}"]
        scopes += [f"{ORG_ID}.{t}" for t in self.teams_of(profile_id)]
        return scopes
