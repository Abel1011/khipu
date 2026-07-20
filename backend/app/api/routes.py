import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.api.schemas import (
    CaptureRequest,
    ChatRequest,
    ConversationSave,
    DecideRequest,
    EditRequest,
    FlagRequest,
    PromoteRequest,
    RestoreRequest,
    SaveRequest,
    SourceIngestRequest,
    VisibilityRequest,
    view,
)
from app.application.governance_service import GovernanceError
from app.application.memory_service import _as_type
from app.application.redteam import run_redteam
from app.container import get_container
from app.domain.enums import ScopeLevel, SourceType, Visibility
from app.domain.models import Scope, Source
from app.seed import ORG_ID, PEOPLE, TEAMS

router = APIRouter()


@router.get("/health")
def health():
    c = get_container()
    memory = type(c.memory_repo).__name__
    audit = type(c.audit_repo).__name__
    # Surface silent degradation: are we on the real stores or the in-memory fallback?
    return {
        "ok": True,
        "vector_store": memory,
        "sql_store": audit,
        "persistent": "InMemory" not in memory and "InMemory" not in audit,
        "memories": c.memory_repo.count(),
    }


@router.get("/org/tree")
def org_tree():
    return {"org": ORG_ID, "teams": TEAMS, "people": PEOPLE}


@router.post("/chat")
def chat(req: ChatRequest):
    res = get_container().memory.answer(req.query, req.profile_id)
    return {"text": res.text, "citations": [c.__dict__ for c in res.citations], "mode": res.mode}


@router.post("/chat/stream")
def chat_stream(req: ChatRequest):
    def events():
        for ev in get_container().memory.answer_stream(req.query, req.profile_id):
            yield json.dumps(ev) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")


@router.post("/chat/capture")
def chat_capture(req: CaptureRequest):
    """Detect facts in the message worth remembering - the user confirms before saving."""
    return {"candidates": get_container().memory.capture([{"role": "user", "content": req.text}])}


def _share_target(c, actor_id: str, level: str, team: str | None = None) -> Scope | None:
    from app.seed import ORG_ID

    if level == "org":
        return Scope(level=ScopeLevel.ORG, id=ORG_ID)
    # An explicit team (an admin choosing one) wins; otherwise use the actor's own team.
    team_id = team or next(iter(c.org_repo.teams_of(actor_id)), None)
    return Scope(level=ScopeLevel.TEAM, id=f"{ORG_ID}.{team_id}") if team_id else None


@router.post("/memory/save")
def save_memory(req: SaveRequest):
    from app.seed import ORG_ID

    c = get_container()
    src = Source(type=SourceType.CHAT)
    mtype = _as_type(req.mtype)
    propose = req.propose_to if req.propose_to in ("team", "org") else None

    # Governor sharing team/org: write straight to that scope (mirrors the Sources flow).
    if propose:
        target = _share_target(c, req.actor_id, propose, req.team)
        if target and c.org_repo.can_govern(req.actor_id, target):
            mem, superseded = c.memory.save_fact(
                req.content, req.actor_id, target, semantic_key=req.semantic_key,
                mtype=mtype, source=src)
            return {
                "content": mem.content, "level": mem.scope.level.value,
                "superseded": [s.content for s in superseded],
                "proposed_to": None, "ingested_to": propose,
            }

    # Otherwise it lands personal; team/org facts go up as a proposal for approval.
    scope = Scope(level=ScopeLevel.USER, id=f"{ORG_ID}.{req.actor_id}")
    mem, superseded = c.memory.save_fact(
        req.content, req.actor_id, scope, semantic_key=req.semantic_key,
        mtype=mtype, source=src)
    proposed_to = None
    if propose:
        try:
            promo = c.governance.request_promotion(mem.id, req.actor_id, propose)
            proposed_to = promo.to_scope_id
        except GovernanceError:
            proposed_to = None  # e.g. PII/private or no team - saved personal, not proposed
    return {
        "content": mem.content, "level": mem.scope.level.value,
        "superseded": [s.content for s in superseded],
        "proposed_to": proposed_to, "ingested_to": None,
    }


