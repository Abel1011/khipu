"""Sample organization ("Lumina") and seed memories."""

import uuid
from datetime import datetime, timezone

from app.domain.enums import (
    MemoryType,
    ScopeLevel,
    SourceType,
    Tier,
    Visibility,
)
from app.domain.models import Memory, Scope, Source

# Stable namespace so seed memories get deterministic ids: re-seeding a
# persistent store upserts the same points instead of creating duplicates.
_SEED_NS = uuid.UUID("5b6e0f8c-2c1a-4e9a-9b3a-c0ffee5eed00")


def _seed_id(scope: Scope, content: str) -> str:
    return str(uuid.uuid5(_SEED_NS, f"{scope.id}|{content}"))

ORG_ID = "lumina"

TEAMS = [
    {"id": "sales", "name": "Sales"},
    {"id": "ing", "name": "Engineering"},
    {"id": "cs", "name": "Customer Success"},
    {"id": "product", "name": "Product"},
]

PEOPLE = [
    {"id": "elena", "name": "Elena", "role": "Org Admin", "team": None, "admin": True},
    {"id": "ana", "name": "Ana", "role": "Sales Lead", "team": "sales", "lead": True},
    {"id": "bruno", "name": "Bruno", "role": "Sales Rep", "team": "sales"},
    {"id": "carla", "name": "Carla", "role": "Engineering Lead", "team": "ing", "lead": True},
    {"id": "marco", "name": "Marco", "role": "Engineer", "team": "ing"},
    {"id": "diego", "name": "Diego", "role": "Customer Success Lead", "team": "cs", "lead": True},
    {"id": "lucia", "name": "Lucia", "role": "Support", "team": "cs"},
    {"id": "sofia", "name": "Sofia", "role": "Product Lead", "team": "product", "lead": True},
    {"id": "javier", "name": "Javier", "role": "Product Manager", "team": "product"},
]


def org_scope() -> Scope:
    return Scope(level=ScopeLevel.ORG, id=ORG_ID)


def team_scope(team: str) -> Scope:
    return Scope(level=ScopeLevel.TEAM, id=f"{ORG_ID}.{team}")


def user_scope(person: str) -> Scope:
    return Scope(level=ScopeLevel.USER, id=f"{ORG_ID}.{person}")


def _m(content, scope, *, key=None, tier=Tier.WORKING, mtype=MemoryType.EPISODIC,
       vis=Visibility.SHARED, owner=None, auth=False, suggest=False,
       src=SourceType.HANDBOOK, sal=0.6, expires=None) -> Memory:
    return Memory(
        id=_seed_id(scope, content),
        content=content, semantic_key=key, scope=scope, authoritative=auth,
        lock_suggested=suggest, tier=tier, type=mtype, visibility=vis, owner_id=owner,
        salience=sal, strength=sal, source=Source(type=src),
        invalid_at=datetime.fromisoformat(expires).replace(tzinfo=timezone.utc) if expires else None,
    )


