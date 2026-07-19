"""Per-user connector feeds.

Each person accesses their own accounts (Slack, Email, Calendar, Kanban); the
content flowing through carries its own scope - personal, team, or org. Shared
team/org messages appear in every member's feed via a stable id, so the first
person to capture one wins and everyone else sees it as already captured. The
handbook is a single company reference document (org, read by all).

Permission lives at the content level, not the connector: personal items save
directly; team/org items ingest directly if you govern that scope, otherwise
they go up as a proposal (approval queue) - mirroring the chat capture flow.
"""

from app.seed import ORG_ID, PEOPLE

_PERSON = {p["id"]: p for p in PEOPLE}
_LEAD_NAME = {p["team"]: p["name"] for p in PEOPLE if p.get("lead")}

INTEGRATIONS = ["slack", "email", "calendar", "kanban"]  # personal access points
REFERENCES = ["handbook"]  # shared company documents

# --- shared team content: one message per team, seen by every member ---
TEAM_SHARED: dict[str, list[dict]] = {
    "sales": [
        {"id": "sales-slack-priority", "connector": "slack", "channel": "#sales", "sender": "lead", "at": "2:14 PM",
         "text": "#sales decision: Globex renewal is our Q3 priority - protect the relationship and avoid deep discounting.",
         "memory": "Globex renewal is a Q3 sales priority; protect the relationship and avoid deep discounting."},
        {"id": "sales-kanban-contract", "connector": "kanban", "channel": "Sales board / Done", "sender": "Sales board", "at": "Today",
         "text": "Globex onboarding: the contract review was marked done today.",
         "memory": "Globex's contract review is complete."},
        {"id": "sales-cal-standup", "connector": "calendar", "channel": "Team", "sender": "Calendar", "at": "Daily - 9:00 AM",
         "text": "Sales standup every weekday at 9:00 AM.", "memory": "The sales team holds a daily standup at 9:00 AM."},
    ],
    "ing": [
        {"id": "ing-slack-deploy", "connector": "slack", "channel": "#eng", "sender": "lead", "at": "11:00 AM",
         "text": "#eng: deploys go out Tuesdays only - Friday is a freeze day.",
         "memory": "Engineering deploys happen on Tuesdays; Fridays are a deploy freeze."},
        {"id": "ing-kanban-review", "connector": "kanban", "channel": "Eng board / Review", "sender": "Eng board", "at": "Today",
         "text": "Reminder: every pull request needs two approvals before merge.",
         "memory": "Pull requests require two approvals before merge."},
    ],
    "cs": [
        {"id": "cs-slack-sla", "connector": "slack", "channel": "#support", "sender": "lead", "at": "9:30 AM",
         "text": "#support: our response SLA is 4 hours for every ticket.",
         "memory": "Customer Success response SLA is 4 hours."},
    ],
    "product": [
        {"id": "product-slack-beta", "connector": "slack", "channel": "#product", "sender": "lead", "at": "3:00 PM",
         "text": "#product: the mobile beta ships at the end of the quarter.",
         "memory": "The mobile beta ships at the end of the quarter."},
    ],
}

# --- shared org content: company-wide, in everyone's feed ---
ORG_SHARED: list[dict] = [
    {"id": "org-slack-promo", "connector": "slack", "channel": "#general", "sender": "People Ops", "at": "9:04 AM",
     "text": "#general: summer renewal promo - an extra 5% off runs through 2026-08-31.",
     "memory": "Summer renewal promo: an extra 5% off runs through 2026-08-31."},
    {"id": "org-cal-allhands", "connector": "calendar", "channel": "Company", "sender": "Calendar", "at": "First Mon - 10:00 AM",
     "text": "Company all-hands on the first Monday of each month.",
     "memory": "The company all-hands is the first Monday of each month."},
]

# --- the handbook: one org document, read by all (a company reference) ---
HANDBOOK: list[dict] = [
    {"id": "handbook-pricing", "title": "Pricing policy", "sender": "People Ops", "at": "v4.2",
     "text": "Strategic accounts may receive up to a 25% discount with VP approval.",
     "memory": "Strategic accounts may receive up to a 25% discount with VP approval."},
    {"id": "handbook-security", "title": "Security", "sender": "Security", "at": "v4.2",
     "text": "Client credentials must never be shared over email.",
     "memory": "Client credentials must never be shared over email."},
    {"id": "handbook-onboarding", "title": "Onboarding", "sender": "People Ops", "at": "v3.9",
     "text": "New hires complete IT setup, a benefits session, and a team welcome in their first week.",
     "memory": None},
    {"id": "handbook-remote", "title": "Remote work", "sender": "People Ops", "at": "v3.4",
     "text": "Employees may work remotely up to three days a week; core hours are 10am-3pm.",
     "memory": None},
]


