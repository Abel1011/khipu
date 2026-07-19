import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, Field

from app.domain.enums import MemoryType, ScopeLevel, SourceType, Status, Tier, Visibility


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Scope(BaseModel):
    level: ScopeLevel
    id: str  # dotted path, e.g. "lumina.ana" | "lumina.sales" | "lumina"


class Source(BaseModel):
    type: SourceType
    ref: str | None = None


class Memory(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    content: str
    semantic_key: str | None = None

    # Axis 1 - scope (hierarchy + isolation)
    scope: Scope
    authoritative: bool = False  # locked policy: cannot be overridden by lower levels
    lock_suggested: bool = False  # AI flagged as a lock candidate; awaits human confirmation

    # Axis 2 - tier (lifecycle) + nature
    tier: Tier = Tier.WORKING
    type: MemoryType = MemoryType.EPISODIC

    # Axis 3 - visibility (confidentiality)
    visibility: Visibility = Visibility.PERSONAL
    owner_id: str | None = None

    # Decay / reinforcement
    salience: float = 0.6
    confidence: float = 0.8
    strength: float = 0.6
    pinned: bool = False
    last_accessed_at: datetime = Field(default_factory=_now)
    access_count: int = 0

    # Bi-temporal (deterministic freshness)
    valid_at: datetime = Field(default_factory=_now)
    invalid_at: datetime | None = None
    created_at: datetime = Field(default_factory=_now)
    expired_at: datetime | None = None
    supersedes: str | None = None
    superseded_by: str | None = None

    # Provenance + governance
    source: Source | None = None
    created_by_id: str | None = None
    version: int = 1
    status: Status = Status.ACTIVE
    pii: bool = False
    consent: bool = True


class AuditEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    memory_id: str
    actor_id: str
    action: str  # create | edit | forget | pin | authoritative | promote-* | visibility |
    # rescope | dismiss-lock | pii-quarantine | reactivate | injection-flagged | source-capture
    detail: str | None = None
    at: datetime = Field(default_factory=_now)


class HistoryEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    memory_id: str
    version: int
    content: str
    actor_id: str
    at: datetime = Field(default_factory=_now)


class PromotionRequest(BaseModel):
    """A pending request to widen a memory's scope, awaiting the target's approver."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    memory_id: str
    content_preview: str
    from_scope_id: str
    to_level: str  # "team" | "org"
    to_scope_id: str
    requested_by: str
    status: str = "pending"  # pending | approved | rejected | redundant | failed
    created_at: datetime = Field(default_factory=_now)
    decided_by: str | None = None
    decided_at: datetime | None = None