def build_seed_memories() -> list[Memory]:
    """One connected story - the Globex discount negotiation - that threads through
    scope precedence, a pending policy update, privacy, and lifecycle."""
    S, C, D = MemoryType.SEMANTIC, Tier.CONSOLIDATED, Tier.DORMANT
    P, PREF = MemoryType.PROCEDURAL, MemoryType.PREFERENCE
    return [
        # ---- Elena (Org Admin) - her own personal memories ----
        _m("Reviews every promotion request personally before approving", user_scope("elena"),
           key="elena.reviews", tier=C, mtype=PREF, vis=Visibility.PERSONAL, owner="elena",
           src=SourceType.CALENDAR, sal=0.72),
        _m("Holds a weekly 1:1 with each team lead", user_scope("elena"), key="elena.oneonone",
           mtype=PREF, vis=Visibility.PERSONAL, owner="elena", src=SourceType.CALENDAR, sal=0.66),
        _m("Weighing a reorg of Customer Success next quarter - keep private for now",
           user_scope("elena"), key="elena.reorg", vis=Visibility.PRIVATE, owner="elena",
           src=SourceType.EMAIL, sal=0.6),

        # ---- Organization: the discount policy (the spine of the story) ----
        _m("Maximum discount is 20% for new clients", org_scope(), key="policy.max_discount",
           tier=C, mtype=S, auth=True, sal=1.0),
        # A pending policy update - same segment (new clients), value raised 20% -> 25%.
        # An AI-suggested lock; confirming it supersedes the 20% (a real update) via cascade,
        # while the separate strategic-account rule (different key) keeps coexisting.
        _m("Maximum discount for new clients is now 25%", org_scope(),
           key="policy.max_discount", tier=C, mtype=S, suggest=True, sal=0.95),
        _m("Never share client data across teams", org_scope(), key="policy.data_sharing",
           tier=C, mtype=S, auth=True, sal=1.0),
        # Time-bound: a promo that stops being current after a date (shows expiry + decay).
        _m("Summer renewal promo: an extra 5% off runs through 2026-08-31", org_scope(),
           key="policy.summer_promo", sal=0.7, expires="2026-08-31"),
        _m("Client onboarding runs in 5 steps", org_scope(), key="process.onboarding",
           mtype=P, sal=0.7),

        # ---- Sales team ----
        _m("Sales team's maximum discount for new clients is 10%", team_scope("sales"),
           key="policy.max_discount", mtype=S, sal=0.6),
        _m("Lead the pitch with the annual plan", team_scope("sales"), key="sales.pitch",
           tier=C, mtype=P, src=SourceType.SLACK, sal=0.82),
        _m("Strategic accounts like Globex may reach 25% with VP sign-off", team_scope("sales"),
           key="sales.strategic", tier=C, mtype=P, src=SourceType.SLACK, sal=0.8),
        _m("Globex quarterly business review is scheduled for 2026-07-29", team_scope("sales"),
           key="sales.globex_qbr", src=SourceType.CALENDAR, sal=0.6, expires="2026-07-30"),

        # ---- Ana (Sales Lead) - owns the Globex account ----
        _m("Globex is my key account - price-sensitive, prefers a long-term partnership over deep one-off discounts",
           user_scope("ana"), key="ana.globex", tier=C, mtype=PREF,
           vis=Visibility.PERSONAL, owner="ana", src=SourceType.EMAIL, sal=0.9),
        _m("Prefers 25-minute meetings", user_scope("ana"), key="ana.meeting_pref",
           tier=C, mtype=PREF, vis=Visibility.PERSONAL, owner="ana",
           src=SourceType.CALENDAR, sal=0.75),
        _m("Covering Diego's Initech account while he is on leave until 2026-08-04",
           user_scope("ana"), key="ana.cover", vis=Visibility.PERSONAL, owner="ana",
           src=SourceType.EMAIL, sal=0.6, expires="2026-08-04"),
        _m("Globex's CFO hinted off the record they are weighing other vendors - keep strictly confidential",
           user_scope("ana"), key="ana.globex_intel", vis=Visibility.PRIVATE, owner="ana",
           src=SourceType.EMAIL, sal=0.85),

        # ---- Bruno (Sales Rep) ----
        _m("Closed the Initech deal in May", user_scope("bruno"), key="bruno.initech",
           tier=D, vis=Visibility.PERSONAL, owner="bruno", src=SourceType.EMAIL, sal=0.25),
        _m("Considering a move to the enterprise team", user_scope("bruno"), key="bruno.career",
           vis=Visibility.PRIVATE, owner="bruno", src=SourceType.SLACK, sal=0.5),

        # ---- Engineering & Customer Success (background for the org tree) ----
        _m("Deploys happen on Tuesdays", team_scope("ing"), key="eng.deploy_day",
           tier=C, mtype=P, src=SourceType.SLACK, sal=0.85),
        _m("Owner of the payments microservice", user_scope("carla"), key="carla.owns",
           vis=Visibility.PERSONAL, owner="carla", src=SourceType.KANBAN, sal=0.72),
        _m("Response SLA is 4 hours", team_scope("cs"), key="cs.sla", mtype=S, sal=0.7),
        _m("Manages the Initech account", user_scope("diego"), key="diego.initech",
           vis=Visibility.PERSONAL, owner="diego", src=SourceType.EMAIL, sal=0.72),

        # ---- Extra org fabric (fills out the khipu) ----
        _m("All-hands is the first Monday of each month", org_scope(), key="process.allhands",
           mtype=P, sal=0.65),
        _m("Expense reports are due by month-end", org_scope(), key="policy.expenses",
           tier=C, mtype=S, sal=0.7),
        _m("Company values: clarity, ownership, and trust", org_scope(), key="org.values",
           tier=C, mtype=S, sal=0.75),

        # ---- Sales team ----
        _m("Update the CRM within 24 hours of every client call", team_scope("sales"),
           key="sales.crm", tier=C, mtype=P, src=SourceType.SLACK, sal=0.7),
        _m("Quarterly targets reset on the first of the quarter", team_scope("sales"),
           key="sales.targets", mtype=S, sal=0.62),

        # ---- Ana / Bruno extras ----
        _m("Follows up with Globex every Friday afternoon", user_scope("ana"),
           key="ana.followup", tier=C, mtype=PREF, vis=Visibility.PERSONAL, owner="ana",
           src=SourceType.CALENDAR, sal=0.68),
        _m("Prefers async written standups over calls", user_scope("bruno"),
           key="bruno.standup_pref", mtype=PREF, vis=Visibility.PERSONAL, owner="bruno",
           src=SourceType.SLACK, sal=0.55),

        # ---- Engineering team + people ----
        _m("Code reviews require two approvals before merge", team_scope("ing"),
           key="eng.review", tier=C, mtype=P, src=SourceType.KANBAN, sal=0.8),
        _m("On-call rotates weekly, handoff on Mondays", team_scope("ing"),
           key="eng.oncall", mtype=P, src=SourceType.SLACK, sal=0.7),
        _m("Leading the auth-service redesign this quarter", user_scope("carla"),
           key="carla.authproject", tier=C, mtype=PREF, vis=Visibility.PERSONAL, owner="carla",
           src=SourceType.KANBAN, sal=0.7),
        _m("Owns the payments latency fix", user_scope("marco"), key="marco.latency",
           vis=Visibility.PERSONAL, owner="marco", src=SourceType.KANBAN, sal=0.66),
        _m("Prefers deep-work blocks in the morning", user_scope("marco"),
           key="marco.focus_pref", mtype=PREF, vis=Visibility.PERSONAL, owner="marco",
           src=SourceType.CALENDAR, sal=0.5),

        # ---- Customer Success team + people ----
        _m("Escalations reach the team lead within one hour", team_scope("cs"),
           key="cs.escalation", tier=C, mtype=P, src=SourceType.SLACK, sal=0.78),
        _m("Send an NPS survey after each resolved ticket", team_scope("cs"),
           key="cs.nps", mtype=P, sal=0.6),
        _m("Runs the quarterly business reviews", user_scope("diego"), key="diego.qbr",
           tier=C, mtype=PREF, vis=Visibility.PERSONAL, owner="diego", src=SourceType.CALENDAR, sal=0.7),
        _m("Handles tier-1 support tickets", user_scope("lucia"), key="lucia.tier1",
           vis=Visibility.PERSONAL, owner="lucia", src=SourceType.KANBAN, sal=0.6),
        _m("Certified on the product admin console", user_scope("lucia"), key="lucia.cert",
           tier=C, mtype=S, vis=Visibility.PERSONAL, owner="lucia", src=SourceType.HANDBOOK, sal=0.64),

        # ---- Product team + people (the fourth cord) ----
        _m("Feature requests are triaged every Wednesday", team_scope("product"),
           key="product.triage", tier=C, mtype=P, src=SourceType.KANBAN, sal=0.75),
        _m("Ship behind a feature flag, then roll out gradually", team_scope("product"),
           key="product.flags", tier=C, mtype=P, src=SourceType.SLACK, sal=0.72),
        _m("The roadmap is reviewed at the start of every sprint", team_scope("product"),
           key="product.roadmap", mtype=P, sal=0.62),
        _m("Leads the pricing revamp initiative", user_scope("sofia"), key="sofia.pricing",
           tier=C, mtype=PREF, vis=Visibility.PERSONAL, owner="sofia", src=SourceType.KANBAN, sal=0.75),
        _m("Prefers written specs over status meetings", user_scope("sofia"),
           key="sofia.spec_pref", mtype=PREF, vis=Visibility.PERSONAL, owner="sofia",
           src=SourceType.SLACK, sal=0.55),
        _m("Running the checkout redesign", user_scope("javier"), key="javier.checkout",
           vis=Visibility.PERSONAL, owner="javier", src=SourceType.KANBAN, sal=0.66),
        _m("Certified scrum master", user_scope("javier"), key="javier.scrum",
           tier=C, mtype=S, vis=Visibility.PERSONAL, owner="javier", src=SourceType.HANDBOOK, sal=0.6),
    ]
