from functools import lru_cache

from app.ai.config import AIConfig, load_ai_config
from app.ai.providers.base import EmbeddingProvider, LLMProvider, RerankerProvider
from app.ai.providers.rest_provider import RestEmbeddingProvider, RestLLMProvider
from app.ai.providers.reranker import LLMReranker, LocalReranker, RrfReranker
from app.config import get_settings

_ROLE_ATTR = {
    "reasoner": "reasoner",
    "extractor": "extractor",
    "judge": "judge",
    "reranker": "reranker",
}


@lru_cache
def _cfg() -> AIConfig:
    return load_ai_config()


@lru_cache
def get_llm(role: str = "reasoner") -> LLMProvider:
    cfg = _cfg()
    model = getattr(cfg, _ROLE_ATTR[role])
    return RestLLMProvider(cfg.endpoint, model)


@lru_cache
def get_embedder() -> EmbeddingProvider:
    cfg = _cfg()
    return RestEmbeddingProvider(cfg.endpoint, cfg.embedder, cfg.embed_dim)


@lru_cache
def get_reranker() -> RerankerProvider:
    s = get_settings()
    if s.use_local_reranker:  # heavy local cross-encoder (bge)
        return LocalReranker()
    if s.use_llm_reranker:  # real neural rerank via the chat model
        return LLMReranker(get_llm("reranker"))
    return RrfReranker()  # cheapest: trust the upstream hybrid/RRF order


def embedding_collection() -> str:
    """Vector collection name. Embedding dimensions are fixed at creation, so changing
    the embedding model means recreating the collection (drop + re-seed)."""
    return "memories"
