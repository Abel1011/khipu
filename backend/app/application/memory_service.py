import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.ai.prompts.answer import ANSWER_SYSTEM
from app.ai.prompts.answer_stream import ANSWER_STREAM_SYSTEM
from app.ai.prompts.conflict import CONFLICT_SYSTEM
from app.ai.prompts.extraction import EXTRACTION_SYSTEM
from app.ai.prompts.judge import JUDGE_SYSTEM
from app.ai.prompts.router import ROUTER_SYSTEM
from app.ai.types import Message
from app.application.retrieval import hybrid_rank
from app.domain.decay import strength
from app.domain.enums import MemoryType, ScopeLevel, Status, Tier, Visibility
from app.domain.models import AuditEntry, Memory, Scope, Source
from app.domain.policies import usable_in_answer
from app.domain.resolution import ResolvedFact, resolve
from app.guards.injection import looks_like_injection
from app.guards.pii import detect_pii

_LEVEL_LABEL = {
    ScopeLevel.ORG: "Company policy",
    ScopeLevel.TEAM: "Team practice",
    ScopeLevel.USER: "Personal",
}
_DEDUP_THRESHOLD = 0.78  # cosine prefilter; the conflict judge confirms before merging


@dataclass
class Citation:
    memory_id: str
    level: str
    content: str
    authoritative: bool
    reason: str = "unique"  # why it won: authoritative-lock | most-specific | unique
    overrode: list[str] = field(default_factory=list)  # same-key facts it beat


@dataclass
class AnswerResult:
    text: str
    citations: list[Citation]
    mode: str = "retrieved"  # retrieved | direct (router skipped archival search)