@router.get("/conversations")
def list_conversations(profile_id: str):
    rows = get_container().conversation_repo.list(profile_id)
    return {
        "items": [
            {"id": r["id"], "owner": r["owner"], "title": r["title"], "msgs": json.loads(r["data"])}
            for r in rows
        ]
    }


@router.put("/conversations/{cid}")
def save_conversation(cid: str, req: ConversationSave):
    ok = get_container().conversation_repo.upsert(
        cid, req.owner, req.title, json.dumps(req.msgs), datetime.now(timezone.utc)
    )
    return {"ok": ok}  # false when it belongs to another user (no silent success)


@router.delete("/conversations/{cid}")
def delete_conversation(cid: str, profile_id: str):
    return {"ok": get_container().conversation_repo.delete(cid, profile_id)}


@router.get("/sources")
def list_sources(profile_id: str):
    from app.sources import INTEGRATIONS, REFERENCES, source_contents

    captured = get_container().audit_repo.source_captures()  # durable, from the audit log
    return {"items": [source_contents(profile_id, c, captured) for c in INTEGRATIONS + REFERENCES]}


@router.post("/sources/{connector}/ingest")
def ingest_source_item(connector: str, req: SourceIngestRequest):
    from app.application.governance_service import GovernanceError
    from app.sources import capture_key, get_item, name_of

    c = get_container()
    it = get_item(req.actor_id, connector, req.item_id)
    if it is None or it["memory"] is None:
        raise HTTPException(status_code=404, detail="unknown or non-capturable item")

    # The scope (and team) can be overridden manually; otherwise use what the item declares.
    scope_level = req.scope if req.scope in ("user", "team", "org") else it["scope"]
    # A private item is owner-only: it can never be escalated to shared memory here.
    if it["visibility"] == "private" and scope_level != "user":
        raise HTTPException(status_code=403, detail="a private item cannot be shared; make it shared first")

    # Decide the target + action WITHOUT writing yet, so the atomic capture claim can
    # guard the write (a race/retry loser must not create a duplicate memory).
    if scope_level == "user":
        action = "save"
        vis = Visibility.PRIVATE if it["visibility"] == "private" else Visibility.PERSONAL
        target, owner = Scope(level=ScopeLevel.USER, id=f"{ORG_ID}.{req.actor_id}"), req.actor_id
    else:
        team_id = req.team or it.get("team") or next(iter(c.org_repo.teams_of(req.actor_id)), None)
        share = Scope(level=ScopeLevel.ORG, id=ORG_ID) if scope_level == "org" else (
            Scope(level=ScopeLevel.TEAM, id=f"{ORG_ID}.{team_id}") if team_id else None)
        if share is None:
            raise HTTPException(status_code=400, detail="no team to route this to")
        if c.org_repo.can_govern(req.actor_id, share):
            action, target, owner, vis = "ingest", share, None, Visibility.SHARED
        else:  # not a governor: land personal, then propose it upward for approval
            action = "propose"
            target, owner, vis = Scope(level=ScopeLevel.USER, id=f"{ORG_ID}.{req.actor_id}"), req.actor_id, Visibility.PERSONAL

    # First-wins: block if the shared item is already consumed, then claim atomically.
    captured = c.audit_repo.source_captures()
    if req.item_id in captured:
        return {"already": True, "captured_by": name_of(captured[req.item_id])}
    key = capture_key(it, req.actor_id, action)
    if not c.audit_repo.try_capture(key, req.actor_id):  # a concurrent/retry loser stops here
        return {"already": True, "captured_by": name_of(c.audit_repo.source_captures().get(key))}

    # Record which source item this came from (ref = its global capture key), so that
    # if this is a proposal, approving it can consume the source item globally.
    created = c.memory.write(
        [{"role": "user", "content": it["text"]}], req.actor_id, target, visibility=vis,
        owner_id=owner, source=Source(type=SourceType(connector), ref=it["id"]),
    )
    if not created:  # pipeline judged it low-value: release the claim, item stays available
        c.audit_repo.release_capture(key)
        return {"action": action, "connector": connector, "proposed_to": None, "created": []}

    proposed_to = None
    if action == "propose":
        try:
            proposed_to = c.governance.request_promotion(created[0].id, req.actor_id, scope_level).to_scope_id
        except GovernanceError:
            proposed_to = None
    facts = [{"content": m.content, "level": m.scope.level.value, "type": m.type.value,
              "updated": m.supersedes is not None} for m in created]
    return {"action": action, "connector": connector, "proposed_to": proposed_to, "created": facts}


