from functools import lru_cache

import structlog

from app.adapters.outbound.audit_inmemory import InMemoryAuditRepo
from app.adapters.outbound.memory_inmemory import InMemoryMemoryRepo
from app.adapters.outbound.org import SeedOrgRepo
from app.ai.registry import embedding_collection, get_embedder, get_llm, get_reranker
from app.application.governance_service import GovernanceService
from app.application.memory_service import MemoryService
from app.config import get_settings
from app.seed import build_seed_memories

log = structlog.get_logger()


class Container:
    def __init__(self):
        s = get_settings()
        self.embedder = get_embedder()
        self.org_repo = SeedOrgRepo()
        self.memory_repo = self._make_repo(s)
        (self.audit_repo, self.history_repo, self.conversation_repo,
         self.promotion_repo) = self._make_pg_repos(s)
        self.memory = MemoryService(
            self.memory_repo, self.audit_repo, self.org_repo, self.embedder,
            get_llm("extractor"), get_llm("judge"), get_llm("reasoner"), get_reranker(),
            top_k=s.retrieval_top_k, rerank_top_n=s.rerank_top_n,
            dormant_cue=s.dormant_cue_threshold, gate_llm=get_llm("extractor"),
        )
        self.governance = GovernanceService(
            self.memory_repo, self.audit_repo, self.org_repo, self.history_repo,
            self.promotion_repo, self.embedder,
        )

    def _make_repo(self, s):
        try:
            from app.adapters.outbound.memory_qdrant import QdrantMemoryRepo

            return QdrantMemoryRepo(s.qdrant_url, embedding_collection(), self.embedder.dim)
        except Exception as exc:  # fall back so the app runs without Qdrant
            if s.require_persistence:
                raise RuntimeError(f"require_persistence is on but Qdrant is down: {exc}") from exc
            log.warning("qdrant_unavailable_using_memory", error=str(exc))
            return InMemoryMemoryRepo()

    def _make_pg_repos(self, s):
        try:
            from app.adapters.outbound.audit_pg import PgAuditRepo
            from app.adapters.outbound.conversation_pg import PgConversationRepo
            from app.adapters.outbound.history_pg import PgHistoryRepo
            from app.adapters.outbound.promotion_pg import PgPromotionRepo

            return (
                PgAuditRepo(s.postgres_url),
                PgHistoryRepo(s.postgres_url),
                PgConversationRepo(s.postgres_url),
                PgPromotionRepo(s.postgres_url),
            )
        except Exception as exc:  # fall back so the app runs without Postgres
            if s.require_persistence:
                raise RuntimeError(f"require_persistence is on but Postgres is down: {exc}") from exc
            log.warning("postgres_unavailable_using_memory", error=str(exc))
            from app.adapters.outbound.conversation_inmemory import InMemoryConversationRepo
            from app.adapters.outbound.history_inmemory import InMemoryHistoryRepo
            from app.adapters.outbound.promotion_inmemory import InMemoryPromotionRepo

            return (
                InMemoryAuditRepo(), InMemoryHistoryRepo(),
                InMemoryConversationRepo(), InMemoryPromotionRepo(),
            )

    def seed(self, force: bool = False) -> int:
        # Idempotent on restart; force clears then re-seeds so content-id changes
        # don't leave stale orphan points behind.
        if self.memory_repo.count() > 0 and not force:
            return 0
        if force:
            # Full demo reset: seed ids are deterministic, so also wipe state that would
            # otherwise re-attach to recreated memories (phantom versions/approvals) or
            # linger in the audit view. Clearing the audit also clears source-captures.
            self.memory_repo.clear()
            self.audit_repo.clear()
            self.history_repo.clear()
            self.promotion_repo.clear()
        memories = build_seed_memories()
        self.memory.store_many(memories)  # single batched embedding call
        return len(memories)


@lru_cache
def get_container() -> Container:
    return Container()