class MemoryService:
    def __init__(
        self, memory_repo, audit_repo, org_repo, embedder,
        extractor_llm, judge_llm, reasoner_llm, reranker,
        top_k: int = 50, rerank_top_n: int = 6, core_limit: int = 8,
        dormant_cue: float = 0.45, gate_llm=None,
    ):
        self.repo = memory_repo
        self.audit = audit_repo
        self.org = org_repo
        self.embedder = embedder
        self.extractor = extractor_llm
        self.judge = judge_llm
        self.gate = gate_llm or judge_llm
        self.reasoner = reasoner_llm
        self.reranker = reranker
        self.top_k = top_k
        self.rerank_top_n = rerank_top_n
        self.core_limit = core_limit  # max memories kept always-in-context
        self.dormant_cue = dormant_cue  # min similarity to reactivate a dormant memory

    def store(self, memory: Memory) -> None:
        """Embed and persist a ready-made memory (used by the seeder)."""
        self.repo.upsert(memory, self.embedder.embed([memory.content])[0])

    def store_many(self, memories: list[Memory]) -> None:
        """Batch-embed and persist many memories in one embedding call (seeding)."""
        if not memories:
            return
        vectors = self.embedder.embed([m.content for m in memories])
        for memory, vector in zip(memories, vectors):
            self.repo.upsert(memory, vector)

    # ---- write pipeline ----
    def write(
        self, messages, actor_id: str, scope: Scope, *,
        visibility: Visibility = Visibility.PERSONAL,
        owner_id: str | None = None, source: Source | None = None,
    ) -> list[Memory]:
        owner_id, visibility = self._scope_defaults(scope, owner_id, visibility)
        self._flag_injection(" ".join(m.get("content", "") for m in messages), actor_id)
        created: list[Memory] = []
        for f in self._extract(messages):
            if float(f.get("confidence", 0)) < 0.5 or not self._accept(f):
                continue
            # AI may flag org/team knowledge as a lock candidate; a human confirms.
            suggested = (
                bool(f.get("policy_candidate"))
                and scope.level in (ScopeLevel.ORG, ScopeLevel.TEAM)
                and visibility == Visibility.SHARED
            )
            mem, _ = self._persist_fact(
                f["content"], semantic_key=f.get("semantic_key"), mtype=_as_type(f.get("type")),
                scope=scope, visibility=visibility, owner_id=owner_id,
                salience=float(f.get("salience", 0.6)), confidence=float(f.get("confidence", 0.8)),
                actor_id=actor_id, source=source, suggested=suggested,
                valid_until=_parse_date(f.get("valid_until")),
            )
            created.append(mem)
        return created

    def capture(self, messages) -> list[dict]:
        """Extract candidate facts worth remembering - for the user to confirm (no save)."""
        out = []
        for f in self._extract(messages):
            if float(f.get("confidence", 0)) < 0.5 or not self._accept(f):
                continue
            audience = f.get("audience")
            out.append({
                "content": f["content"], "type": _as_type(f.get("type")).value,
                "semantic_key": f.get("semantic_key"),
                "audience": audience if audience in ("personal", "team", "org") else "personal",
            })
        return out

    def save_fact(
        self, content: str, actor_id: str, scope: Scope, *,
        semantic_key: str | None = None, mtype: MemoryType = MemoryType.EPISODIC,
        source: Source | None = None,
    ) -> tuple[Memory, list[Memory]]:
        """Persist one confirmed fact (from chat capture) through dedup + conflict handling."""
        owner_id, visibility = self._scope_defaults(scope, None, Visibility.PERSONAL)
        return self._persist_fact(
            content, semantic_key=semantic_key, mtype=mtype, scope=scope, visibility=visibility,
            owner_id=owner_id, salience=0.6, confidence=0.8, actor_id=actor_id, source=source,
        )

    @staticmethod
    def _scope_defaults(scope: Scope, owner_id, visibility):
        if scope.level == ScopeLevel.USER:
            return scope.id.split(".", 1)[-1], visibility  # owned by its scope's user
        return owner_id, Visibility.SHARED  # team/org memories are shared knowledge

    def _persist_fact(
        self, content: str, *, semantic_key, mtype, scope, visibility, owner_id,
        salience, confidence, actor_id, source, suggested=False, valid_until=None,
    ) -> tuple[Memory, list[Memory]]:
        pii = detect_pii(content)
        quarantined = pii and visibility == Visibility.SHARED and actor_id
        if quarantined:
            # Sensitive content never enters shared memory directly: it lands in the
            # actor's personal space instead; a sanitized derivative can be promoted
            # later through the approval queue (which blocks PII as-is).
            org_root = scope.id.split(".", 1)[0]
            scope = Scope(level=ScopeLevel.USER, id=f"{org_root}.{actor_id}")
            visibility = Visibility.PERSONAL
            owner_id = actor_id
            suggested = False  # a quarantined fact is never a lock candidate
        vector = self.embedder.embed([content])[0]
        key = semantic_key
        # Reconcile onto the nearest SAME/UPDATE neighbour's key. Cosine is a cheap
        # prefilter; the conflict judge confirms before merging (never corrupt a distinct
        # memory). Scanning the top neighbours - not just the single closest - lets an
        # update land on the right fork instead of the wrong base (fork lineage).
        near_scopes = list(self.org.visible_scope_ids(actor_id)) if actor_id else []
        if scope.id not in near_scopes:
            near_scopes.append(scope.id)
        for cand, score in self.repo.neighbors(vector, near_scopes, 5):
            if score < _DEDUP_THRESHOLD:
                break
            if cand.semantic_key and (content == cand.content or self._conflict(content, cand.content) != "unrelated"):
                key = cand.semantic_key
                break
        mem = Memory(
            content=content, semantic_key=key, type=mtype, scope=scope, visibility=visibility,
            owner_id=owner_id, salience=salience, confidence=confidence, strength=salience,
            created_by_id=actor_id, source=source, pii=pii,
            lock_suggested=suggested, invalid_at=valid_until,
        )
        superseded = self._supersede_same_scope(mem)
        self.repo.upsert(mem, vector)
        self.audit.append(AuditEntry(memory_id=mem.id, actor_id=actor_id, action="create"))
        if quarantined:
            self.audit.append(AuditEntry(
                memory_id=mem.id, actor_id=actor_id, action="pii-quarantine",
                detail="sensitive content kept personal instead of shared",
            ))
        return mem, superseded

    def _extract(self, messages) -> list[dict]:
        today = datetime.now(timezone.utc).date().isoformat()
        convo = f"Today is {today}.\n" + "\n".join(f"{m['role']}: {m['content']}" for m in messages)
        data = self.extractor.json([Message("system", EXTRACTION_SYSTEM), Message("user", convo)])
        return data.get("facts", [])

    def _accept(self, fact) -> bool:
        note = fact["content"]
        if fact.get("valid_until"):
            note += f"\n(Time-bound event, valid until {fact['valid_until']}.)"
        data = self.gate.json([Message("system", JUDGE_SYSTEM), Message("user", note)])
        return bool(data.get("accepted"))

    def _conflict(self, new_content: str, existing_content: str) -> str:
        """Classify how a new fact relates to an existing one: same | update | unrelated."""
        data = self.judge.json([
            Message("system", CONFLICT_SYSTEM),
            Message("user", f"EXISTING: {existing_content}\nNEW: {new_content}"),
        ])
        rel = data.get("relation")
        return rel if rel in ("same", "update", "unrelated") else "unrelated"

    def _supersede_same_scope(self, mem: Memory) -> list[Memory]:
        """Conflict-aware supersede: only same/update facts are archived. If the key
        clashes only with UNRELATED facts, the new one gets its own key so distinct
        memories coexist (never lose valid knowledge to a semantic_key collision)."""
        superseded: list[Memory] = []
        if not mem.semantic_key:
            return superseded
        same: list[Memory] = []
        clashes_distinct = False
        for old in self.repo.by_semantic_key(mem.semantic_key, [mem.scope.id]):
            if old.authoritative:  # a lock is never auto-superseded by a new write
                continue
            if mem.content == old.content or self._conflict(mem.content, old.content) != "unrelated":
                same.append(old)
            else:
                clashes_distinct = True
        if not same and clashes_distinct:
            _rekey(mem)  # keep the distinct facts apart at read time
            return superseded
        now = datetime.now(timezone.utc)
        for old in same:
            old.superseded_by = mem.id
            old.invalid_at = mem.valid_at
            old.expired_at = now
            old.status = Status.ARCHIVED
            mem.supersedes = old.id
            self.repo.patch(old)
            self.audit.append(AuditEntry(
                memory_id=old.id, actor_id=mem.created_by_id or "system",
                action="supersede", detail=mem.id,
            ))
            superseded.append(old)
        return superseded

    # ---- read pipeline ----
    def _flag_injection(self, text: str, actor_id: str | None) -> None:
        """Isolation is enforced at the data layer; a matching pattern can't actually
        override scope - but we record the attempt in the audit trail (red-team signal)."""
        if actor_id and looks_like_injection(text):
            self.audit.append(AuditEntry(
                memory_id="-", actor_id=actor_id, action="injection-flagged",
                detail="prompt-injection pattern in input (blocked by isolation)",
            ))

    def answer(self, query: str, requester_id: str) -> AnswerResult:
        self._flag_injection(query, requester_id)
        resolved, mode = self._gather(query, requester_id)
        text, used = self._compose(query, resolved)
        self._reinforce([resolved[i].memory for i in used])
        return AnswerResult(text=text, citations=self._citations(resolved, used), mode=mode)

    def answer_stream(self, query: str, requester_id: str):
        """Yield events for a streamed answer: meta → token* → done."""
        self._flag_injection(query, requester_id)
        resolved, mode = self._gather(query, requester_id)
        ctx = f"Numbered memories:\n{self._listing(resolved)}\n\nUser message: {query}"
        yield {"type": "meta", "mode": mode}
        chunks: list[str] = []
        for delta in self.reasoner.stream(
            [Message("system", ANSWER_STREAM_SYSTEM), Message("user", ctx)]
        ):
            chunks.append(delta)
            yield {"type": "token", "text": delta}
        full = "".join(chunks)
        used = _parse_markers(full, len(resolved))
        self._reinforce([resolved[i].memory for i in used])
        # Renumber inline [k] to a clean 1..N sequence matching the citation cards.
        remap = {orig + 1: seq + 1 for seq, orig in enumerate(used)}
        final = _renumber_markers(full, remap)
        cites = self._citations(resolved, used)
        yield {"type": "done", "text": final, "citations": [c.__dict__ for c in cites]}

    def _gather(self, query: str, requester_id: str) -> tuple[list[ResolvedFact], str]:
        """Shared retrieval: core (locks + pins) always present, archival added
        only when the adaptive router decides it is needed."""
        scope_ids = self.org.visible_scope_ids(requester_id)
        pool = self._core_pool(scope_ids, requester_id)
        retrieved = self._needs_retrieval(query)
        if retrieved:
            dense = self.embedder.embed([query])[0]
            candidates = [
                m for m in self.repo.search(dense, query, scope_ids, self.top_k)
                if usable_in_answer(m, requester_id=requester_id)
            ]
            candidates += self._reactivate_dormant(dense, scope_ids, requester_id)
            pool += self._rerank(query, hybrid_rank(query, candidates))
        return resolve(pool), ("retrieved" if retrieved else "direct")

    def _reactivate_dormant(self, dense, scope_ids, requester_id: str) -> list[Memory]:
        """Cold-archive reactivation: a dormant memory re-enters recall only when the
        query is a strong cue for it (high similarity). Reactivating reconsolidates it
        back to working and reinforces it, mirroring memory reconsolidation."""
        out: list[Memory] = []
        for m, score in self.repo.neighbors(dense, scope_ids, 5):
            if score < self.dormant_cue:
                break  # neighbors are sorted; nothing below is a strong cue
            if m.tier != Tier.DORMANT:
                continue
            if not usable_in_answer(m, requester_id=requester_id, include_dormant=True):
                continue
            m.tier = Tier.WORKING
            self.repo.patch(m)
            self.audit.append(AuditEntry(
                memory_id=m.id, actor_id=requester_id, action="reactivate",
                detail=f"strong cue {score:.2f}",
            ))
            out.append(m)
        return out

    def _reinforce(self, memories: list[Memory]) -> None:
        """Spaced repetition: recalling a memory bumps its access and refreshes the
        persisted strength (so decay and the UI both reflect the reinforcement)."""
        now = datetime.now(timezone.utc)
        for m in memories:
            m.access_count += 1
            m.last_accessed_at = now
            m.strength = strength(m.salience, m.type, m.last_accessed_at, m.access_count, now)
            self.repo.patch(m)

    def _citations(self, resolved: list[ResolvedFact], used: list[int]) -> list[Citation]:
        def cite(r: ResolvedFact) -> Citation:
            return Citation(
                r.memory.id, _LEVEL_LABEL[r.memory.scope.level], r.memory.content,
                r.memory.authoritative, reason=r.reason,
                overrode=[m.content for m in r.superseded if m.content],
            )

        return [cite(resolved[i]) for i in used]  # in citation order -> card 1, 2, 3…

    def _core_pool(self, scope_ids, requester_id: str) -> list[Memory]:
        """Always-in-context memory: authoritative locks + pinned facts in the
        viewer's jurisdiction. Locks first, then most salient, capped so the
        prompt cannot bloat."""
        core = [
            m for m in self.repo.list_by_scope(scope_ids)
            if (m.authoritative or m.pinned) and usable_in_answer(m, requester_id=requester_id)
        ]
        core.sort(key=lambda m: (m.authoritative, m.salience), reverse=True)
        return core[: self.core_limit]

    def _needs_retrieval(self, query: str) -> bool:
        """Adaptive gate: skip archival search for greetings / small talk. Fails open
        (retrieve) if the classifier errors - a transient failure or a content-filter
        false positive on this small call must not sink the whole answer."""
        try:
            data = self.extractor.json([Message("system", ROUTER_SYSTEM), Message("user", query)])
            return bool(data.get("retrieve", True))
        except Exception:
            return True

    def _rerank(self, query: str, mems: list[Memory]) -> list[Memory]:
        if not mems:
            return []
        hits = self.reranker.rerank(query, [m.content for m in mems], self.rerank_top_n)
        return [mems[h.index] for h in hits]

    def _listing(self, resolved: list[ResolvedFact]) -> str:
        if not resolved:
            return "(no memories available)"
        return "\n".join(
            f"{i + 1}. [{_LEVEL_LABEL[r.memory.scope.level]}"
            f"{' locked' if r.memory.authoritative else ''}] "
            f"({r.memory.valid_at.date().isoformat()}) {r.memory.content}"
            for i, r in enumerate(resolved)
        )

    def _compose(self, query: str, resolved: list[ResolvedFact]) -> tuple[str, list[int]]:
        """Reply, and let the model report which memories it actually used."""
        ctx = f"Numbered memories:\n{self._listing(resolved)}\n\nUser message: {query}"
        data = self.reasoner.json([Message("system", ANSWER_SYSTEM), Message("user", ctx)])
        text = str(data.get("answer") or "").strip() or "…"
        used: list[int] = []
        for n in data.get("used") or []:
            try:
                idx = int(n) - 1
            except (ValueError, TypeError):
                continue
            if 0 <= idx < len(resolved) and idx not in used:  # dedup so recall isn't over-counted
                used.append(idx)
        return text, used