def _personal(person: dict) -> dict[str, list[dict]]:
    """A person's own account content (personal scope), lightly role-flavoured."""
    name = person["name"]
    return {
        "slack": [
            {"channel": "Direct messages", "sender": name, "at": "Yesterday",
             "text": "note to self - send the weekly recap on Friday", "memory": None},
        ],
        "email": [
            {"channel": "Inbox", "sender": "newsletter@lumina.co", "at": "Mon 9:00 AM",
             "text": "Lumina weekly: town hall Thursday, three new hires, office updates.", "memory": None},
            {"channel": "Inbox", "sender": name, "at": "Today",
             "text": f"{name} prefers async written updates over status calls.",
             "memory": f"{name} prefers async written updates over status calls."},
        ],
        "calendar": [
            {"channel": "Personal", "sender": "Calendar", "at": "Recurring - Fri",
             "text": "Blocked Fridays for focus time - no meetings.",
             "memory": "Fridays are blocked for focus time - no meetings.", "visibility": "private"},
        ],
        "kanban": [
            {"channel": "My tasks", "sender": name, "at": "In progress",
             "text": f"{name}'s task: refresh the onboarding checklist.", "memory": None},
        ],
    }


def _resolve_shared(it: dict, scope: str, team: str | None) -> dict:
    sender = _LEAD_NAME.get(team, "Lead") if it["sender"] == "lead" else it["sender"]
    vis = "shared"
    return {**it, "sender": sender, "scope": scope, "team": team, "visibility": vis,
            "title": it.get("title")}


def build_feed(actor_id: str, connector: str) -> list[dict]:
    """The actor's ordered inbox for one connector: shared team/org items first,
    then their own personal items."""
    me = _PERSON.get(actor_id)
    if me is None:
        return []
    if connector in REFERENCES:  # handbook: same org document for everyone
        return [_resolve_shared(it, "org", None) for it in HANDBOOK]

    items: list[dict] = []
    team = me.get("team")
    if team:
        for it in TEAM_SHARED.get(team, []):
            if it["connector"] == connector:
                items.append(_resolve_shared(it, "team", team))
    for it in ORG_SHARED:
        if it["connector"] == connector:
            items.append(_resolve_shared(it, "org", None))
    for i, it in enumerate(_personal(me).get(connector, [])):
        items.append({
            **it, "id": f"{actor_id}:{connector}:{i}", "scope": "user", "team": None,
            "visibility": it.get("visibility", "personal"), "title": None,
        })
    return items


# Capture keys, derived from the ACTION taken (not the requested scope): only a
# direct write to shared memory consumes the item globally (first-wins). A personal
# save or a still-pending proposal is per-user ("{id}#{actor}") so it never blocks
# others - a proposal must be approved before the shared item is really consumed.
def capture_key(item: dict, actor_id: str, action: str) -> str:
    return item["id"] if action == "ingest" else f"{item['id']}#{actor_id}"


def get_item(actor_id: str, connector: str, item_id: str) -> dict | None:
    return next((it for it in build_feed(actor_id, connector) if it["id"] == item_id), None)


def name_of(actor_id: str | None) -> str | None:
    return _PERSON.get(actor_id, {}).get("name") if actor_id else None


def _governs(me: dict, scope: str, team: str | None) -> bool:
    if me.get("admin"):
        return True
    if scope == "team":
        return me.get("team") == team and bool(me.get("lead"))
    if scope == "org":
        return bool(me.get("admin"))
    return True  # personal - always your own


def _action(me: dict, it: dict) -> str:
    if it["scope"] == "user":
        return "save"
    return "ingest" if _governs(me, it["scope"], it.get("team")) else "propose"


def source_contents(actor_id: str, connector: str, captured: dict[str, str] | None = None) -> dict:
    """A connector's feed for the UI: every item + its scope, action, and capture state.
    `captured` maps a capture key -> actor who captured it (from the audit log)."""
    captured = captured or {}
    me = _PERSON.get(actor_id, {})
    items = []
    candidates = 0
    for it in build_feed(actor_id, connector):
        candidate = it["memory"] is not None
        # global capture (shared, first-wins) or this user's own personal copy
        cap = captured.get(it["id"]) or captured.get(f"{it['id']}#{actor_id}")
        if candidate:
            candidates += 1
        items.append({
            "id": it["id"], "connector": connector, "channel": it.get("channel", ""),
            "title": it.get("title"), "sender": it["sender"], "at": it["at"], "text": it["text"],
            "scope": it["scope"], "team": it.get("team"), "visibility": it["visibility"],
            "candidate": candidate, "memory": it["memory"],
            "action": _action(me, it) if candidate else None,
            "captured": cap is not None, "captured_by": name_of(cap),
        })
    return {
        "connector": connector,
        "kind": "reference" if connector in REFERENCES else "integration",
        "candidate_count": candidates,
        "captured_count": sum(1 for it in items if it["captured"]),
        "items": items,
    }