@router.get("/memory")
def list_memory(profile_id: str):
    items = get_container().governance.list_memories(profile_id)
    return {"items": [view(m, state) for m, state in items]}


@router.get("/memory/private-held")
def private_held(profile_id: str):
    """Anonymous count of private memories held in the viewer's jurisdiction that
    they cannot access (owner-only). A number, never an item - no leak."""
    return {"count": get_container().governance.private_held(profile_id)}


@router.get("/memory/projection")
def memory_projection(profile_id: str, days_ahead: int = 0):
    """Read-only lifecycle projection: strength/tier at now+N days (never persists)."""
    from app.domain.decay import next_tier, strength
    from app.domain.enums import Tier

    c = get_container()
    now = datetime.now(timezone.utc) + timedelta(days=days_ahead)
    items = []
    for m in c.memory_repo.list_by_scope(c.org_repo.visible_scope_ids(profile_id)):
        s = strength(m.salience, m.type, m.last_accessed_at, m.access_count, now)
        t = next_tier(m.tier, s, authoritative=m.authoritative, pinned=m.pinned)
        if m.invalid_at is not None and now >= m.invalid_at and not m.authoritative and not m.pinned:
            t = Tier.DORMANT
        items.append({"id": m.id, "strength": round(s, 3), "tier": t.value})
    return {"items": items}


def _run(fn, *args):
    try:
        return fn(*args)
    except GovernanceError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


def _require_admin(profile_id: str) -> None:
    if not get_container().org_repo.is_admin(profile_id):
        raise HTTPException(status_code=403, detail="admin only")


@router.patch("/memory/{memory_id}")
def edit_memory(memory_id: str, req: EditRequest):
    m = _run(get_container().governance.edit, memory_id, req.content, req.actor_id, req.semantic_key)
    return m.model_dump(mode="json")


@router.post("/memory/{memory_id}/dismiss-lock")
def dismiss_lock(memory_id: str, actor_id: str):
    m = _run(get_container().governance.dismiss_suggestion, memory_id, actor_id)
    return m.model_dump(mode="json")


@router.delete("/memory/{memory_id}")
def forget_memory(memory_id: str, actor_id: str):
    _run(get_container().governance.forget, memory_id, actor_id)
    return {"ok": True}


@router.post("/memory/{memory_id}/pin")
def pin_memory(memory_id: str, req: FlagRequest):
    m = _run(get_container().governance.set_pin, memory_id, req.actor_id, req.value)
    return m.model_dump(mode="json")


@router.post("/memory/{memory_id}/consent")
def consent_memory(memory_id: str, req: FlagRequest):
    m = _run(get_container().governance.set_consent, memory_id, req.actor_id, req.value)
    return m.model_dump(mode="json")


