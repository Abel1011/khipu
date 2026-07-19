from datetime import datetime, timezone

from app.domain.enums import ScopeLevel, Visibility
from app.domain.models import AuditEntry, HistoryEntry, Memory, PromotionRequest, Scope
from app.domain.policies import can_promote, visibility_state
from app.guards.pii import detect_pii
from app.seed import ORG_ID

_RANK = {ScopeLevel.ORG: 1, ScopeLevel.TEAM: 2, ScopeLevel.USER: 3}


class GovernanceError(PermissionError):
    pass


class GovernanceService:
    def __init__(self, memory_repo, audit_repo, org_repo, history_repo, promotion_repo, embedder):
        self.repo = memory_repo
        self.audit = audit_repo
        self.org = org_repo
        self.history = history_repo
        self.promotions = promotion_repo
        self.embedder = embedder

    def list_memories(self, requester_id: str) -> list[tuple[Memory, str]]:
        scope_ids = self.org.visible_scope_ids(requester_id)
        is_admin = self.org.is_admin(requester_id)
        out: list[tuple[Memory, str]] = []
        for m in self.repo.list_by_scope(scope_ids):
            state = visibility_state(
                m, profile_id=requester_id, is_admin=is_admin, visible_scope_ids=set(scope_ids)
            )
            if state != "hidden":
                out.append((m, state))
        return out

    def private_held(self, requester_id: str) -> int:
        """How many private memories the system holds in the viewer's jurisdiction
        that they cannot access - an anonymous oversight count, never the items."""
        scope_ids = self.org.visible_scope_ids(requester_id)
        return sum(
            1 for m in self.repo.list_by_scope(scope_ids)
            if m.visibility == Visibility.PRIVATE and m.owner_id != requester_id
        )

    def _require_full(self, memory_id: str, requester_id: str) -> Memory:
        m = self.repo.get(memory_id)
        if not m:
            raise GovernanceError("memory not found")
        scope_ids = self.org.visible_scope_ids(requester_id)
        state = visibility_state(
            m, profile_id=requester_id, is_admin=self.org.is_admin(requester_id),
            visible_scope_ids=set(scope_ids),
        )
        if state != "full":
            raise GovernanceError("memory is not accessible to this user")
        return m

    def _require_personal_owner(self, m: Memory, actor_id: str) -> None:
        """Sovereignty: a personal (user-scope) memory can only be mutated by its owner
        - not even an admin can touch someone else's personal memory."""
        if m.scope.level == ScopeLevel.USER and m.owner_id and m.owner_id != actor_id:
            raise GovernanceError("only the owner can change a personal memory")

    def _require_governor(self, m: Memory, actor_id: str) -> None:
        """Mutating a memory (edit/forget/visibility/pin/lock) is a governance act:
        an admin or the scope's lead for org/team, and only the owner for personal."""
        if not self.org.can_govern(actor_id, m.scope):
            raise GovernanceError("only an admin, the scope lead, or the owner can change this memory")
        self._require_personal_owner(m, actor_id)

    def _revalidate_content(self, m: Memory, content: str) -> bool:
        """Content changes must keep the PII invariant: shared memory never holds
        sensitive data (mirrors the write-path quarantine), and the pii flag is
        recomputed so promotion checks never rely on stale metadata."""
        pii = detect_pii(content)
        if pii and m.visibility == Visibility.SHARED:
            raise GovernanceError(
                "shared memories cannot contain sensitive data - remove it or keep it personal"
            )
        return pii

    def edit(self, memory_id: str, content: str, actor_id: str,
             semantic_key: str | None = None) -> Memory:
        m = self._require_full(memory_id, actor_id)
        self._require_governor(m, actor_id)
        pii = self._revalidate_content(m, content)
        self.history.append(
            HistoryEntry(memory_id=m.id, version=m.version, content=m.content, actor_id=actor_id)
        )
        m.content, m.version, m.pii = content, m.version + 1, pii
        rekeyed = semantic_key is not None and semantic_key != m.semantic_key
        if rekeyed:
            # Re-scoped to its own topic: no longer a conflict candidate for the old key.
            m.semantic_key, m.lock_suggested = semantic_key, False
        # Re-embed so the vector index stays in sync with the new text.
        self.repo.upsert(m, self.embedder.embed([content])[0])
        self._audit(memory_id, actor_id, "rescope" if rekeyed else "edit")
        return m

    def dismiss_suggestion(self, memory_id: str, actor_id: str) -> Memory:
        """Clear an AI-suggested lock without locking anything (the suggestion was wrong)."""
        m = self._require_full(memory_id, actor_id)
        self._require_governor(m, actor_id)
        if m.lock_suggested:
            m.lock_suggested = False
            self.repo.patch(m)
            self._audit(memory_id, actor_id, "dismiss-lock")
        return m

    def history_of(self, memory_id: str, requester_id: str) -> list[HistoryEntry]:
        self._require_full(memory_id, requester_id)  # no peeking at private history
        return self.history.list(memory_id)

    def restore(self, memory_id: str, version: int, actor_id: str) -> Memory:
        """Revert a memory's content to a past version (itself recorded as a new version)."""
        m = self._require_full(memory_id, actor_id)
        self._require_governor(m, actor_id)
        entry = next((h for h in self.history.list(memory_id) if h.version == version), None)
        if entry is None:
            raise GovernanceError("version not found")
        pii = self._revalidate_content(m, entry.content)  # restoring can re-introduce PII
        self.history.append(
            HistoryEntry(memory_id=m.id, version=m.version, content=m.content, actor_id=actor_id)
        )
        m.content, m.version, m.pii = entry.content, m.version + 1, pii
        self.repo.upsert(m, self.embedder.embed([m.content])[0])  # re-embed the restored text
        self._audit(memory_id, actor_id, "restore", f"v{version}")
        return m

    def forget(self, memory_id: str, actor_id: str) -> None:
        m = self._require_full(memory_id, actor_id)
        self._require_governor(m, actor_id)
        self.repo.delete(memory_id)
        self._audit(memory_id, actor_id, "forget")

    def set_consent(self, memory_id: str, actor_id: str, value: bool) -> Memory:
        """Owner controls whether their personal memory may be used to ground answers
        (retained either way - this is usage consent, not deletion)."""
        m = self._require_full(memory_id, actor_id)
        if m.scope.level != ScopeLevel.USER:
            raise GovernanceError("consent applies to personal memories")
        self._require_governor(m, actor_id)  # owner-only for user scope
        m.consent = value
        self.repo.patch(m)
        self._audit(memory_id, actor_id, "consent", "granted" if value else "withdrawn")
        return m

    def set_pin(self, memory_id: str, actor_id: str, value: bool) -> Memory:
        m = self._require_full(memory_id, actor_id)
        self._require_governor(m, actor_id)
        m.pinned = value
        self.repo.patch(m)
        self._audit(memory_id, actor_id, "pin")
        return m

    def set_authoritative(self, memory_id: str, actor_id: str, value: bool) -> Memory:
        m = self._require_full(memory_id, actor_id)
        if value and m.scope.level == ScopeLevel.USER:
            # Locks are a team/org governance mechanism - not for personal memories.
            raise GovernanceError("only team or organization memories can be locked")
        self._require_governor(m, actor_id)
        m.authoritative = value
        if value:
            m.lock_suggested = False  # confirmed → clear the pending AI suggestion
        self.repo.patch(m)
        self._audit(memory_id, actor_id, "authoritative")
        return m

    def set_visibility(self, memory_id: str, actor_id: str, visibility: Visibility) -> Memory:
        m = self._require_full(memory_id, actor_id)
        self._require_governor(m, actor_id)
        if m.scope.level != ScopeLevel.USER and visibility != Visibility.SHARED:
            # Team/org knowledge must stay shared - personal/private only fit user scope.
            raise GovernanceError("team and organization memories must stay shared")
        m.visibility = visibility
        if visibility == Visibility.PRIVATE and not m.owner_id:
            m.owner_id = actor_id  # never orphan a memory by making it owner-less private
        self.repo.patch(m)
        self._audit(memory_id, actor_id, "visibility", visibility.value)
        return m

    # ---- promotion approval queue ----
    def _promotion_target(self, m: Memory, to_level: str) -> Scope:
        if to_level == "org":
            return Scope(level=ScopeLevel.ORG, id=ORG_ID)
        if to_level == "team":
            teams = self.org.teams_of(m.owner_id) if m.owner_id else []
            if not teams:
                raise GovernanceError("no team to promote this memory into")
            return Scope(level=ScopeLevel.TEAM, id=f"{ORG_ID}.{teams[0]}")
        raise GovernanceError("invalid target level")

    def request_promotion(self, memory_id: str, actor_id: str, to_level: str) -> PromotionRequest:
        m = self._require_full(memory_id, actor_id)
        if not can_promote(m):
            raise GovernanceError("private or PII memories cannot be promoted")
        self._require_personal_owner(m, actor_id)  # an admin can't share your personal memory for you
        target = self._promotion_target(m, to_level)
        if _RANK[target.level] >= _RANK[m.scope.level]:
            raise GovernanceError("promotion must widen the scope")
        req = PromotionRequest(
            memory_id=m.id, content_preview=m.content, from_scope_id=m.scope.id,
            to_level=target.level.value, to_scope_id=target.id, requested_by=actor_id,
        )
        self.promotions.add(req)
        self._audit(m.id, actor_id, "promote-request", f"-> {target.id}")
        return req

    def list_promotions(self, requester_id: str) -> list[PromotionRequest]:
        """Pending requests the viewer is allowed to approve (governs the target)."""
        return [
            r for r in self.promotions.list_pending()
            if self.org.can_govern(requester_id, Scope(level=ScopeLevel(r.to_level), id=r.to_scope_id))
        ]

    def decide_promotion(self, request_id: str, actor_id: str, approve: bool) -> PromotionRequest:
        req = self.promotions.get(request_id)
        if not req or req.status != "pending":
            raise GovernanceError("promotion request not found")
        target = Scope(level=ScopeLevel(req.to_level), id=req.to_scope_id)
        if not self.org.can_govern(actor_id, target):
            raise GovernanceError("only the target scope's admin or lead can decide this")
        status = "rejected"
        if approve:
            m = self.repo.get(req.memory_id)
            if m is None:  # forgotten between proposing and approval - nothing to promote
                status = "failed"
                self._audit(req.memory_id, actor_id, "promote-failed", "memory no longer exists")
            elif not can_promote(m):  # may have become private/PII since the request
                raise GovernanceError("memory is no longer promotable (private or PII)")
            # Claim the originating source item (attributed to the PROPOSER) BEFORE
            # promoting. If a prior proposal for the same item was already shared, this
            # one is redundant - skip it so we never create a duplicate shared memory.
            elif m.source and m.source.ref and not self.audit.try_capture(m.source.ref, req.requested_by):
                status = "redundant"
                self._audit(req.memory_id, actor_id, "promote-redundant", "source already shared")
            else:
                m.scope, m.visibility, m.version = target, Visibility.SHARED, m.version + 1
                self.repo.patch(m)
                status = "approved"
                self._audit(req.memory_id, actor_id, "promote-approved", f"-> {target.id}")
        else:
            self._audit(req.memory_id, actor_id, "promote-rejected")
        req.status = status
        req.decided_by, req.decided_at = actor_id, datetime.now(timezone.utc)
        self.promotions.update(req)
        return req

    def audit_list(self, requester_id: str, limit: int = 100) -> list[AuditEntry]:
        """Admins see the full trail; everyone else only their own actions (filtered
        before the limit, so a user never loses their events behind others')."""
        if self.org.is_admin(requester_id):
            return self.audit.list(limit)
        return self.audit.list(limit, actor_id=requester_id)

    def _audit(self, memory_id: str, actor_id: str, action: str, detail: str | None = None) -> None:
        self.audit.append(
            AuditEntry(memory_id=memory_id, actor_id=actor_id, action=action, detail=detail)
        )