def _short_hash(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()[:6]


def _rekey(mem: Memory) -> None:
    """Give a fact its own semantic_key when it only collides with UNRELATED facts.
    The read path (resolution) groups by semantic_key and returns one winner per key,
    so two distinct facts sharing a key would collapse and one would vanish from the
    answer. Differentiating the key keeps them apart at read time. Pure and idempotent
    for stable content, so both the write path and the cascade job can reuse it."""
    if not mem.semantic_key:
        return
    suffix = _short_hash(mem.content)
    if not mem.semantic_key.endswith("." + suffix):
        mem.semantic_key = f"{mem.semantic_key}.{suffix}"


def _parse_date(value) -> datetime | None:
    """Parse an ISO date/datetime from the extractor into a UTC-aware datetime."""
    if not value:
        return None
    try:
        d = datetime.fromisoformat(str(value))
    except (ValueError, TypeError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


_MARKER = re.compile(r"\[(\d+)\]")


def _parse_markers(text: str, n: int) -> list[int]:
    """Citations = the numbered memories the model referenced inline as [k]."""
    used: list[int] = []
    for match in _MARKER.finditer(text):
        idx = int(match.group(1)) - 1
        if 0 <= idx < n and idx not in used:
            used.append(idx)
    return used


def _renumber_markers(text: str, remap: dict[int, int]) -> str:
    """Rewrite inline [k] citations to a clean 1..N sequence; drop stray/uncited ones."""
    return _MARKER.sub(
        lambda m: f"[{remap[int(m.group(1))]}]" if int(m.group(1)) in remap else "", text
    )


def _as_type(value) -> MemoryType:
    try:
        return MemoryType(value)
    except (ValueError, TypeError):
        return MemoryType.EPISODIC
