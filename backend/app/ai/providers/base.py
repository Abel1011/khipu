from collections.abc import Iterator
from typing import Protocol

from app.ai.types import Message, RerankHit


class LLMProvider(Protocol):
    def chat(self, messages: list[Message], *, temperature: float | None = None) -> str: ...
    def json(self, messages: list[Message]) -> dict: ...
    def stream(self, messages: list[Message], *, temperature: float | None = None) -> Iterator[str]: ...


class EmbeddingProvider(Protocol):
    dim: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class RerankerProvider(Protocol):
    def rerank(self, query: str, docs: list[str], top_n: int) -> list[RerankHit]: ...
