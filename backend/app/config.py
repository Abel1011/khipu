from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # AI provider: Qwen Cloud (DashScope), OpenAI-compatible
    qwen_base_url: str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    qwen_api_key: str = ""
    qwen_reasoner: str = "qwen3.7-plus"
    qwen_extractor: str = "qwen3.6-flash"
    qwen_judge: str = "qwen3.7-plus"
    qwen_reranker: str = "qwen3.6-flash"
    qwen_embedder: str = "text-embedding-v3"  # DashScope embedding model, 1024-dim
    qwen_embed_dim: int = 1024

    # Infra
    qdrant_url: str = "http://localhost:6333"
    postgres_url: str = "postgresql+psycopg://khipu:khipu@localhost:5432/khipu"

    # Retrieval
    retrieval_top_k: int = 50
    rerank_top_n: int = 6
    dormant_cue_threshold: float = 0.45  # min similarity for a dormant memory to reactivate

    # Fail loud instead of falling back to in-memory stores (turn on in production).
    require_persistence: bool = False

    use_local_reranker: bool = False  # heavy bge cross-encoder (needs the 'local' extra)
    use_llm_reranker: bool = True  # real neural rerank via the chat model (Qwen-native under qwen)


@lru_cache
def get_settings() -> Settings:
    return Settings()
