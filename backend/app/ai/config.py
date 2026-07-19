from dataclasses import dataclass, field

from app.config import get_settings


@dataclass(frozen=True)
class Endpoint:
    """A compatible chat/embeddings REST endpoint (no provider names on purpose)."""

    base_url: str
    api_key: str
    auth_style: str = "bearer"  # "bearer" | "api_key"
    chat_path: str = "/chat/completions"
    embed_path: str = "/embeddings"
    query: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class AIConfig:
    endpoint: Endpoint
    reasoner: str
    extractor: str
    judge: str
    embedder: str
    embed_dim: int


def load_ai_config() -> AIConfig:
    """Build the AI config from Qwen Cloud (DashScope) settings. The endpoint is
    OpenAI-compatible, so the generic RestLLMProvider needs no provider-specific code."""
    s = get_settings()
    return AIConfig(
        endpoint=Endpoint(base_url=s.qwen_base_url, api_key=s.qwen_api_key),
        reasoner=s.qwen_reasoner,
        extractor=s.qwen_extractor,
        judge=s.qwen_judge,
        embedder=s.qwen_embedder,
        embed_dim=s.qwen_embed_dim,
    )