@router.post("/memory/{memory_id}/authoritative")
def authoritative_memory(memory_id: str, req: FlagRequest):
    c = get_container()
    m = _run(c.governance.set_authoritative, memory_id, req.actor_id, req.value)
    cascade = None
    if req.value:  # a new lock invalidates lower-scope conflicts (same key)
        from app.application.jobs import run_cascade

        cascade = run_cascade(c, c.memory_repo.get(memory_id))
    return {**m.model_dump(mode="json"), "cascade": cascade}


@router.get("/memory/{memory_id}/lock-impact")
def lock_impact(memory_id: str, profile_id: str):
    """Preview which SHARED memories confirming this lock would supersede (read-only).
    Personal/private facts are never governed by a cascade, so they never appear here."""
    c = get_container()
    m = c.memory_repo.get(memory_id)
    if m is None:
        raise HTTPException(status_code=404, detail="memory not found")
    if not c.org_repo.can_govern(profile_id, m.scope):
        raise HTTPException(status_code=403, detail="cannot govern this scope")
    from app.application.jobs import preview_cascade

    visible = set(c.org_repo.visible_scope_ids(profile_id))
    items = [
        {"id": x.id, "level": x.scope.level.value, "content": x.content}
        for x in preview_cascade(c, m)
        if x.scope.id in visible  # only shared facts the governor can actually see
    ]
    return {"items": items}


@router.get("/memory/{memory_id}/history")
def memory_history(memory_id: str, profile_id: str):
    items = _run(get_container().governance.history_of, memory_id, profile_id)
    return {"items": [h.model_dump(mode="json") for h in items]}


@router.post("/memory/{memory_id}/restore")
def restore_memory(memory_id: str, req: RestoreRequest):
    m = _run(get_container().governance.restore, memory_id, req.version, req.actor_id)
    return m.model_dump(mode="json")


@router.post("/memory/{memory_id}/visibility")
def visibility_memory(memory_id: str, req: VisibilityRequest):
    m = _run(
        get_container().governance.set_visibility,
        memory_id, req.actor_id, Visibility(req.visibility),
    )
    return m.model_dump(mode="json")


@router.post("/memory/{memory_id}/promote")
def promote_memory(memory_id: str, req: PromoteRequest):
    r = _run(get_container().governance.request_promotion, memory_id, req.actor_id, req.to_level)
    return {"id": r.id, "status": r.status, "to": r.to_scope_id}


@router.get("/promotions")
def list_promotions(profile_id: str):
    items = get_container().governance.list_promotions(profile_id)
    return {
        "items": [
            {
                "id": r.id, "memory_id": r.memory_id, "content": r.content_preview,
                "from": r.from_scope_id, "to_level": r.to_level, "to": r.to_scope_id,
                "requested_by": r.requested_by,
            }
            for r in items
        ]
    }


@router.post("/promotions/{rid}/decide")
def decide_promotion(rid: str, req: DecideRequest):
    r = _run(get_container().governance.decide_promotion, rid, req.actor_id, req.approve)
    return {"id": r.id, "status": r.status}


@router.get("/audit")
def audit(profile_id: str, limit: int = 100):
    # audit_list already excludes internal source-capture rows before the limit.
    items = get_container().governance.audit_list(profile_id, limit)
    return {"items": [e.model_dump(mode="json") for e in items]}


@router.post("/admin/seed")
def seed(profile_id: str, force: bool = False):
    _require_admin(profile_id)
    return {"seeded": get_container().seed(force)}


@router.post("/admin/redteam")
def redteam(profile_id: str):
    _require_admin(profile_id)
    return run_redteam(get_container())


@router.post("/admin/jobs/decay")
def decay(profile_id: str, days_ahead: int = 0):
    _require_admin(profile_id)
    from app.application.jobs import run_decay

    now = datetime.now(timezone.utc) + timedelta(days=days_ahead)
    return run_decay(get_container(), now)


@router.post("/admin/jobs/consolidate")
def consolidate(profile_id: str):
    _require_admin(profile_id)
    from app.application.jobs import run_consolidation

    return run_consolidation(get_container())
