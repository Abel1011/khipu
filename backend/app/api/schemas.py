from pydantic import BaseModel

from app.domain.models import Memory


class ChatRequest(BaseModel):
    query: str
    profile_id: str


class EditRequest(BaseModel):
    content: str
    actor_id: str
    semantic_key: str | None = None  # re-scope to its own topic (keep-both resolution)


class FlagRequest(BaseModel):
    actor_id: str
    value: bool = True


class VisibilityRequest(BaseModel):
    actor_id: str
    visibility: str


class ConversationSave(BaseModel):
    owner: str
    title: str
    msgs: list[dict]


class SourceIngestRequest(BaseModel):
    actor_id: str
    item_id: str  # capture a specific feed item to memory
    scope: str | None = None  # override target scope: user | team | org
    team: str | None = None  # which team (an admin routing to a specific team)


class CaptureRequest(BaseModel):
    text: str


class SaveRequest(BaseModel):
    content: str
    actor_id: str
    semantic_key: str | None = None
    mtype: str | None = None
    propose_to: str | None = None  # "team" | "org": also file a promotion request
    team: str | None = None  # which team (an admin routing to a specific team)


class PromoteRequest(BaseModel):
    actor_id: str
    to_level: str  # "team" | "org"


class DecideRequest(BaseModel):
    actor_id: str
    approve: bool


class RestoreRequest(BaseModel):
    actor_id: str
    version: int


# A sealed (owner-only) memory reveals nothing but that it exists and where it
# hangs. Everything else is stripped server-side so the client never receives it
# - the metadata is confidential too, not just the text.
_SEALED_NEUTRAL = {
    "content": None, "semantic_key": None, "owner_id": None, "created_by_id": None,
    "source": None, "type": "episodic", "tier": "working", "salience": 0.0,
    "confidence": 0.0, "strength": 0.0, "pinned": False, "authoritative": False,
    "lock_suggested": False, "pii": False, "consent": True, "version": 1,
    "access_count": 0, "invalid_at": None, "valid_at": None, "created_at": None,
    "expired_at": None, "last_accessed_at": None, "supersedes": None, "superseded_by": None,
}


def view(memory: Memory, state: str) -> dict:
    """Serialize a memory for a viewer. When sealed (private, not the owner), strip
    the content AND all descriptive metadata - keep only id, scope, visibility."""
    data = memory.model_dump(mode="json")
    data["state"] = state
    if state == "sealed":
        data.update(_SEALED_NEUTRAL)
    return data
